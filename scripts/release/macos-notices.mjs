#!/usr/bin/env node
// Third-party notices for the macOS CLI archive. Every crate Cargo compiled for
// the build must be covered by the reviewed license policy that the Linux
// archive uses (distribution/cli/linux-notices.json), the admitted Git sources,
// or the vendored tokscale-core LICENSE; an unmapped crate or a changed license
// text fails the build. Rust toolchain and standard-library notices come from
// the pinned toolchain. macOS system frameworks are part of the operating
// system and are not redistributed.
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { admittedGitCrate, admittedGitSource } from "./admitted-git-sources.mjs";

const MiB = 1024 * 1024;
const REGISTRY = "registry+https://github.com/rust-lang/crates.io-index";
const LICENSE_FILE = /^(?:LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE)(?:[.-][A-Za-z0-9_.-]+)?$/iu;
const TOKSCALE_LICENSE_SHA256 = "24a794f325f7625b5f124945dedb6dcec8188f88e76bf4b99557b52d6cc77be9";
const HASH = /^[0-9a-f]{64}$/u;
export const MACOS_NOTICES_MAX_BYTES = 64 * MiB;
const MAX_SECTIONS = 1024;
const RUST_SOURCE_LICENSES = ["compiler-builtins/LICENSE.txt", "stdarch/LICENSE-MIT", "backtrace/LICENSE-MIT", "backtrace/LICENSE-APACHE"];
const HEADING = "AI Charts macOS CLI third-party notices\n\nSelected from actual Cargo artifacts, bundled SQLite, and Rust runtime source and toolchain notices. Build-only source notices are retained conservatively; this does not assert that all listed code is linked. macOS system frameworks are part of the operating system and are not distributed. Project LICENSE is distributed separately.\n";

const fail = code => { throw new Error(code); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, file) => file.startsWith(`${root}/`);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

async function read(file, max, code) {
  let info;
  try { info = await lstat(file); } catch { fail(code); }
  if (!info.isFile() || info.size === 0 || info.size > max || await realpath(file) !== file) fail(code);
  return readFile(file);
}

