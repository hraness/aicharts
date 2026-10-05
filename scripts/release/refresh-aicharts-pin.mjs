#!/usr/bin/env node
// Refresh the pinned aicharts CLI release carried by installer and record files.
//
//   node scripts/release/refresh-aicharts-pin.mjs --pin scripts/install.sh \
//     [--record lib/usage-cli-release.ts] [--doc FILE ...] [--check]
//
// --pin rewrites the three assignment lines every installer pins share:
//   AICHARTS_VERSION, AICHARTS_SHA256_DARWIN_AARCH64, AICHARTS_SHA256_LINUX_X86_64
// --record rewrites the fields of lib/usage-cli-release.ts (version, source
//   commit, toolchain, and the qualification/publication run links in its
//   doc comment) from the same release.
// --doc replaces the current pinned identity tokens (version, tag, source
//   commit, run ids, release dates) inside a prose file with the new ones.
// --check reports without writing. Everything fails closed: malformed
//   release data, a missing checksum row, or a pin line that is absent or
//   duplicated stops the run and writes nothing.
//
// Digests come from the release's own SHA256SUMS, downloaded through
// `gh release download`. Toolchain comes from rust-toolchain.toml at the
// tag's commit. Run ids come from the three release workflows' successful
// runs for the release commit/tag.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "hraness/aicharts";
const TAG_PREFIX = "cli-v";
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RUN = /^[0-9]{1,20}$/;
const TARGETS = {
  darwin: "aarch64-apple-darwin",
  linux: "x86_64-unknown-linux-gnu",
};
const QUALIFICATION_WORKFLOWS = {
  linux: "cli-release.yml",
  macos: "cli-macos.yml",
};
const PUBLISH_WORKFLOW = "cli-publish.yml";

const fail = (message) => {
  throw new Error(`refresh-aicharts-pin: ${message}`);
};

const gh = (args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    fail(`gh ${args[0]} ${args[1] ?? ""} failed: ${error.stderr || error.message}`);
  }
};

const compare = (a, b) =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;

const parseVersion = (text) => {
  const match = VERSION.exec(text);
  return match && { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text };
};

/// Newest stable cli-v* release: canonical tag, its commit, published date.
const latestRelease = () => {
  const releases = JSON.parse(
    gh(["api", `repos/${REPO}/releases?per_page=30`]),
  );
  let best = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release.draft || release.prerelease || typeof release.tag_name !== "string") continue;
    const version = parseVersion(release.tag_name.startsWith(TAG_PREFIX) ? release.tag_name.slice(TAG_PREFIX.length) : "");
    if (version && (!best || compare(version, best.version) > 0)) {
      best = { tag: release.tag_name, version, publishedAt: release.published_at };
    }
  }
  if (!best) fail("no stable cli-v* release found");
  const ref = JSON.parse(gh(["api", `repos/${REPO}/git/ref/tags/${best.tag}`]));
  let commit = ref?.object?.sha;
  if (ref?.object?.type === "tag") {
    commit = JSON.parse(gh(["api", `repos/${REPO}/git/tags/${commit}`]))?.object?.sha;
  }
  if (!COMMIT.test(commit || "")) fail(`tag ${best.tag} did not resolve to a commit`);
  const day = (best.publishedAt || "").slice(0, 10);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)) fail(`release ${best.tag} has no published date`);
  return { tag: best.tag, version: best.version.text, commit, day };
};

/// One lowercase-hex digest row for `name` inside `text`, or null.
const sumRow = (text, name) => {
  const rows = text.split("\n").filter((line) => line === `${line.slice(0, 64)}  ${name}` && HEX64.test(line.slice(0, 64)));
  return rows.length === 1 ? rows[0].slice(0, 64) : null;
};

