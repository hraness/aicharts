import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { runLinuxRelease } from "./run-linux.mjs";
import { hydrateReleaseSource } from "./hydrate-source.mjs";
import { assembleLinuxRelease } from "./assemble.mjs";
import { validateArchive } from "./archive.mjs";
import { validateLinuxQualificationReport } from "./linux-qualification.mjs";
import { LINUX_LINK_MAP_MAX_BYTES, LINUX_NOTICES_MAX_BYTES } from "./linux-notices.mjs";
import { SUPPORT_SOURCE } from "./support-source.mjs";

// Private source-only seam. The shipped runner has no effects override. Fake
// compiler/smoke facts exercise orchestration, never actual Linux qualification.
const script = new URL("./run-linux.mjs", import.meta.url);
const runtime = fs.readFileSync(script, "utf8").replace(/from "(\.\/[^"]+)"/gu, (_, relative) => "from " + JSON.stringify(new URL(relative, script).href));
const internals = await import("data:text/javascript;base64," + Buffer.from(runtime + "\nexport { runWith, argumentsToInput, workflow, minimalEnvironment, inspectElf, resolveLibraries, compilerArtifact, execute, readRegular, prepareOutput, recheckSource, compareVersion, noticeOutputDiagnostic, artifactReadDiagnostic, checkSource };\n").toString("base64"));
const TARGET = "x86_64-unknown-linux-gnu";
const RUST_COMMIT = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
const SYSROOT = "/home/runner/.rustup/toolchains/1.97.1-" + TARGET;
const INTERPRETER = "/lib64/ld-linux-x86-64.so.2";
const LOADER = "ld-linux-x86-64.so.2";
const RESOLVED_LOADER = "/usr/lib/x86_64-linux-gnu/" + LOADER;
const OBSERVED_DEPENDENCIES = [LOADER, "libc.so.6", "libgcc_s.so.1", "libm.so.6"];
const SHA = "1".repeat(40), TREE = "2".repeat(40);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = value => Buffer.from(value);
const ok = value => ({ ok: true, value });
const result = (text = "", status = 0, error = "") => ({ status, stdout: bytes(text), stderr: bytes(error) });
const env = () => ({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "hraness/aicharts", GITHUB_REF: "refs/heads/main", GITHUB_SHA: SHA,
  GITHUB_WORKFLOW_REF: "hraness/aicharts/.github/workflows/cli-release.yml@refs/heads/main", GITHUB_RUN_ID: "9007199254740993", GITHUB_RUN_ATTEMPT: "1", ImageOS: "ubuntu22", ImageVersion: "20260907.12.1", GITHUB_TOKEN: "SYNTHETIC_NEVER_FORWARD", RUSTFLAGS: "SYNTHETIC_NEVER_FORWARD", LD_PRELOAD: "SYNTHETIC_NEVER_FORWARD" });