export async function collectMacosNotices({ source, messages, metadata, cargoHome, sysroot }) {
  const policy = JSON.parse(await read(path.join(source, "distribution/cli/linux-notices.json"), MiB, "notices_unmapped_crate"));
  if (policy.schemaVersion !== 1 || policy.registry !== REGISTRY || !Array.isArray(policy.packages)) fail("notices_unmapped_crate");
  const mapped = new Map(policy.packages.map(item => [`${item.name}@${item.version}`, item]));
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const compiled = new Set();
  for (const line of messages.split("\n")) {
    if (!line.startsWith("{")) continue;
    const message = JSON.parse(line);
    if (message.reason === "compiler-artifact") compiled.add(message.package_id);
  }
  if (!compiled.size) fail("notices_build_incomplete");
  const sections = new Map();
  let total = 0;
  const add = (label, bytes) => {
    if (sections.has(label)) {
      if (!sections.get(label).equals(bytes)) fail("notices_source_changed");
      return;
    }
    total += bytes.length;
    if (sections.size >= MAX_SECTIONS || total > 48 * MiB) fail("notices_limit");
    sections.set(label, bytes);
  };
  let sawBinary = false;
  for (const pkg of [...compiled].map(id => packages.get(id) ?? fail("notices_build_incomplete")).sort((a, b) => compare(a.name + a.version, b.name + b.version))) {
    if (pkg.source === null) {
      if (pkg.name === "tokscale-core") {
        if (pkg.manifest_path !== path.join(source, "vendor/tokscale-core/Cargo.toml") || pkg.license !== "MIT") fail("notices_unmapped_crate");
        const bytes = await read(path.join(source, "vendor/tokscale-core/LICENSE"), MiB, "notices_crate_changed");
        if (digest(bytes) !== TOKSCALE_LICENSE_SHA256) fail("notices_crate_changed");
        add(`Cargo ${pkg.name} ${pkg.version} (MIT) / LICENSE`, bytes);
        continue;
      }
      if (!inside(path.join(source, "crates"), pkg.manifest_path) || !/^aicharts(?:-[a-z]+)+$/u.test(pkg.name) || pkg.license !== "MIT") fail("notices_unmapped_crate");
      sawBinary ||= pkg.name === "aicharts-cli";
      continue; // Project LICENSE is a separate mandatory archive member.
    }
    if (admittedGitSource(pkg.source) !== null) {
      const admitted = admittedGitCrate(pkg.source, pkg.name);
      if (admitted === null || pkg.version !== admitted.version || pkg.license !== admitted.license) fail("notices_unmapped_crate");
      const directory = path.dirname(pkg.manifest_path), suffix = `/${admitted.crate}`;
      const checkout = directory.endsWith(suffix) ? directory.slice(0, -suffix.length) : null;
      if (checkout === null || !inside(path.join(cargoHome, "git/checkouts"), checkout)) fail("notices_crate_changed");
      let license;
      for (const [file, expected] of Object.entries(admitted.files)) {
        const bytes = await read(path.join(checkout, file), MiB, "notices_crate_changed");
        if (digest(bytes) !== expected) fail("notices_crate_changed");
        if (file === "LICENSE") license = bytes;
      }
      add(`Cargo ${pkg.name} ${pkg.version} (${admitted.license}) / LICENSE`, license ?? fail("notices_crate_changed"));
      continue;
    }
    const item = mapped.get(`${pkg.name}@${pkg.version}`);
    if (pkg.source !== REGISTRY || !item || item.license !== pkg.license || !Array.isArray(item.files) || !item.files.length) fail(`notices_unmapped_crate:${pkg.name}@${pkg.version}`);
    const directory = path.dirname(pkg.manifest_path);
    if (!inside(path.join(cargoHome, "registry/src"), directory) || path.basename(directory) !== `${pkg.name}-${pkg.version}`) fail("notices_crate_changed");
    for (const file of item.files) {
      const relative = path.normalize(file.path);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !HASH.test(file.sha256)
        || !(LICENSE_FILE.test(path.basename(relative)) || ["ring", "zstd-sys"].includes(pkg.name))) fail("notices_unmapped_crate");
      const bytes = await read(path.join(directory, relative), MiB, "notices_crate_changed");
      if (digest(bytes) !== file.sha256) fail(`notices_crate_changed:${pkg.name}@${pkg.version}`);
      add(`Cargo ${pkg.name} ${pkg.version} (${pkg.license}) / ${file.path}`, bytes);
    }
    if (pkg.name === "libsqlite3-sys") {
      const body = (await read(path.join(directory, "sqlite3/sqlite3.c"), 64 * MiB, "notices_crate_changed")).subarray(0, 8192).toString("utf8");
      const blessing = body.match(/\/\*\n\*\* 2001 September 15\n[\s\S]*?May you share freely, never taking more than you give\.[\s\S]*?\*\//u)?.[0];
      const version = body.match(/\*\* version ([0-9.]+)\./u)?.[1];
      if (!blessing || !version || !body.includes("The author disclaims copyright")) fail("notices_crate_changed");
      add(`SQLite ${version} amalgamation public-domain statement (bundled by ${pkg.name} ${pkg.version})`, Buffer.from(blessing + "\n"));
    }
  }
  if (!sawBinary) fail("notices_build_incomplete");
  for (const name of ["COPYRIGHT.html", "COPYRIGHT-library.html"]) {
    add(`Rust toolchain / ${name}`, await read(path.join(sysroot, "share/doc/rust", name), 16 * MiB, "notices_rust_missing"));
  }
  const licenses = path.join(sysroot, "share/doc/rust/licenses");
  const licenseEntries = await readdir(licenses, { withFileTypes: true }).catch(() => fail("notices_rust_missing"));
  if (!licenseEntries.length || licenseEntries.length > 128) fail("notices_rust_missing");
  for (const entry of licenseEntries.sort((a, b) => compare(a.name, b.name))) {
    if (!entry.isFile() || !/^[A-Za-z0-9_.+-]+\.txt$/u.test(entry.name)) fail("notices_rust_missing");
    add(`Rust REUSE license / ${entry.name}`, await read(path.join(licenses, entry.name), MiB, "notices_rust_missing"));
  }
  for (const name of ["MIT.txt", "Apache-2.0.txt", "Unicode-3.0.txt"]) if (!sections.has(`Rust REUSE license / ${name}`)) fail("notices_rust_missing");
  const library = path.join(sysroot, "lib/rustlib/src/rust/library");
  for (const file of RUST_SOURCE_LICENSES) add(`Rust standard-library source / ${file}`, await read(path.join(library, file), MiB, "notices_rust_missing"));
  // The Linux notices keep only vendored standard-library crates its link map
  // shows; without that map, keep every vendored crate's license texts.
  const vendor = path.join(library, "vendor");
  const vendors = await readdir(vendor, { withFileTypes: true }).catch(() => fail("notices_rust_missing"));
  if (!vendors.length || vendors.length > 256) fail("notices_rust_missing");
  for (const entry of vendors.sort((a, b) => compare(a.name, b.name))) {
    if (!entry.isDirectory()) continue;
    const files = (await readdir(path.join(vendor, entry.name), { withFileTypes: true })).filter(file => file.isFile() && LICENSE_FILE.test(file.name));
    for (const file of files.sort((a, b) => compare(a.name, b.name))) {
      add(`Rust vendored source ${entry.name} / ${file.name}`, await read(path.join(vendor, entry.name, file.name), MiB, "notices_rust_missing"));
    }
  }
  const chunks = [Buffer.from(HEADING)];
  for (const [label, bytes] of [...sections].sort(([a], [b]) => compare(a, b))) chunks.push(Buffer.from(`\n===== ${label} =====\nSHA-256: ${digest(bytes)}\n\n`), bytes, Buffer.from("\n"));
  const bytes = Buffer.concat(chunks);
  if (bytes.length > MACOS_NOTICES_MAX_BYTES) fail("notices_limit");
  return { bytes, components: sections.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: Object.fromEntries(["source", "messages", "metadata", "cargo-home", "sysroot", "output"].map(name => [name, { type: "string" }])) });
  try {
    for (const name of ["source", "messages", "metadata", "cargo-home", "sysroot", "output"]) if (!values[name] || !path.isAbsolute(values[name])) fail("notices_invalid_input");
    // Inputs are named once here, so resolve their directories; the reads
    // inside still refuse a symlinked license or policy file.
    const real = name => realpath(values[name]).catch(() => fail("notices_invalid_input"));
    const result = await collectMacosNotices({
      source: await real("source"), cargoHome: await real("cargo-home"), sysroot: await real("sysroot"),
      messages: (await read(await real("messages"), 256 * MiB, "notices_invalid_input")).toString("utf8"),
      metadata: JSON.parse(await read(await real("metadata"), 64 * MiB, "notices_invalid_input")),
    });
    await writeFile(values.output, result.bytes, { flag: "wx", mode: 0o644 });
    console.log(`notices: ${result.components} components, ${result.bytes.length} bytes`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "notices_invalid_input");
    process.exit(1);
  }
}