/// Read the release's checksum data into a temp dir and extract the two
/// archives' digests strictly. Linux comes from the shared SHA256SUMS; the
/// macOS archive ships a `.sha256` sidecar because its bytes are finalized
/// only after notarization.
const releaseDigests = (release) => {
  const dir = mkdtempSync(join(tmpdir(), "aicharts-pin-"));
  try {
    const linuxName = `aicharts-${release.version}-${TARGETS.linux}.tar.gz`;
    const darwinName = `aicharts-${release.version}-${TARGETS.darwin}.tar.gz`;
    gh([
      "release", "download", release.tag, "--repo", REPO,
      "--pattern", "SHA256SUMS", "--pattern", `${darwinName}.sha256`,
      "--dir", dir, "--clobber",
    ]);
    const linux = sumRow(readFileSync(join(dir, "SHA256SUMS"), "utf8"), linuxName);
    const darwin = sumRow(readFileSync(join(dir, `${darwinName}.sha256`), "utf8"), darwinName);
    if (!linux || !darwin) {
      fail(`checksum data for ${release.tag} lacks a digest for ${!linux ? linuxName : darwinName}`);
    }
    return { darwin, linux };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/// Newest successful run id of `workflow` on `ref` (a sha or a branch/tag).
const successfulRun = (workflow, key, value) => {
  const runs = JSON.parse(
    gh(["api", `repos/${REPO}/actions/workflows/${workflow}/runs?${key}=${value}&per_page=10&status=success`]),
  )?.workflow_runs;
  const run = Array.isArray(runs) && runs.find((r) => r.conclusion === "success" && RUN.test(String(r.id)));
  if (!run) fail(`no successful ${workflow} run for ${key}=${value}`);
  return String(run.id);
};

/// Rust channel recorded in the tag's rust-toolchain.toml.
const toolchain = (commit) => {
  const file = gh(["api", `repos/${REPO}/contents/rust-toolchain.toml?ref=${commit}`, "--jq", ".content"]);
  const text = Buffer.from(file.replace(/\s/g, ""), "base64").toString("utf8");
  const channel = /^channel\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s*$/m.exec(text)?.[1];
  if (!channel) fail(`rust-toolchain.toml at ${commit} has no pinned channel`);
  return channel;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];
const longDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const rewrite = (path, body) => {
  const previous = readFileSync(path, "utf8");
  const next = body(previous);
  if (next === previous) return false;
  const temp = `${path}.pin-${process.pid}.tmp`;
  writeFileSync(temp, next);
  renameSync(temp, path);
  return true;
};

/// Every pin site carries the same three assignment lines.
const rewritePin = (path, release, digests) =>
  rewrite(path, (text) => {
    const rules = [
      ["AICHARTS_VERSION", release.version, /^[0-9]+\.[0-9]+\.[0-9]+$/],
      ["AICHARTS_SHA256_DARWIN_AARCH64", digests.darwin, HEX64],
      ["AICHARTS_SHA256_LINUX_X86_64", digests.linux, HEX64],
    ];
    let out = text;
    for (const [name, value, shape] of rules) {
      const rows = out.split("\n").filter((line) => line.startsWith(`${name}=`));
      if (rows.length !== 1) fail(`${path} must assign ${name} exactly once`);
      if (!shape.test(String(value))) fail(`refusing to pin a malformed ${name}`);
      out = out.replace(`${rows[0]}`, `${name}=${value}`);
    }
    return out;
  });

/// Read the identity the record currently pins so doc rewrites know the
/// tokens to replace.
const currentRecord = (path) => {
  const text = readFileSync(path, "utf8");
  const grab = (pattern, label) => {
    const value = pattern.exec(text)?.[1];
    if (!value) fail(`${path} has no ${label} to refresh`);
    return value;
  };
  return {
    version: grab(/version: "([0-9]+\.[0-9]+\.[0-9]+)"/, "version"),
    commit: grab(/sourceCommit: "([0-9a-f]{40})"/, "sourceCommit"),
    linux: grab(/Linux qualification: https:\/\/github\.com\/hraness\/aicharts\/actions\/runs\/([0-9]+)/, "Linux run"),
    macos: grab(/macOS qualification: https:\/\/github\.com\/hraness\/aicharts\/actions\/runs\/([0-9]+)/, "macOS run"),
    publish: grab(/Publication: https:\/\/github\.com\/hraness\/aicharts\/actions\/runs\/([0-9]+)/, "publish run"),
    day: grab(/checked against its assets and attestations on ([0-9]{4}-[0-9]{2}-[0-9]{2})/, "check date"),
  };
};

const rewriteRecord = (path, release, runs, channel) =>
  rewrite(path, (text) => {
    const old = currentRecord(path);
    const comment =
      `/** Published CLI release, checked against its assets and attestations on ${release.day}.\n` +
      ` * Linux qualification: https://github.com/hraness/aicharts/actions/runs/${runs.linux}\n` +
      ` * macOS qualification: https://github.com/hraness/aicharts/actions/runs/${runs.macos}\n` +
      ` * Publication: https://github.com/hraness/aicharts/actions/runs/${runs.publish}\n` +
      ` */`;
    return text
      .replace(/\/\*\* Published CLI release[\s\S]*?\*\//, comment)
      .replace(`version: "${old.version}"`, `version: "${release.version}"`)
      .replace(`sourceCommit: "${old.commit}"`, `sourceCommit: "${release.commit}"`)
      .replace(/rustToolchain: "[0-9]+\.[0-9]+\.[0-9]+"/, `rustToolchain: "${channel}"`);
  });

/// Replace the pinned identity tokens inside a prose file. Only the exact
/// tokens the current record carries are replaced, so historical mentions of
/// older releases stay untouched.
const rewriteDoc = (path, release, old, runs) =>
  rewrite(path, (text) =>
    text
      .replaceAll(`cli-v${old.version}`, `cli-v${release.version}`)
      .replaceAll(`aicharts-${old.version}`, `aicharts-${release.version}`)
      .replaceAll(`aicharts_version=${old.version}`, `aicharts_version=${release.version}`)
      .replaceAll(old.commit, release.commit)
      .replaceAll(`actions/runs/${old.linux}`, `actions/runs/${runs.linux}`)
      .replaceAll(`actions/runs/${old.macos}`, `actions/runs/${runs.macos}`)
      .replaceAll(`actions/runs/${old.publish}`, `actions/runs/${runs.publish}`)
      .replaceAll(`on ${longDay(old.day)}`, `on ${longDay(release.day)}`)
      .replaceAll(`on ${old.day}`, `on ${release.day}`));

const emit = (fields) => {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    writeFileSync(output, Object.entries(fields).map(([k, v]) => `${k}=${v}\n`).join(""), { flag: "a" });
  }
  console.log(JSON.stringify(fields));
};

const main = () => {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const pin = (() => {
    const i = args.indexOf("--pin");
    return i >= 0 ? args[i + 1] : null;
  })();
  const record = (() => {
    const i = args.indexOf("--record");
    return i >= 0 ? args[i + 1] : null;
  })();
  const docs = args.flatMap((arg, i) => (arg === "--doc" ? [args[i + 1]] : []));
  if (!pin || (docs.length > 0 && !record)) {
    fail("usage: refresh-aicharts-pin.mjs [--check] --pin FILE [--record FILE] [--doc FILE ...]");
  }

  const release = latestRelease();
  const previous = /^AICHARTS_VERSION=(.+)$/m.exec(readFileSync(pin, "utf8"))?.[1];
  const digests = releaseDigests(release);
  const runs = {
    linux: successfulRun(QUALIFICATION_WORKFLOWS.linux, "head_sha", release.commit),
    macos: successfulRun(QUALIFICATION_WORKFLOWS.macos, "head_sha", release.commit),
    publish: successfulRun(PUBLISH_WORKFLOW, "branch", release.tag),
  };
  const channel = toolchain(release.commit);
  if (check) {
    emit({ changed: previous !== release.version, version: release.version, previous: previous ?? "none", commit: release.commit });
    return;
  }
  const changed = [rewritePin(pin, release, digests)];
  if (record) {
    const old = currentRecord(record);
    changed.push(rewriteRecord(record, release, runs, channel));
    for (const doc of docs) changed.push(rewriteDoc(doc, release, old, runs));
  }
  emit({ changed: changed.some(Boolean), version: release.version, previous: previous ?? "none", commit: release.commit });
};

main();