const elfBytes = () => { const value = Buffer.alloc(128); value.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); value.writeUInt16LE(3, 16); value.writeUInt16LE(62, 18); return value; };
function elfOutput() {
  return {
    header: "ELF Header:\n  Class: ELF64\n  Data: 2's complement, little endian\n  Machine: Advanced Micro Devices X86-64\n",
    program: " INTERP 0x01 0x01 0x01 0x01 0x01 R 0x1\n [Requesting program interpreter: " + INTERPRETER + "]\n GNU_STACK 0x00 0x00 0x00 0x00 0x00 RW 0x10\n",
    dynamic: "Dynamic section:\n 0x01 (NEEDED) Shared library: [libgcc_s.so.1]\n 0x01 (NEEDED) Shared library: [libc.so.6]\n",
    versions: "Version needs section '.gnu.version_r':\n 0x00: Version: 1 File: libgcc_s.so.1 Cnt: 1\n 0x01: Name: GCC_3.0 Flags: none Version: 2\n 0x02: Version: 1 File: libc.so.6 Cnt: 2\n 0x03: Name: GLIBC_2.2.5 Flags: none Version: 3\n 0x04: Name: GLIBC_2.34 Flags: none Version: 4\n",
    notes: "Properties: x86 ISA needed: x86-64-baseline\n",
  };
}
function statsReport(observed) {
  const clients = ["claude", "codex"], timestamp = Date.parse("2026-09-10T10:00:00Z");
  const day = Math.floor(timestamp / 86_400_000);
  return { schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1, firstUtcDay: day + (observed ? 0 : 1), dayCount: 1,
    generatedAtMs: Date.parse("2026-09-20T12:00:00Z"), revision: 0, updatedAtMs: null,
    sources: clients.map(client => ({ client, status: observed ? "observed" : "empty", tokenBasis: observed ? "reported" : "unavailable",
      records: observed ? 1 : 0, warnings: 0, latestAtMs: observed ? timestamp : null })),
    rows: observed ? clients.map((client, index) => ({ utcDay: day, client, provider: null, model: null,
      tokens: { input: index === 0 ? "100" : "10", cacheRead: index === 0 ? "50" : "0", cacheWrite: "0", output: index === 0 ? "20" : "5", reasoning: "0" },
      records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" })) : [] };
}
function fixture(t) {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "aicharts-linux-runner-test-"));
  fs.chmodSync(root, 0o700);
  t.after(() => { assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, { recursive: true }); });
  const repositoryDirectory = join(root, "repository"); fs.mkdirSync(repositoryDirectory, { mode: 0o700 });
  const outputDirectory = join(root, "result");
  const input = { repositoryDirectory, commit: SHA, expectedTree: TREE, outputDirectory };
  const paths = ["LICENSE", "NOTICE.md", "Cargo.lock", "bun.lock", "Cargo.toml", "crates/aicharts-cli/Cargo.toml", "rust-toolchain.toml", "distribution/NOTICE.md", "distribution/cli/docs/usage-install.md", "distribution/cli/docs/usage-local.md", "skills/aicharts/SKILL.md", "skills/aicharts/agents/openai.yaml", "skills/aicharts/references/benchmarks.md", "skills/aicharts/references/local-usage.md", "skills/aicharts/references/local-turns.md", "skills/aicharts/references/local-operations.md", "skills/aicharts/scripts/atlas.mjs", "skills/aicharts/scripts/atlas.check.mjs", "skills/aicharts/scripts/support.mjs", "skills/aicharts/scripts/support-foundation.mjs", "skills/aicharts/scripts/support.check.mjs", "skills/aicharts/references/support.md", "skills/aicharts/THIRD_PARTY_NOTICES.md"];
  const sourceFiles = paths.sort().map(path => ({ path, mode: 0o644, bytes: bytes("synthetic public source: " + path + "\n") }));
  sourceFiles.find(file => file.path === "Cargo.toml").bytes = bytes("[workspace.package]\nversion = \"0.1.0\"\n");
  sourceFiles.find(file => file.path === "crates/aicharts-cli/Cargo.toml").bytes = bytes("[package]\nname = \"aicharts-cli\"\nversion.workspace = true\n");
  sourceFiles.find(file => file.path === "Cargo.lock").bytes = bytes("version = 4\n");
  const source = { source: { commit: SHA, tree: TREE, commitTime: "2026-09-11T12:00:00Z" }, sourceFiles };
  const calls = [], stages = [], notices = [];
  const output = elfOutput();
  const versions = names => "Version definition section:\n" + names.map(name => "Name: " + name + "\n").join("") + "Version needs section\n";
  const runtime = {
    listing: " linux-vdso.so.1 (0x123)\n libgcc_s.so.1 => /lib/x86_64-linux-gnu/libgcc_s.so.1 (0x456)\n libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x789)\n " + INTERPRETER + " (0xabc)\n",
    definitions: {
      [LOADER]: versions(["GLIBC_2.2.5", "GLIBC_2.3"]),
      "libc.so.6": versions(["GLIBC_2.2.5", "GLIBC_2.3", "GLIBC_2.34"]),
      "libgcc_s.so.1": versions(["GCC_3.0"]),
      "libm.so.6": versions(["GLIBC_2.2.5", "GLIBC_2.29"]),
    },
  };
  let collected = false;
  const host = {
    platform: "linux", arch: "x64", nodeMajor: 24, env: env(), now: () => performance.now(),
    readFile: (file, maximum, executable) => {
      if (file === "/etc/os-release") return bytes("ID=ubuntu\nVERSION_ID=\"22.04\"\n");
      if (file.startsWith(SYSROOT) || file.startsWith("/usr/bin/") || file.startsWith("/usr/lib/x86_64-linux-gnu/")) return bytes("synthetic tool/runtime bytes");
      return internals.readRegular(file, maximum, executable);
    },
    realpath: file => file === INTERPRETER ? RESOLVED_LOADER : file.replace(/^\/lib\/x86_64-linux-gnu\//u, "/usr/lib/x86_64-linux-gnu/"),
    progress: stage => stages.push(stage), readSource: value => { assert.deepEqual(value, { repositoryDirectory, commit: SHA, expectedTree: TREE }); return ok(source); },
    hydrate: hydrateReleaseSource, assemble: assembleLinuxRelease, validateArchive,
    collectNotices: async input => { notices.push(input); const data = bytes("SYNTHETIC TEST ONLY: not qualified licenses\n"); return ok({ bytes: data, sha256: sha(data), components: 1 }); },
    execute: async (executable, args, options) => {
      calls.push({ executable, args: [...args], options });
      assert.equal(options.env.GITHUB_TOKEN, undefined); assert.equal(options.env.LD_PRELOAD, undefined);
      assert.ok(options.timeoutMs > 0); assert.ok(options.maxBytes <= 32 * 1024 * 1024);
      if (executable.endsWith("/rustup")) return result(SYSROOT + "/bin/" + args.at(-1) + "\n");
      if (executable.endsWith("/rustc")) return args[0] === "--print" ? result(SYSROOT + "\n") : result("rustc 1.97.1 (8bab26f4f 2026-07-14)\nrelease: 1.97.1\ncommit-hash: " + RUST_COMMIT + "\nhost: " + TARGET + "\n");
      if (executable === "/usr/bin/gcc-11") return result("11.4.0\n");
      if (executable === "/usr/bin/ld.bfd") return result("GNU ld (GNU Binutils for Ubuntu) 2.38\n");
      if (executable.endsWith("/bun")) return result("1.3.14\n");
      if (executable.endsWith("/cargo")) {
        if (args[0] === "--version") return result("cargo 1.97.1 (c980f4866 2026-07-06)\n");
        if (args[0] === "fetch") return result();
        const sourceDirectory = join(outputDirectory, "source");
        if (args[0] === "metadata") return result(JSON.stringify({ packages: [{ name: "aicharts-cli", id: "path+aicharts-cli#0.1.0", version: "0.1.0", manifest_path: join(sourceDirectory, "crates/aicharts-cli/Cargo.toml") }] }));
        assert.equal(args[0], "rustc");
        const artifact = join(outputDirectory, "target", TARGET, "release/aicharts");
        fs.mkdirSync(dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, elfBytes(), { mode: 0o755 });
        const map = args.at(-1).slice("link-arg=-Wl,-Map=".length); fs.writeFileSync(map, "LOAD synthetic\n");
        return result(JSON.stringify({ reason: "compiler-artifact", package_id: "path+aicharts-cli#0.1.0", target: { name: "aicharts", kind: ["bin"] }, profile: { test: false }, executable: artifact, fresh: false }) + "\n" + JSON.stringify({ reason: "build-finished", success: true }) + "\n");
      }
      if (executable === "/usr/bin/readelf") {
        if (args.at(-1).startsWith("/usr/lib/")) { assert.ok(Object.hasOwn(runtime.definitions, basename(args.at(-1)))); return result(runtime.definitions[basename(args.at(-1))]); }
        const key = new Map([["--file-header", "header"], ["--program-headers", "program"], ["--dynamic", "dynamic"], ["--version-info", "versions"], ["--notes", "notes"]]).get(args[1]);
        assert.ok(key); return result(output[key]);
      }
      if (executable === INTERPRETER) return result(runtime.listing);
      assert.ok(executable.endsWith("/aicharts")); assert.equal(options.env.PATH, "/usr/bin:/bin");
      assert.equal(options.env.CARGO_HOME, undefined); assert.equal(options.env.RUSTC, undefined);
      assert.equal(options.cwd, join(outputDirectory, "smoke"));
      const response = value => result(JSON.stringify(value));
      if (args[0] === "--version") return response({ schemaVersion: 1, operation: "version", version: "0.1.0", provenance: "unverified", build: { os: "linux", arch: "x86_64", sourceCommit: null } });
      if (args[0] === "--help") return result("synthetic help --complete-prefix\n");
      if (args[0] === "stats") {
        assert.equal(executable, join(outputDirectory, "install/aicharts-0.1.0-" + TARGET + "/bin/aicharts"));
        const home = join(options.cwd, "stats-home"), date = args[8];
        assert.deepEqual(args, ["stats", "--home", home, "--client", "claude", "--client", "codex", "--since", date, "--until", date, "--json"]);
        assert.equal(options.env.HOME, undefined);
        assert.equal(fs.readFileSync(join(home, ".claude/projects/qualification/claude.jsonl")).equals(fs.readFileSync(join(options.cwd, "claude.jsonl"))), true);
        assert.equal(fs.readFileSync(join(home, ".codex/sessions/codex.jsonl")).equals(fs.readFileSync(join(options.cwd, "codex.jsonl"))), true);
        assert.ok(["2026-09-10", "2026-09-11"].includes(date));
        return response(statsReport(date === "2026-09-10"));
      }
      if (args[0] === "keygen") { const file = join(options.cwd, "key"); if (fs.existsSync(file)) return result("", 2, "aicharts: key_create_failed\n"); fs.writeFileSync(file, Buffer.alloc(32, 7), { mode: 0o600 }); return result("Key created\n"); }
      if (args[0] === "usage") return args.includes("bad.jsonl") ? result("", 2, "aicharts: source_parse_failed\n") : response({ tokens: "185" });
      if (args[0] === "init") { fs.mkdirSync(join(options.cwd, "state"), { mode: 0o700 }); fs.writeFileSync(join(options.cwd, "state/usage.sqlite3"), "synthetic empty numeric state", { mode: 0o600 }); return result("Initialized\n"); }
      if (args[0] === "collect") { const skip = collected; collected = true; fs.writeFileSync(join(options.cwd, "state/usage.sqlite3"), "synthetic measured numeric state"); return response({ tokens: "185", usageOccurrences: 2, uploaded: false, ledgerRevision: 1, sourcesSkipped: skip ? 2 : 0, occurrencesChanged: skip ? 0 : 2 }); }
      if (args[0] === "inspect") return response({ tokens: "185" });
      if (args[0] === "prefix-enable") return result("Prefix enabled\n");
      if (args[0] === "daemon") return response({ tokens: "185", scanMode: "full_changed_source_complete_prefix", sourcesWithDeferredTail: 0 });
      if (args[0] === "turns") return response({ days: [{ utcDay: 2, completed: { runtimeMsSum: "1537", runtimeEligibleTurns: 1 } }], uploaded: false });
      if (args[0] === "upload") {
        if (args.includes("--dry-run")) {
          assert.deepEqual(args, ["upload", "--dry-run", "--key-file", "key", "--codex", "codex.jsonl", "--claude", "claude.jsonl"]);
          return response({ uploaded: false, frames: [{ hex: "00" }] });
        }
        assert.deepEqual(args, ["upload", "--state-dir", "state", "--key-file", "key"]);
        return result("", 2, "aicharts: upload_requires_qualified_macos_custody\n");
      }
      assert.fail("unexpected synthetic executable argv");
    },
  };
  return { root, input, host, calls, stages, source, output, notices, runtime };
}

// The hosted failure observed these four direct SONAMEs, including the glibc
// loader. Synthetic public version needs preserve its measured <= 2.34 floor.
function directLoaderFixture(t, named = false) {
  const f = fixture(t);
  f.output.dynamic += " (NEEDED) Shared library: [" + LOADER + "]\n (NEEDED) Shared library: [libm.so.6]\n";
  f.output.versions += "File: " + LOADER + " Cnt: 1\nName: GLIBC_2.3 Flags: none\nFile: libm.so.6 Cnt: 1\nName: GLIBC_2.29 Flags: none\n";
  f.runtime.listing += " libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0xdef)\n";
  if (named) f.runtime.listing = f.runtime.listing.replace(" " + INTERPRETER + " (", " " + LOADER + " => /lib/x86_64-linux-gnu/" + LOADER + " (");
  return f;
}

test("direct glibc loader dependency crosses exact runtime resolution, notices and archive assembly", async t => {
  for (const named of [false, true]) {
    const f = directLoaderFixture(t, named);
    assert.equal((await internals.runWith(f.input, f.host)).ok, true);
    const report = validateLinuxQualificationReport(fs.readFileSync(join(f.input.outputDirectory, "qualification.json")));
    assert.equal(report.ok, true); assert.deepEqual(report.value.value.target.dynamicDependencies, OBSERVED_DEPENDENCIES);
    const manifest = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "assets/release-manifest.json")));
    assert.equal(manifest.targets.length, 1); assert.deepEqual(manifest.targets[0].dynamicDependencies, OBSERVED_DEPENDENCIES);
    assert.equal(f.notices.length, 1);
    assert.deepEqual(f.notices[0].dynamicLibraries, OBSERVED_DEPENDENCIES.map(soname => ({ soname, path: "/usr/lib/x86_64-linux-gnu/" + soname })));
    assert.equal(f.calls.filter(call => call.executable === INTERPRETER && call.args[0] === "--list").length, 1);
    assert.equal(f.calls.filter(call => call.executable === "/usr/bin/readelf" && call.args[1] === "--version-info" && call.args.at(-1) === RESOLVED_LOADER).length, 1);
    const cli = manifest.assets.find(asset => asset.kind === "cli");
    assert.equal(cli.files.some(file => file.path.includes(".so")), false);
    assert.equal(sha(fs.readFileSync(join(f.input.outputDirectory, "install", cli.root, "bin/aicharts"))), sha(elfBytes()));
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "install", cli.root, "THIRD_PARTY_LICENSES.txt")), true);
  }
});

test("loader resolution requires the fixed interpreter and every direct library within system paths", t => {
  const f = directLoaderFixture(t), listing = f.runtime.listing;
  for (const invalid of [
    listing.replace(" " + INTERPRETER + " (0xabc)\n", ""),
    listing.replace(INTERPRETER, "/tmp/" + LOADER),
    listing.replace(INTERPRETER, LOADER + " => /lib/x86_64-linux-gnu/libc.so.6"),
    listing.replace(INTERPRETER, "ld-linux-aarch64.so.1 => " + INTERPRETER),
    listing + " " + INTERPRETER + " (0xabc)\n",
    listing.replace(" libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0xdef)\n", ""),
    listing.replace("/lib/x86_64-linux-gnu/libm.so.6", "/tmp/libm.so.6"),
    listing.replace("/lib/x86_64-linux-gnu/libm.so.6", "relative/libm.so.6"),
    listing.replace("libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0xdef)", "libm.so.6 => not found"),
  ]) assert.throws(() => internals.resolveLibraries(invalid, OBSERVED_DEPENDENCIES, f.host), { code: "runtime_invalid" });
  const changed = { ...f.host, realpath: file => file === INTERPRETER ? "/tmp/" + LOADER : f.host.realpath(file) };
  assert.throws(() => internals.resolveLibraries(listing, OBSERVED_DEPENDENCIES, changed), { code: "runtime_invalid" });
});

test("direct loader version needs retain private-marker, unsupported-version and glibc-floor refusal", t => {
  const f = directLoaderFixture(t);
  for (const version of ["GLIBC_PRIVATE", "GLIBC_ABI_DT_RELR", "LLVM_1.0", "GLIBC_2.36"]) {
    const output = { ...f.output, versions: f.output.versions.replace("Name: GLIBC_2.3 Flags:", "Name: " + version + " Flags:") };
    assert.throws(() => internals.inspectElf(elfBytes(), output), error => {
      assert.equal(error.code, "runtime_invalid");
      assert.equal(error.diagnostic.code, version === "GLIBC_2.36" ? "glibc_floor" : "unsupported_version");
      return true;
    });
  }
});

test("each direct library must itself define every requested version before smoke or assembly", async t => {
  for (const [soname, version] of [[LOADER, "GLIBC_2.3"], ["libc.so.6", "GLIBC_2.34"], ["libgcc_s.so.1", "GCC_3.0"], ["libm.so.6", "GLIBC_2.29"]]) {
    const f = directLoaderFixture(t);
    // Other libraries, and this library's needs section, cannot supply a
    // missing definition. libc deliberately still defines the loader version.
    f.runtime.definitions[soname] = f.runtime.definitions[soname].replace("Name: " + version + "\n", "") + "Name: " + version + "\n";
    assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "runtime_invalid" });
    assert.equal(f.stages.at(-1), "runtime-versions-" + soname);
    assert.equal(f.notices.length, 0);
    for (const name of ["qualification.json", "assets"]) assert.equal(fs.existsSync(join(f.input.outputDirectory, name)), false);
  }
});

test("a changed fixed interpreter binding refuses before final assembly", async t => {
  const f = directLoaderFixture(t), original = f.host.progress;
  f.host.progress = stage => {
    original(stage);
    if (stage === "source-recheck") {
      const realpath = f.host.realpath;
      f.host.realpath = file => file === INTERPRETER ? "/usr/lib/x86_64-linux-gnu/libc.so.6" : realpath(file);
    }
  };
  assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "runtime_invalid" });
  assert.equal(f.stages.at(-1), "source-recheck");
  for (const name of ["qualification.json", "assets"]) assert.equal(fs.existsSync(join(f.input.outputDirectory, name)), false);
});

test("entrypoint and public effect interface are closed before source or output access", async t => {
  const f = fixture(t);
  const args = ["--repository", f.input.repositoryDirectory, "--commit", SHA, "--tree", TREE, "--output", f.input.outputDirectory];
  assert.deepEqual({ ...internals.argumentsToInput(args) }, f.input);
  for (const invalid of [args.slice(0, -1), [...args, "--publish"], ["--unknown", ...args.slice(1)], ["--output", "x", ...args.slice(2)]]) assert.throws(() => internals.argumentsToInput(invalid));
  let touched = false;
  const accessor = { ...f.input }; Object.defineProperty(accessor, "commit", { enumerable: true, get() { touched = true; return SHA; } });
  for (const invalid of [null, [], { ...f.input, publish: true }, accessor, new Proxy(f.input, {})]) assert.equal((await internals.runWith(invalid, f.host)).error, "invalid_input");
  assert.equal(touched, false); assert.equal(fs.existsSync(f.input.outputDirectory), false);
  if (process.platform !== "linux" || process.arch !== "x64") assert.equal((await runLinuxRelease(f.input)).error, "unsupported_host");
});

test("governed workflow and measured host conditions refuse without effects", async t => {
  const f = fixture(t);
  for (const [key, value] of [["GITHUB_ACTIONS", "false"], ["GITHUB_REPOSITORY", "elsewhere/repo"], ["GITHUB_REF", "refs/heads/topic"], ["GITHUB_SHA", TREE], ["GITHUB_WORKFLOW_REF", "hraness/aicharts/.github/workflows/other.yml@refs/heads/main"], ["GITHUB_RUN_ID", "01"], ["GITHUB_RUN_ATTEMPT", "0"], ["ImageVersion", "today"]]) {
    const changed = { ...f.host, env: { ...f.host.env, [key]: value } };
    assert.equal((await internals.runWith(f.input, changed)).ok, false);
    assert.equal(fs.existsSync(f.input.outputDirectory), false);
  }
  assert.equal((await internals.runWith(f.input, { ...f.host, readFile: () => bytes("ID=ubuntu\nVERSION_ID=\"24.04\"\n") })).error, "unsupported_host");
  assert.equal(f.calls.length, 0);
});

test("output is create-new and requires a nonsymlink private owned parent", t => {
  const f = fixture(t);
  fs.mkdirSync(f.input.outputDirectory);
  assert.throws(() => internals.prepareOutput(f.input.outputDirectory), { code: "destination_exists" });
  const shared = join(f.root, "shared"); fs.mkdirSync(shared, { mode: 0o755 }); fs.chmodSync(shared, 0o755);
  assert.throws(() => internals.prepareOutput(join(shared, "result")), { code: "unsupported_destination" });
  const link = join(f.root, "linked"); fs.symlinkSync(shared, link);
  assert.throws(() => internals.prepareOutput(join(link, "result")), { code: "unsupported_destination" });
});

test("minimal compiler environment fixes baseline and excludes inherited secrets and overrides", () => {
  const dirs = { source: "/owned/source", cargo: "/owned/cargo", tmp: "/owned/tmp" };
  const selected = internals.minimalEnvironment(dirs, SYSROOT + "/bin/rustc");
  assert.equal(selected.HRANESS_SUPPORT_AUDIENCE, "off");
  for (const forbidden of ["GITHUB_TOKEN", "RUSTFLAGS", "LD_PRELOAD", "RUSTC_WRAPPER", "CARGO_REGISTRIES_CRATES_IO_TOKEN", "HOME", "LIBSQLITE3_SYS_USE_PKG_CONFIG"]) assert.equal(Object.hasOwn(selected, forbidden), false);
  const flags = selected.CARGO_ENCODED_RUSTFLAGS.split("\x1f");
  for (const expected of ["target-cpu=x86-64", "linker=/usr/bin/gcc-11", "linker-features=-lld", "link-self-contained=-linker", "link-arg=-fuse-ld=bfd"]) assert.ok(flags.includes(expected));
  assert.equal(flags.some(value => value.includes("native")), false); assert.ok(selected.CFLAGS.startsWith("-march=x86-64 -mtune=generic"));
});

test("source admission adds only the full reviewed support Git revision", t => {
  const f = fixture(t), lock = f.source.sourceFiles.find(file => file.path === "Cargo.lock");
  for (const source of ["registry+https://github.com/rust-lang/crates.io-index", SUPPORT_SOURCE]) {
    lock.bytes = bytes(`version = 4\n[[package]]\nsource = "${source}"\n`);
    assert.equal(internals.checkSource(f.source), "0.1.0");
  }
  for (const source of [SUPPORT_SOURCE.replace("ed89e584", "00000000"), SUPPORT_SOURCE.replace("hraness/", "other/"),
    "git+https://github.com/hraness/support-foundation#main", "git+https://example.invalid/private"]) {
    lock.bytes = bytes(`version = 4\n[[package]]\nsource = "${source}"\n`);
    assert.throws(() => internals.checkSource(f.source), { code: "unsupported_source" });
  }
});

test("ELF policy discriminates architecture, interpreter, dependency, stack, version and ISA failures", () => {
  const good = internals.inspectElf(elfBytes(), elfOutput());
  assert.deepEqual(good.dependencies, ["libc.so.6", "libgcc_s.so.1"]); assert.equal(good.maxGlibc, "2.34");
  assert.equal(internals.compareVersion("2.9", "2.35") < 0, true);
  assert.equal(internals.inspectElf(elfBytes(), { ...elfOutput(), notes: "" }).isa, null);
  const wrongArch = elfBytes(); wrongArch.writeUInt16LE(183, 18);
  const refuses = (binary, value, broadCode, predicate) => assert.throws(() => internals.inspectElf(binary, value), error => {
    assert.equal(error.code, broadCode); assert.equal(error.diagnostic.module, "elf"); assert.equal(error.diagnostic.code, predicate); return true;
  });
  refuses(wrongArch, elfOutput(), "elf_invalid", "binary_identity");
  refuses(Buffer.alloc(2), elfOutput(), "elf_invalid", "binary_identity");
  for (const [broadCode, predicate, mutate] of [
    ["elf_invalid", "header_identity", value => { value.header = "unknown header"; }],
    ["elf_invalid", "interpreter", value => { value.program = value.program.replace(INTERPRETER, "/tmp/loader"); }],
    ["elf_invalid", "interpreter", value => { value.program += " INTERP extra\n"; }],
    ["elf_invalid", "stack", value => { value.program = value.program.replace(" RW ", " RWE "); }],
    ["elf_invalid", "stack", value => { value.program += " GNU_STACK RW\n"; }],
    ...["RPATH", "RUNPATH", "TEXTREL"].map(tag => ["elf_invalid", "dynamic_search_path", value => { value.dynamic += " (" + tag + ") [/tmp]\n"; }]),
    ["runtime_invalid", "dependency_count", value => { value.dynamic = ""; }],
    ["runtime_invalid", "dependency_count", value => { value.dynamic = " (NEEDED) Shared library: [libc.so.6]\n".repeat(17); }],
    ["runtime_invalid", "duplicate_dependency", value => { value.dynamic += " (NEEDED) Shared library: [libc.so.6]\n"; }],
    ["runtime_invalid", "unsupported_dependency", value => { value.dynamic = value.dynamic.replace("libc.so.6", "libssl.so.3"); }],
    ["runtime_invalid", "unsupported_dependency", value => { value.dynamic += " (NEEDED) Shared library: [ld-linux-aarch64.so.1]\n"; }],
    ["runtime_invalid", "unsupported_dependency", value => { value.dynamic += " (NEEDED) Shared library: [" + INTERPRETER + "]\n"; }],
    ["runtime_invalid", "version_file_not_needed", value => { value.versions = value.versions.replace("File: libc.so.6", "File: libm.so.6"); }],
    ["runtime_invalid", "version_without_file", value => { value.versions = "Name: GLIBC_2.34 Flags: none\n"; }],
    ["runtime_invalid", "unsupported_version", value => { value.versions = value.versions.replace("GLIBC_2.34", "GLIBC_PRIVATE"); }],
    ["runtime_invalid", "unsupported_version", value => { value.versions = value.versions.replace("GLIBC_2.34", "GLIBC_ABI_DT_RELR"); }],
    ["runtime_invalid", "missing_glibc_requirement", value => { value.versions = value.versions.replaceAll("GLIBC_", "GCC_"); }],
    ["runtime_invalid", "glibc_floor", value => { value.versions = value.versions.replace("GLIBC_2.34", "GLIBC_2.36"); }],
    ["elf_invalid", "isa_note_count", value => { value.notes += value.notes; }],
    ["elf_invalid", "unsupported_isa_note", value => { value.notes = value.notes.replace("x86-64-baseline", "x86-64-v2"); }],
  ]) { const value = elfOutput(); mutate(value); refuses(elfBytes(), value, broadCode, predicate); }
  // The legitimate loader does not excuse another unknown dependency or let
  // dependency validation precede the existing binary/search-path checks.
  const combined = elfOutput(); combined.dynamic += " (NEEDED) Shared library: [ld-linux-x86-64.so.2]\n (NEEDED) Shared library: [a-unknown]\n";
  refuses(elfBytes(), combined, "runtime_invalid", "unsupported_dependency");
  combined.dynamic += " (RUNPATH) [/tmp]\n";
  refuses(elfBytes(), combined, "elf_invalid", "dynamic_search_path");
  refuses(wrongArch, combined, "elf_invalid", "binary_identity");
});

test("ELF diagnostic projection caps observations and never copies arbitrary tool strings", () => {
  const canary = "SYNTHETIC_PRIVATE_ELF_STRING", value = elfOutput();
  value.header += canary; value.program += "/private/" + canary; value.notes += canary;
  value.dynamic += (" (NEEDED) Shared library: [" + canary + "]\n").repeat(100);
  value.versions += ("File: " + canary + " Cnt: 1\nName: " + canary + " Flags: none\n").repeat(100);
  value.versions += "Name: GLIBC_" + "9".repeat(10000) + ".1 Flags: none\nName: GLIBC_PRIVATE Flags: none\nName: GLIBC_ABI_DT_RELR Flags: none\n";
  for (let i = 0; i < 100; i++) value.versions += "Name: GLIBC_2." + i + " Flags: none\n";
  assert.throws(() => internals.inspectElf(elfBytes(), value), error => {
    const diagnostic = error.diagnostic, observed = diagnostic.observed;
    assert.equal(diagnostic.code, "dependency_count");
    assert.deepEqual(Object.keys(diagnostic).sort(), ["code", "module", "observed"]);
    assert.deepEqual(observed.knownNeeded, ["libc.so.6", "libgcc_s.so.1"]);
    assert.equal(observed.neededCountCappedAt17, 17); assert.equal(observed.unknownNeededCountCappedAt17, 17);
    assert.equal(observed.duplicateNeededCountCappedAt17, 17);
    assert.deepEqual(observed.knownVersionFiles, ["libc.so.6", "libgcc_s.so.1"]);
    assert.equal(observed.versionFileCountCappedAt17, 17); assert.equal(observed.unknownVersionFileCountCappedAt17, 17);
    assert.equal(observed.versionNameCountCappedAt65, 65); assert.equal(observed.unknownVersionNameCountCappedAt65, 65);
    assert.equal(observed.versionNames.length, 64); assert.equal(observed.versionNamesTruncated, true);
    for (const special of ["GLIBC_PRIVATE", "GLIBC_ABI_DT_RELR"]) assert.ok(observed.versionNames.includes(special));
    for (const name of observed.versionNames) assert.match(name, /^(?:(?:GLIBC|GCC)_[0-9]{1,3}(?:\.[0-9]{1,3}){1,2}|GLIBC_PRIVATE|GLIBC_ABI_DT_RELR)$/u);
    const json = JSON.stringify(diagnostic);
    assert.equal(json.includes(canary), false); assert.equal(json.includes("/private/"), false); assert.equal(json.includes("9".repeat(100)), false);
    assert.ok(Buffer.byteLength(json) < 2500); return true;
  });
});

test("ELF failure summary retains a safe precise predicate but cannot qualify or reach runtime smoke", async t => {
  const f = fixture(t), canary = "SYNTHETIC_PRIVATE_ELF_STRING";
  f.output.dynamic += " (NEEDED) Shared library: [ld-linux-x86-64.so.2]\n";
  f.output.versions += "File: " + canary + " Cnt: 1\nName: " + canary + " Flags: none\n";
  for (const key of Object.keys(f.output)) f.output[key] += "\n/private/" + canary + "\n";
  assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "runtime_invalid" });
  const summaryBytes = fs.readFileSync(join(f.input.outputDirectory, "summary.json")), summary = JSON.parse(summaryBytes);
  assert.equal(summary.checksPassed, false); assert.equal(summary.error, "runtime_invalid");
  assert.equal(summary.diagnostic.module, "elf"); assert.equal(summary.diagnostic.code, "version_file_not_needed");
  assert.deepEqual(summary.diagnostic.observed.knownNeeded, ["ld-linux-x86-64.so.2", "libc.so.6", "libgcc_s.so.1"]);
  assert.equal(summary.diagnostic.observed.unknownVersionFileCountCappedAt17, 1);
  assert.equal(summary.diagnostic.observed.unknownVersionNameCountCappedAt65, 1);
  for (const privateText of [canary, f.root, "SYNTHETIC_NEVER_FORWARD"]) assert.equal(summaryBytes.includes(privateText), false);
  assert.equal(f.stages.at(-1), "elf-notes"); assert.equal(f.notices.length, 0);
  for (const file of ["qualification.json", "assets"]) assert.equal(fs.existsSync(join(f.input.outputDirectory, file)), false);
});

test("Cargo final-artifact selection binds package, fresh single build and exact output", () => {
  const dirs = { source: "/owned/source", target: "/owned/target" };
  const metadata = bytes(JSON.stringify({ packages: [{ name: "aicharts-cli", id: "cli", version: "0.1.0", manifest_path: dirs.source + "/crates/aicharts-cli/Cargo.toml" }] }));
  const artifact = { reason: "compiler-artifact", package_id: "cli", target: { name: "aicharts", kind: ["bin"] }, profile: { test: false }, executable: dirs.target + "/" + TARGET + "/release/aicharts", fresh: false };
  const messages = value => bytes(JSON.stringify(value) + "\n" + JSON.stringify({ reason: "build-finished", success: true }) + "\n");
  assert.equal(internals.compilerArtifact(metadata, messages(artifact), dirs, "0.1.0"), artifact.executable);
  for (const altered of [{ ...artifact, fresh: true }, { ...artifact, executable: "/tmp/other" }, { ...artifact, profile: { test: true } }, { ...artifact, package_id: "other" }]) assert.throws(() => internals.compilerArtifact(metadata, messages(altered), dirs, "0.1.0"));
});

test("synthetic orchestration crosses real source hydration, archive validation and create-new install", async t => {
  const f = fixture(t);
  assert.equal((await internals.runWith(f.input, f.host)).ok, true);
  const actual = fs.readdirSync(join(f.input.outputDirectory, "assets")).sort();
  assert.deepEqual(actual, ["SHA256SUMS", "aicharts-0.1.0-" + TARGET + ".tar.gz", "aicharts-skill-0.1.0.tar.gz", "aicharts-source-0.1.0.tar.gz", "release-manifest.json"].sort());
  const report = validateLinuxQualificationReport(fs.readFileSync(join(f.input.outputDirectory, "qualification.json")));
  assert.equal(report.ok, true); assert.equal(report.value.value.smoke.invocations, 18);
  const summary = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json")));
  assert.equal(summary.checksPassed, true); assert.equal(Object.hasOwn(summary, "qualified"), false);
  assert.equal(JSON.stringify(summary).includes(f.root), false); assert.equal(summary.compatibility.universalBaselineExecutionProven, false);
  const builds = f.calls.filter(call => call.args[0] === "rustc"); assert.equal(builds.length, 1);
  assert.ok(builds[0].args.includes("--frozen")); assert.ok(builds[0].args.at(-1).startsWith("link-arg=-Wl,-Map="));
  const metadata = f.calls.find(call => call.args[0] === "metadata"); assert.ok(metadata.args.includes("--offline")); assert.equal(metadata.args.at(-1), TARGET);
  assert.equal(f.calls.filter(call => call.args[0] === "fetch").length, 1);
  assert.equal(f.notices.length, 1); assert.ok(f.notices[0].dynamicLibraries.some(library => library.soname === "ld-linux-x86-64.so.2"));
  assert.equal(sha(fs.readFileSync(join(f.input.outputDirectory, "install/aicharts-0.1.0-" + TARGET + "/bin/aicharts"))), sha(elfBytes()));
  const statsCalls = f.calls.filter(call => call.args[0] === "stats");
  assert.equal(statsCalls.length, 2);
  assert.deepEqual(statsCalls.map(call => call.args[8]), ["2026-09-10", "2026-09-11"]);
});

test("installed stats totals, reported basis, coverage and date scope are required before qualification", async t => {
  const mutations = [
    report => { report.rows[0].tokens.cacheRead = "0"; },
    report => { report.rows[1].tokenBasis = "estimated"; },
    report => { report.sources[0].status = "incomplete"; },
    report => { report.sources[0].records = 0; },
    report => { report.sources[1].latestAtMs += 86_400_000; },
    report => { report.dayCount = 30; },
    report => { report.rows[0].privateField = "must not pass"; },
  ];
  for (const mutate of mutations) {
    const f = fixture(t), original = f.host.execute;
    f.host.execute = async (executable, args, options) => {
      const response = await original(executable, args, options);
      if (args[0] === "stats" && args[8] === "2026-09-10") {
        const report = JSON.parse(response.stdout); mutate(report); response.stdout = bytes(JSON.stringify(report));
      }
      return response;
    };
    assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "smoke_failed" });
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
    assert.equal(f.stages.includes("persist-assets"), false);
  }
});

test("upload smoke fixture refuses the obsolete fresh-source syntax", async t => {
  const f = fixture(t);
  await assert.rejects(f.host.execute("/synthetic/aicharts", ["upload", "--key-file", "key", "--codex", "codex.jsonl", "--claude", "claude.jsonl"], {
    cwd: join(f.input.outputDirectory, "smoke"), env: { PATH: "/usr/bin:/bin" }, timeoutMs: 1000, maxBytes: 1024,
  }), { code: "ERR_ASSERTION" });
});

test("Linux upload must refuse through custody without changing the synthetic key or ledger", async t => {
  for (const fault of ["old_refusal", "invalid_option", "unexpected_output", "success", "state", "key", "key_mode"]) {
    const f = fixture(t), execute = f.host.execute;
    f.host.execute = async (executable, args, options) => {
      const response = await execute(executable, args, options);
      if (args[0] === "upload" && !args.includes("--dry-run")) {
        assert.deepEqual(args, ["upload", "--state-dir", "state", "--key-file", "key"]);
        if (fault === "old_refusal") response.stderr = bytes("aicharts: upload_not_enabled_use_dry_run\n");
        if (fault === "invalid_option") response.stderr = bytes("aicharts: invalid_option\n");
        if (fault === "unexpected_output") response.stdout = bytes("unexpected output\n");
        if (fault === "success") { response.status = 0; response.stderr = bytes(""); }
        if (fault === "state") fs.appendFileSync(join(options.cwd, "state/usage.sqlite3"), "unexpected mutation");
        if (fault === "key") fs.writeFileSync(join(options.cwd, "key"), Buffer.alloc(32, 9));
        if (fault === "key_mode") fs.chmodSync(join(options.cwd, "key"), 0o644);
      }
      return response;
    };
    assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "smoke_failed" });
    assert.equal(f.stages.at(-1), "smoke-13"); assert.equal(f.notices.length, 0);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
  }
});

test("empty stats windows cannot invent observed coverage or retain out-of-range rows", async t => {
  for (const mutate of [report => { report.sources[0].status = "observed"; }, report => { report.rows = statsReport(true).rows; }]) {
    const f = fixture(t), original = f.host.execute;
    f.host.execute = async (executable, args, options) => {
      const response = await original(executable, args, options);
      if (args[0] === "stats" && args[8] === "2026-09-11") {
        const report = JSON.parse(response.stdout); mutate(report); response.stdout = bytes(JSON.stringify(report));
      }
      return response;
    };
    assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "smoke_failed" });
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
  }
});

test("installed stats must preserve source bytes and withhold the transcript canary", async t => {
  for (const leak of [false, true]) {
    const f = fixture(t), original = f.host.execute;
    f.host.execute = async (executable, args, options) => {
      const response = await original(executable, args, options);
      if (args[0] === "stats" && args[8] === "2026-09-11") {
        if (leak) response.stdout = Buffer.concat([response.stdout, bytes("QUALIFICATION_PRIVATE_CANARY_c7d84")]);
        else fs.appendFileSync(join(args[2], ".codex/sessions/codex.jsonl"), "\n");
      }
      return response;
    };
    assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "smoke_failed" });
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
  }
});

test("complete synthetic notices above 16 MiB cross runner assembly and installed-byte verification", async t => {
  const f = fixture(t), section = Buffer.alloc(8 * 1024 * 1024, 0x4e);
  const data = Buffer.concat([bytes("SYNTHETIC TEST ONLY: not qualified licenses\n"),
    bytes("\n===== Synthetic section one =====\nSHA-256: " + sha(section) + "\n\n"), section,
    bytes("\n===== Synthetic section two =====\nSHA-256: " + sha(section) + "\n\n"), section, bytes("\n")]);
  const expected = { bytes: data.length, sha256: sha(data) };
  assert.ok(data.length > 16 * 1024 * 1024 && data.length < LINUX_NOTICES_MAX_BYTES);
  f.host.collectNotices = async () => ok({ bytes: data, sha256: expected.sha256, components: 2 });
  assert.equal((await internals.runWith(f.input, f.host)).ok, true);
  const report = validateLinuxQualificationReport(fs.readFileSync(join(f.input.outputDirectory, "qualification.json")));
  assert.equal(report.ok, true);
  assert.deepEqual(report.value.value.notices, { complete: true, ...expected });
  assert.equal(report.value.value.smoke.invocations, 18);
  const manifest = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "assets/release-manifest.json")));
  const cli = manifest.assets.find(asset => asset.kind === "cli");
  const installed = fs.readFileSync(join(f.input.outputDirectory, "install", cli.root, "THIRD_PARTY_LICENSES.txt"));
  assert.equal(installed.length, expected.bytes); assert.equal(sha(installed), expected.sha256);
  const summary = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json")));
  assert.equal(summary.checksPassed, true); assert.deepEqual(summary.notices, expected);
});

async function assertNoticeOutputRefused(f, reason, count) {
  assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "notices_incomplete" });
  assert.equal(f.stages.includes("assembly"), false);
  assert.equal(f.calls.some(call => call.executable.includes("/install/")), false);
  assert.deepEqual(fs.readdirSync(join(f.input.outputDirectory, "install")), []);
  assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
  assert.equal(fs.existsSync(join(f.input.outputDirectory, "assets")), false);
  const summary = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json")));
  assert.equal(summary.checksPassed, false); assert.equal(summary.error, "notices_incomplete");
  assert.deepEqual(summary.diagnostic, { module: "notices", code: "notices_output_invalid", reason, bytesCappedAtLimitPlusOne: count });
  assert.equal(JSON.stringify(summary).includes("SYNTHETIC_PRIVATE_NOTICE"), false);
  assert.equal(JSON.stringify(summary).includes(f.root), false);
}

test("shared notice bound accepts exactly 64 MiB and refuses larger output before assembly", async t => {
  assert.equal(LINUX_NOTICES_MAX_BYTES, 64 * 1024 * 1024);
  // One allocation and a pure gate check cover the exact boundary; only the
  // smaller above-16-MiB fixture performs full archive assembly and installation.
  const data = Buffer.alloc(LINUX_NOTICES_MAX_BYTES + 2, 0x4e);
  const boundary = data.subarray(0, LINUX_NOTICES_MAX_BYTES);
  assert.equal(internals.noticeOutputDiagnostic({ bytes: boundary, sha256: sha(boundary) }), null);
  const f = fixture(t);
  f.host.collectNotices = async () => ok({ bytes: data, sha256: sha(data), components: 1 });
  await assertNoticeOutputRefused(f, "byte_limit", LINUX_NOTICES_MAX_BYTES + 1);
});

test("empty, malformed and mismatched notice outputs retain only safe refusal evidence", async t => {
  let accessorCalls = 0;
  const privateText = "SYNTHETIC_PRIVATE_NOTICE", data = bytes(privateText);
  const accessor = key => Object.defineProperty({ bytes: data }, key, { configurable: true, get() { accessorCalls++; throw new Error(privateText); } });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { accessorCalls++; throw new Error(privateText); } });
  for (const [value, reason, count] of [
    [null, "wrong_type", null],
    [{ bytes: privateText }, "wrong_type", null],
    [{ bytes: new Uint8Array(data) }, "wrong_type", null],
    [accessor("bytes"), "wrong_type", null],
    [proxy, "wrong_type", null],
    [{ bytes: Buffer.alloc(0), sha256: sha(Buffer.alloc(0)) }, "empty", 0],
    [{ bytes: data, sha256: privateText }, "hash_mismatch", data.length],
    [accessor("sha256"), "hash_mismatch", data.length],
  ]) {
    const f = fixture(t); f.host.collectNotices = async () => ok(value);
    await assertNoticeOutputRefused(f, reason, count);
  }
  assert.equal(accessorCalls, 0);
});

test("incomplete notices retain diagnostic evidence without successful receipt or assets", async t => {
  const f = fixture(t); f.host.collectNotices = async () => ({ ok: false, error: "notices_rust_missing" });
  const outcome = await internals.runWith(f.input, f.host); assert.deepEqual(outcome, { ok: false, error: "notices_incomplete" });
  assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
  assert.equal(fs.existsSync(join(f.input.outputDirectory, "assets")), false);
  const summary = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json")));
  assert.equal(summary.error, "notices_incomplete");
  assert.deepEqual(summary.diagnostic, { module: "notices", code: "notices_rust_missing" });
  assert.ok(fs.readdirSync(join(f.input.outputDirectory, "evidence")).some(name => name.includes("cargo-build")));
});

test("unknown native diagnostics preserve only fixed categories in the failed summary", async t => {
  let accessorCalls = 0;
  for (const category of ["build_script_links", "generated_archive_load", "scratch_load", "system_library", "SYNTHETIC_PRIVATE_PATH", null]) {
    const f = fixture(t), result = { ok: false, error: "notices_unknown_native", path: "SYNTHETIC_PRIVATE_PATH" };
    if (category === null) Object.defineProperty(result, "nativeCategory", { get() { accessorCalls++; throw new Error("SYNTHETIC_PRIVATE_PATH"); } });
    else result.nativeCategory = category;
    f.host.collectNotices = async () => result;
    assert.equal((await internals.runWith(f.input, f.host)).error, "notices_incomplete");
    const summary = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json")));
    assert.deepEqual(summary.diagnostic, { module: "notices", code: "notices_unknown_native",
      ...(["build_script_links", "generated_archive_load", "scratch_load", "system_library"].includes(category) ? { nativeCategory: category } : {}) });
    assert.equal(JSON.stringify(summary).includes("SYNTHETIC_PRIVATE_PATH"), false);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "assets")), false);
  }
  assert.equal(accessorCalls, 0);
});

test("system notice failures retain only fixed locations and cannot assemble or install", async t => {
  let accessorCalls = 0, effects = 0;
  const admitted = ["package_query", "package_query_terminated", "package_query_output_limit", "package_owner", "package_record", "copyright_path", "copyright_read", "gcc_exception", "common_reference_prefix", "common_reference_delimiter", "common_reference_name", "common_license_path", "common_license_read"];
  for (const category of [...admitted, "SYNTHETIC_PRIVATE_PATH", null]) {
    const f = fixture(t), result = { ok: false, error: "notices_system_missing", output: "SYNTHETIC_PRIVATE_PATH" };
    if (category === null) Object.defineProperty(result, "systemCategory", { get() { accessorCalls++; throw new Error("SYNTHETIC_PRIVATE_PATH"); } });
    else result.systemCategory = category;
    f.host.collectNotices = async () => result;
    f.host.assemble = () => { effects++; throw new Error("assembly must not run"); };
    assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "notices_incomplete" });
    const summary = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json")));
    assert.deepEqual(summary.diagnostic, { module: "notices", code: "notices_system_missing",
      ...(admitted.includes(category) ? { systemCategory: category } : {}) });
    assert.equal(summary.stages.at(-1), "notices");
    assert.equal(JSON.stringify(summary).includes("SYNTHETIC_PRIVATE_PATH"), false);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "assets")), false);
    assert.equal(f.calls.some(call => call.executable.startsWith(join(f.input.outputDirectory, "install") + "/")), false);
  }
  assert.equal(effects, 0);
  assert.equal(accessorCalls, 0);
});

test("module diagnostics retain only fixed allowlisted codes", async t => {
  for (const code of ["git_failed", "SYNTHETIC_PRIVATE_ERROR_PATH"]) {
    const f = fixture(t); f.host.readSource = () => ({ ok: false, error: code });
    assert.equal((await internals.runWith(f.input, f.host)).error, "source_failed");
    const summary = JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json")));
    assert.deepEqual(summary.diagnostic, { module: "source", code: code === "git_failed" ? code : "unclassified_module_failure" });
    assert.equal(JSON.stringify(summary).includes("SYNTHETIC_PRIVATE_ERROR_PATH"), false);
    assert.equal(f.calls.length, 0);
  }
});

test("post-smoke installed binary or BUILD mutation cannot receive qualification", async t => {
  for (const member of ["bin/aicharts", "BUILD.json"]) {
    const f = fixture(t); const original = f.host.execute;
    f.host.execute = async (executable, args, options) => {
      const observed = await original(executable, args, options);
      if (executable.includes("/install/") && args[0] === "--help") {
        const root = dirname(dirname(executable));
        assert.equal(fs.existsSync(join(root, member)), true);
        fs.appendFileSync(join(root, member), "mutation after successful smoke");
      }
      return observed;
    };
    assert.equal((await internals.runWith(f.input, f.host)).error, "install_failed");
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "assets")), false);
  }
});

test("source mutation after compilation refuses before assembly", async t => {
  const f = fixture(t); const original = f.host.progress;
  f.host.progress = stage => { original(stage); if (stage === "source-recheck") fs.writeFileSync(join(f.input.outputDirectory, "source/extra.txt"), "unexpected source member"); };
  assert.equal((await internals.runWith(f.input, f.host)).error, "source_changed");
  assert.equal(fs.existsSync(join(f.input.outputDirectory, "assets")), false);
  assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
});

test("bad notice hash and post-assembly corruption cannot be installed or qualified", async t => {
  for (const corruption of ["notice", "archive"]) {
    const f = fixture(t);
    if (corruption === "notice") f.host.collectNotices = async () => ok({ bytes: bytes("notice"), sha256: "0".repeat(64), components: 1 });
    else f.host.assemble = input => { const value = assembleLinuxRelease(input); assert.equal(value.ok, true); value.value.files.find(file => file.name.endsWith(TARGET + ".tar.gz")).bytes[20] ^= 1; return value; };
    assert.equal((await internals.runWith(f.input, f.host)).ok, false);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
  }
});

test("wrong toolchain stops before dependency fetch or compilation", async t => {
  const f = fixture(t); const original = f.host.execute;
  f.host.execute = async (executable, args, options) => executable.endsWith("/bun") ? result("1.3.15\n") : original(executable, args, options);
  assert.equal((await internals.runWith(f.input, f.host)).error, "toolchain_mismatch");
  assert.equal(f.calls.some(call => ["fetch", "rustc"].includes(call.args[0])), false);
});

test("failed build records bounded public-source stage logs and cannot reach smoke", async t => {
  const f = fixture(t); const original = f.host.execute;
  f.host.execute = async (executable, args, options) => args[0] === "rustc" ? result("", 101, "synthetic compile failure\n") : original(executable, args, options);
  assert.equal((await internals.runWith(f.input, f.host)).error, "build_failed");
  assert.equal(f.stages.some(stage => stage.startsWith("smoke-")), false);
  assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
});

test("final receipt is create-only and never overwrites a competing destination", async t => {
  const f = fixture(t); const original = f.host.progress;
  f.host.progress = stage => { original(stage); if (stage === "persist-assets") fs.writeFileSync(join(f.input.outputDirectory, "qualification.json"), "occupied"); };
  assert.equal((await internals.runWith(f.input, f.host)).ok, false);
  assert.equal(fs.readFileSync(join(f.input.outputDirectory, "qualification.json"), "utf8"), "occupied");
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(join(f.input.outputDirectory, "summary.json"))), "qualified"), false);
});

test("regular-file readers refuse links and source recheck refuses extra membership", t => {
  const f = fixture(t); const file = join(f.root, "file"); fs.writeFileSync(file, "abc"); fs.symlinkSync(file, join(f.root, "link"));
  assert.equal(internals.readRegular(file, 3).toString(), "abc");
  assert.throws(() => internals.readRegular(join(f.root, "link"), 3), { code: "artifact_invalid" });
  assert.throws(() => internals.readRegular(file, 2), { code: "artifact_invalid" });
  const root = join(f.root, "hydrated"); assert.equal(hydrateReleaseSource({ destinationDirectory: root, sourceFiles: [{ path: "file", mode: 0o644, bytes: bytes("abc") }] }).ok, true);
  internals.recheckSource(root, [{ path: "file", mode: 0o644, bytes: bytes("abc") }], f.host);
  fs.mkdirSync(join(root, "unexpected")); assert.throws(() => internals.recheckSource(root, [{ path: "file", mode: 0o644, bytes: bytes("abc") }], f.host), { code: "source_changed" });
});

test("real bounded child capture preserves status and refuses excess output and deadlines", async t => {
  const f = fixture(t); const options = { cwd: f.root, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeoutMs: 2000, maxBytes: 64 };
  const success = await internals.execute(process.execPath, ["-e", "process.stdout.write('ok'); process.stderr.write('diagnostic'); process.exitCode = 7"], options);
  assert.equal(success.status, 7); assert.equal(success.stdout.toString(), "ok"); assert.equal(success.stderr.toString(), "diagnostic");
  await assert.rejects(internals.execute(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024)); setInterval(() => {}, 1000)"], options), { code: "process_output_limit" });
  await assert.rejects(internals.execute(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { ...options, timeoutMs: 100 }), { code: "process_timeout" });
});


test("compiler artifact diagnostics identify one-byte excess without exposing paths or bytes", async t => {
  for (const [kind, stage, maximumBytes] of [["executable", "measure-executable", 64 * 1024 * 1024], ["link_map", "read-link-map", LINUX_LINK_MAP_MAX_BYTES]]) {
    const f = fixture(t), execute = f.host.execute;
    f.host.execute = async (executable, args, options) => {
      const outcome = await execute(executable, args, options);
      if (args[0] === "rustc") {
        const file = kind === "executable" ? join(f.input.outputDirectory, "target", TARGET, "release/aicharts") : args.at(-1).slice("link-arg=-Wl,-Map=".length);
        fs.truncateSync(file, maximumBytes + 1);
      }
      return outcome;
    };
    assert.deepEqual(await internals.runWith(f.input, f.host), { ok: false, error: "artifact_invalid" });
    const summaryText = fs.readFileSync(join(f.input.outputDirectory, "summary.json"), "utf8"), summary = JSON.parse(summaryText);
    assert.deepEqual(summary.diagnostic, { module: "artifact", code: "artifact_read_invalid", kind, reason: "byte_limit", maximumBytes,
      observedBytes: maximumBytes + 1, sizeSaturated: false, telemetryMaximumBytes: 1024 * 1024 * 1024 });
    assert.equal(summary.stages.at(-1), stage); assert.equal(summary.checksPassed, false);
    assert.equal(f.calls.some(call => call.executable === "/usr/bin/readelf"), false);
    assert.equal(f.notices.length, 0);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), false);
    assert.equal(summaryText.includes(f.root) || summaryText.includes("SYNTHETIC_NEVER_FORWARD"), false);
  }
});

test("artifact diagnostics retain regular-file guards and cap only their size telemetry", t => {
  const f = fixture(t), file = join(f.root, "PRIVATE_PATH_CANARY"), maximumBytes = LINUX_LINK_MAP_MAX_BYTES;
  fs.writeFileSync(file, "PRIVATE_CONTENT_CANARY");
  const diagnostic = (selected, cap = maximumBytes, executable = false) => {
    let failure; try { internals.readRegular(selected, cap, executable); } catch (error) { failure = error; }
    assert.ok(failure); return internals.artifactReadDiagnostic(failure, "link_map", cap);
  };
  fs.symlinkSync(file, join(f.root, "link")); assert.equal(diagnostic(join(f.root, "link")).reason, "not_regular");
  assert.equal(diagnostic(file, maximumBytes, true).reason, "not_executable");
  const missing = diagnostic(join(f.root, "missing")); assert.equal(missing.reason, "io_failed"); assert.equal(missing.observedBytes, null);
  fs.truncateSync(file, 1024 * 1024 * 1024 + 137);
  const large = diagnostic(file); assert.equal(large.observedBytes, 1024 * 1024 * 1024); assert.equal(large.sizeSaturated, true);
  assert.equal(large.maximumBytes, maximumBytes); assert.equal(large.reason, "byte_limit");
  assert.equal(JSON.stringify([missing, large]).includes("PRIVATE_"), false);
  const arbitrary = internals.artifactReadDiagnostic(Object.assign(new Error("PRIVATE_ERROR_CANARY"), { reason: "PRIVATE_REASON_CANARY", observedBytes: 1 }), "link_map", maximumBytes);
  assert.equal(arbitrary.reason, "io_failed"); assert.equal(arbitrary.observedBytes, null); assert.equal(JSON.stringify(arbitrary).includes("PRIVATE_"), false);
});

test("runner delivers complete linker maps above 8 MiB, at the measured fc95b51 size and at the collector boundary", async t => {
  assert.equal(LINUX_LINK_MAP_MAX_BYTES, 64 * 1024 * 1024);
  // 33,690,505 bytes is the map that run 36066135869 refused under the old 32 MiB bound.
  for (const size of [8 * 1024 * 1024 + 1, 33_690_505, LINUX_LINK_MAP_MAX_BYTES]) {
    const f = fixture(t), execute = f.host.execute, collectNotices = f.host.collectNotices;
    const measuredMap = Buffer.alloc(size, 0x20);
    Buffer.from("Linker script and memory map\nLOAD SYNTHETIC_MAP_CANARY\n").copy(measuredMap);
    measuredMap[size - 1] = 0x0a;
    f.host.execute = async (executable, args, options) => {
      const result = await execute(executable, args, options);
      if (args[0] === "rustc") fs.writeFileSync(args.at(-1).slice("link-arg=-Wl,-Map=".length), measuredMap);
      return result;
    };
    f.host.collectNotices = async input => {
      assert.equal(input.linkMapBytes.length, size); assert.equal(input.linkMapBytes.equals(measuredMap), true);
      return await collectNotices(input);
    };
    assert.equal((await internals.runWith(f.input, f.host)).ok, true);
    assert.equal(f.notices.length, 1);
    const summaryText = fs.readFileSync(join(f.input.outputDirectory, "summary.json"), "utf8"), summary = JSON.parse(summaryText);
    assert.equal(summary.smokeInvocations, 18); assert.equal(summary.checksPassed, true);
    assert.equal(summaryText.includes("SYNTHETIC_MAP_CANARY"), false);
    assert.equal(fs.existsSync(join(f.input.outputDirectory, "qualification.json")), true);
  }
});
