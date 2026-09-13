// Linux build attribution, not a general license scanner or legal certification.
// The runner supplies actual Cargo/GNU bfd evidence from one clean, locked build.
// No publication, network, writes, environment inheritance, or caller completeness bit.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify, types } from "node:util";

const exec = promisify(execFile);
const MiB = 1024 * 1024;
const TARGET = "x86_64-unknown-linux-gnu";
const REGISTRY = "registry+https://github.com/rust-lang/crates.io-index";
const ERRORS = new Set(["notices_invalid_input", "notices_limit", "notices_build_incomplete", "notices_unmapped_crate", "notices_crate_changed", "notices_unknown_native", "notices_rust_missing", "notices_system_missing", "notices_source_changed"]);
const fail = code => { throw code; };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, file) => file.startsWith(`${root}/`);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const HASH = /^[0-9a-f]{64}$/u;
const CRATE = /^[A-Za-z0-9_-]+$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[+.-][A-Za-z0-9.+-]+)?$/u;
const LICENSE_FILE = /^(?:LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE)(?:[.-][A-Za-z0-9_.-]+)?$/iu;

function array(value, max) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > max) fail("notices_invalid_input");
  return value;
}
function text(value, max = 4096) {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail("notices_invalid_input");
  return value;
}
function absolute(value) {
  text(value);
  if (!path.isAbsolute(value) || path.normalize(value) !== value || value === "/") fail("notices_invalid_input");
  return value;
}
function linkerPath(value) {
  text(value);
  if (!path.isAbsolute(value) || /\s/u.test(value)) fail("notices_unknown_native");
  return value; // GNU bfd preserves GCC's ../ segments; resolve before system use.
}
function owned(value, max) {
  if (types.isProxy(value) || !types.isUint8Array(value) || value.byteLength === 0 || value.byteLength > max || types.isSharedArrayBuffer(value.buffer)) fail("notices_limit");
  return Buffer.from(value);
}
function utf8(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("notices_invalid_input"); }
}
function json(bytes, max) {
  try { return JSON.parse(utf8(owned(bytes, max))); } catch (error) { if (ERRORS.has(error)) throw error; fail("notices_invalid_input"); }
}
function relative(value) {
  text(value);
  if (path.isAbsolute(value) || value.split("/").some(part => !part || part === "." || part === "..")) fail("notices_invalid_input");
  return value;
}

async function read(file, max, code, prefixOnly = false) {
  let handle;
  try {
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || (!prefixOnly && before.size > BigInt(max))) fail(code);
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail("notices_source_changed");
    const bytes = Buffer.alloc(Math.min(Number(before.size), max));
    let offset = 0;
    while (offset < bytes.length) {
      const next = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!next.bytesRead) fail("notices_source_changed");
      offset += next.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    for (const candidate of [after, named]) {
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) if (candidate[key] !== before[key]) fail("notices_source_changed");
    }
    return bytes;
  } catch (error) { if (ERRORS.has(error)) throw error; fail(code); }
  finally { await handle?.close(); }
}

/** Parse the measured evidence without executing tools or interpreting file content as commands. */
export function planLinuxNotices(input) {
  try {
    const metadata = json(input.cargoMetadataBytes, 16 * MiB);
    if (metadata.version !== 1) fail("notices_invalid_input");
    const packages = new Map();
    for (const pkg of array(metadata.packages, 512)) {
      text(pkg.id); text(pkg.name, 128); text(pkg.version, 128); absolute(pkg.manifest_path);
      if (!CRATE.test(pkg.name) || !VERSION.test(pkg.version) || packages.has(pkg.id)) fail("notices_invalid_input");
      packages.set(pkg.id, pkg);
    }
    const messages = utf8(owned(input.cargoMessagesBytes, 16 * MiB)).trimEnd().split("\n");
    if (messages.length > 8192) fail("notices_limit");
    const compiled = new Map(), files = new Map(), scripts = [];
    let finished = false, executable = null;
    for (const line of messages) {
      let message;
      try { message = JSON.parse(line); } catch { fail("notices_build_incomplete"); }
      if (finished) fail("notices_build_incomplete");
      if (message.reason === "build-finished") {
        if (message.success !== true) fail("notices_build_incomplete");
        finished = true;
      } else if (message.reason === "compiler-artifact") {
        const pkg = packages.get(message.package_id);
        if (!pkg || message.manifest_path !== pkg.manifest_path || message.profile?.test !== false) fail("notices_build_incomplete");
        compiled.set(pkg.id, pkg);
        for (const filename of array(message.filenames, 32)) {
          absolute(filename);
          if (files.has(filename) && files.get(filename) !== pkg.id) fail("notices_build_incomplete");
          files.set(filename, pkg.id);
        }
        if (message.executable !== null && message.target?.kind?.includes("bin")) {
          if (pkg.name !== "aicharts-cli" || message.target.name !== "aicharts" || executable !== null) fail("notices_build_incomplete");
          executable = absolute(message.executable);
        }
      } else if (message.reason === "build-script-executed") {
        scripts.push(message);
      } else if (message.reason !== "compiler-message") fail("notices_build_incomplete");
    }
    if (!finished || executable !== absolute(input.executablePath) || compiled.size === 0) fail("notices_build_incomplete");
    let sqlite = false;
    for (const script of scripts) {
      const pkg = compiled.get(script.package_id);
      if (!pkg) fail("notices_build_incomplete");
      const links = array(script.linked_libs, 32);
      if (links.length) {
        if (pkg.name !== "libsqlite3-sys" || links.length !== 1 || links[0] !== "static=sqlite3") fail("notices_unknown_native");
        sqlite = true;
      }
    }
    if (!sqlite) fail("notices_build_incomplete");
    const map = utf8(owned(input.linkMapBytes, 32 * MiB));
    const outputs = [...map.matchAll(/^OUTPUT\((\S+) elf64-x86-64\)$/gmu)];
    if (!map.includes("Linker script and memory map\n") || outputs.length !== 1) fail("notices_build_incomplete");
    const linkOutput = absolute(outputs[0][1]);
    if (linkOutput !== executable && !(path.dirname(linkOutput) === path.join(path.dirname(executable), "deps") && /^aicharts-[0-9a-f]+$/u.test(path.basename(linkOutput)))) fail("notices_build_incomplete");
    const loads = new Set();
    for (const line of map.split("\n")) {
      if (!line.startsWith("LOAD ")) continue;
      const filename = line.slice(5);
      if (/\s/u.test(filename)) fail("notices_unknown_native");
      loads.add(linkerPath(filename));
    }
    if (!loads.size || loads.size > 1024) fail("notices_build_incomplete");
    return { ok: true, value: { compiled: [...compiled.values()], artifactFiles: files, loads: [...loads].sort(compare), executable, linkOutput } };
  } catch (error) { return { ok: false, error: ERRORS.has(error) ? error : "notices_invalid_input" }; }
}

const RUST_CRATES = new Set("std panic_unwind panic_abort object memchr addr2line gimli rustc_demangle std_detect hashbrown rustc_std_workspace_alloc unwind cfg_if libc alloc rustc_std_workspace_core core compiler_builtins adler2 miniz_oxide proc_macro test rustc_literal_escaper".split(" "));
const RUST_VENDOR = new Set("object memchr addr2line gimli rustc_demangle hashbrown cfg_if libc adler2 miniz_oxide rustc_literal_escaper".split(" "));
const GCC_DEV = new Set(["crtbegin.o", "crtbeginS.o", "crtend.o", "crtendS.o", "libgcc.a", "libgcc_eh.a", "libgcc_s.so"]);
const GLIBC_DEV = new Set(["crt1.o", "Scrt1.o", "crti.o", "crtn.o", "libc.so", "libc_nonshared.a", "libm.so", "libm-2.35.a", "libmvec.so", "libpthread.a", "libdl.a", "librt.a"]);
const GLIBC_RUNTIME = new Set(["libc.so.6", "libm.so.6", "libmvec.so.1", "libpthread.so.0", "libdl.so.2", "librt.so.1", "ld-linux-x86-64.so.2"]);

function nativeOwner(basename) {
  if (GCC_DEV.has(basename)) return /^libgcc-11-dev(?::amd64)?$/u;
  if (basename === "libgcc_s.so.1") return /^libgcc-s1(?::amd64)?$/u;
  if (GLIBC_DEV.has(basename)) return /^libc6-dev(?::amd64)?$/u;
  if (GLIBC_RUNTIME.has(basename)) return /^libc6(?::amd64)?$/u;
  fail("notices_unknown_native");
}
async function dpkg(args) {
  try {
    const { stdout } = await exec("/usr/bin/dpkg-query", args, { encoding: "utf8", timeout: 5000, maxBuffer: MiB, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, windowsHide: true });
    return stdout;
  } catch { fail("notices_system_missing"); }
}
async function packageOwner(filename, resolved, expected) {
  const candidates = new Set([filename, path.normalize(filename), resolved]);
  for (const candidate of [...candidates]) {
    if (candidate.startsWith("/usr/lib/")) candidates.add(candidate.slice(4));
    else if (candidate.startsWith("/lib/")) candidates.add(`/usr${candidate}`);
  }
  for (const candidate of candidates) {
    try {
      if (await realpath(candidate) !== resolved) continue;
      const ownership = (await dpkg(["-S", candidate])).trimEnd().split("\n");
      if (ownership.length !== 1) continue;
      const separator = ownership[0].indexOf(": ");
      const owner = ownership[0].slice(0, separator);
      if (separator >= 0 && ownership[0].slice(separator + 2) === candidate && expected.test(owner)) return owner;
    } catch { /* Only fixed equivalent aliases may be tried after a miss. */ }
  }
  fail("notices_system_missing");
}

/** Reads only build dependencies, source-owned notice mapping, Rust sysroot, and admitted system notices. */
export async function collectLinuxNotices(input) {
  try {
    const source = absolute(input.sourceDirectory), cargoHome = absolute(input.cargoHomeDirectory);
    const target = absolute(input.targetDirectory), scratch = absolute(input.scratchDirectory), sysroot = absolute(input.sysrootDirectory);
    const plan = planLinuxNotices(input);
    if (!plan.ok) return plan;
    for (const directory of [source, cargoHome, target, scratch, sysroot]) {
      if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory()) fail("notices_invalid_input");
    }
    if (!inside(target, plan.value.executable) || !inside(target, plan.value.linkOutput)) fail("notices_build_incomplete");
    if (plan.value.linkOutput !== plan.value.executable) {
      const binary = await read(plan.value.executable, 128 * MiB, "notices_build_incomplete");
      const linked = await read(plan.value.linkOutput, 128 * MiB, "notices_build_incomplete");
      if (!binary.equals(linked)) fail("notices_build_incomplete");
    }
    const policyBytes = await read(path.join(source, "distribution/cli/linux-notices.json"), MiB, "notices_unmapped_crate");
    const policy = json(policyBytes, MiB);
    if (policy.schemaVersion !== 1 || policy.registry !== REGISTRY) fail("notices_unmapped_crate");
    const mapped = new Map();
    for (const item of array(policy.packages, 128)) {
      if (!CRATE.test(item.name) || !VERSION.test(item.version) || !HASH.test(item.checksum)) fail("notices_unmapped_crate");
      const key = `${item.name}@${item.version}`;
      if (mapped.has(key)) fail("notices_unmapped_crate");
      mapped.set(key, item);
    }
    const sections = new Map();
    let total = 0;
    function add(label, bytes) {
      text(label, 512);
      utf8(bytes);
      if (!bytes.length || bytes.length > 16 * MiB) fail("notices_limit");
      if (sections.has(label)) {
        if (!sections.get(label).equals(bytes)) fail("notices_source_changed");
        return;
      }
      total += bytes.length;
      if (sections.size >= 512 || total > 48 * MiB) fail("notices_limit");
      sections.set(label, bytes);
    }
    for (const pkg of plan.value.compiled.sort((a, b) => compare(a.name + a.version, b.name + b.version))) {
      if (pkg.source === null) {
        if (!inside(source, pkg.manifest_path) || !/^aicharts-(?:cli|core|ledger|protocol)$/u.test(pkg.name) || pkg.license !== "MIT") fail("notices_unmapped_crate");
        continue; // Project LICENSE is a separate mandatory archive member.
      }
      const item = mapped.get(`${pkg.name}@${pkg.version}`);
      if (pkg.source !== REGISTRY || !item || item.license !== pkg.license || pkg.license_file !== null) fail("notices_unmapped_crate");
      const directory = path.dirname(pkg.manifest_path);
      if (!inside(path.join(cargoHome, "registry/src"), directory) || await realpath(directory) !== directory || path.basename(directory) !== `${pkg.name}-${pkg.version}`) fail("notices_crate_changed");
      const checksums = json(await read(path.join(directory, ".cargo-checksum.json"), MiB, "notices_crate_changed"), MiB);
      if (checksums.package !== item.checksum) fail("notices_crate_changed");
      if (!array(item.files, 16).length) fail("notices_unmapped_crate");
      for (const file of item.files) {
        if (!LICENSE_FILE.test(relative(file.path)) || !HASH.test(file.sha256)) fail("notices_unmapped_crate");
        const bytes = await read(path.join(directory, file.path), MiB, "notices_crate_changed");
        if (digest(bytes) !== file.sha256) fail("notices_crate_changed");
        add(`Cargo ${pkg.name} ${pkg.version} (${pkg.license}) / ${file.path}`, bytes);
      }
      if (pkg.name === "libsqlite3-sys") {
        const bytes = await read(path.join(directory, "sqlite3/sqlite3.c"), 8192, "notices_crate_changed", true);
        const body = utf8(bytes);
        const blessing = body.match(/\/\*\n\*\* 2001 September 15\n[\s\S]*?May you share freely, never taking more than you give\.[\s\S]*?\*\//u)?.[0];
        const sqliteVersion = body.match(/\*\* version ([0-9.]+)\./u)?.[1];
        if (!blessing || !sqliteVersion || !body.includes("The author disclaims copyright")) fail("notices_crate_changed");
        add(`SQLite ${sqliteVersion} amalgamation public-domain statement (bundled by ${pkg.name} ${pkg.version})`, Buffer.from(blessing + "\n"));
      }
    }
    const system = new Map(), rustLoads = new Set();
    for (const file of plan.value.loads) {
      if (plan.value.artifactFiles.has(file)) {
        if (!inside(target, file)) fail("notices_unknown_native");
        continue;
      }
      if (inside(path.join(sysroot, "lib/rustlib", TARGET, "lib"), file)) {
        const name = path.basename(file).match(/^lib([a-z0-9_]+)-[0-9a-f]+\.rlib$/u)?.[1];
        if (!RUST_CRATES.has(name)) fail("notices_unknown_native");
        rustLoads.add(name);
        continue;
      }
      // These are generated by rustc, not third-party native link providers.
      if (inside(target, file) && /^aicharts-[0-9a-f]+\.[A-Za-z0-9_.-]+\.rcgu\.o$/u.test(path.basename(file))) continue;
      if (inside(scratch, file) && /^\.?rustc[A-Za-z0-9]+\/symbols\.o$/u.test(path.relative(scratch, file))) continue;
      system.set(file, nativeOwner(path.basename(file)));
    }
    if (!rustLoads.has("std") || !rustLoads.has("compiler_builtins")) fail("notices_build_incomplete");
    const dynamic = array(input.dynamicLibraries, 16);
    if (!dynamic.length) fail("notices_build_incomplete");
    const sonames = new Set();
    for (const library of dynamic) {
      text(library.soname, 128); absolute(library.path);
      if (sonames.has(library.soname) || (!GLIBC_RUNTIME.has(library.soname) && library.soname !== "libgcc_s.so.1")) fail("notices_unknown_native");
      sonames.add(library.soname);
      system.set(library.path, nativeOwner(library.soname));
    }
    if (!sonames.has("ld-linux-x86-64.so.2") || !sonames.has("libc.so.6")) fail("notices_build_incomplete");
    for (const name of ["COPYRIGHT", "COPYRIGHT.html", "COPYRIGHT-library.html", "LICENSE-MIT", "LICENSE-APACHE"]) {
      add(`Rust toolchain / ${name}`, await read(path.join(sysroot, "share/doc/rust", name), 16 * MiB, "notices_rust_missing"));
    }
    // Rust 1.97.1 dist.rs ships its complete REUSE license-text directory here.
    // Preserve full texts for the SPDX expressions in the generated HTML.
    const rustLicenses = path.join(sysroot, "share/doc/rust/licenses");
    const licenseEntries = await readdir(rustLicenses, { withFileTypes: true });
    if (!licenseEntries.length || licenseEntries.length > 128) fail("notices_rust_missing");
    for (const entry of licenseEntries.sort((a, b) => compare(a.name, b.name))) {
      if (!entry.isFile() || !/^[A-Za-z0-9_.+-]+\.txt$/u.test(entry.name)) fail("notices_rust_missing");
      add(`Rust REUSE license / ${entry.name}`, await read(path.join(rustLicenses, entry.name), MiB, "notices_rust_missing"));
    }
    for (const name of ["MIT.txt", "Apache-2.0.txt", "Unicode-3.0.txt"]) if (!sections.has(`Rust REUSE license / ${name}`)) fail("notices_rust_missing");
    // rust-src carries full runtime exception texts absent from SPDX-only HTML.
    const libraryRoot = path.join(sysroot, "lib/rustlib/src/rust/library");
    for (const filename of ["compiler-builtins/LICENSE.txt", "stdarch/LICENSE-MIT", "backtrace/LICENSE-MIT", "backtrace/LICENSE-APACHE"]) {
      add(`Rust standard-library source / ${filename}`, await read(path.join(libraryRoot, filename), MiB, "notices_rust_missing"));
    }
    const vendor = path.join(libraryRoot, "vendor");
    const vendors = await readdir(vendor, { withFileTypes: true });
    if (!vendors.length || vendors.length > 256) fail("notices_rust_missing");
    const covered = new Set();
    for (const entry of vendors.sort((a, b) => compare(a.name, b.name))) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_.+-]+$/u.test(entry.name)) fail("notices_rust_missing");
      const crate = entry.name.match(/^([a-z0-9_-]+)-[0-9]+\./u)?.[1]?.replaceAll("-", "_");
      if (!RUST_VENDOR.has(crate) || !rustLoads.has(crate)) continue;
      if (covered.has(crate)) fail("notices_rust_missing");
      covered.add(crate);
      const files = await readdir(path.join(vendor, entry.name), { withFileTypes: true });
      if (files.length > 512) fail("notices_limit");
      const licenses = files.filter(file => LICENSE_FILE.test(file.name));
      if (!licenses.length) fail("notices_rust_missing");
      for (const file of licenses.sort((a, b) => compare(a.name, b.name))) {
        if (!file.isFile()) fail("notices_rust_missing");
        add(`Rust vendored source ${entry.name} / ${file.name}`, await read(path.join(vendor, entry.name, file.name), MiB, "notices_rust_missing"));
      }
    }
    for (const crate of rustLoads) if (RUST_VENDOR.has(crate) && !covered.has(crate)) fail("notices_rust_missing");
    // Unicode tables are compiled into core; this source-mapped text also covers
    // unicode-ident, independently of whether that proc macro reached the binary.
    if (![...sections.keys()].some(label => label.startsWith("Cargo unicode-ident ") && label.endsWith("/ LICENSE-UNICODE"))) fail("notices_rust_missing");
    const packages = new Map();
    if (system.size > 32) fail("notices_limit");
    const ownershipCache = new Map();
    for (const [filename, ownerPattern] of system) {
      if (!/^\/(?:usr\/)?lib(?:64)?\/[A-Za-z0-9_+./-]+$/u.test(filename)) fail("notices_unknown_native");
      const resolved = await realpath(filename);
      if (!/^\/(?:usr\/)?lib(?:64)?\//u.test(resolved)) fail("notices_unknown_native");
      const owner = ownershipCache.get(resolved) ?? await packageOwner(filename, resolved, ownerPattern);
      if (!ownerPattern.test(owner)) fail("notices_unknown_native");
      ownershipCache.set(resolved, owner);
      if (packages.has(owner)) continue;
      const fields = (await dpkg(["-W", "-f=${binary:Package}\t${Version}\t${Status}\n", owner])).trimEnd().split("\t");
      if (fields.length !== 3 || fields[0] !== owner || fields[2] !== "install ok installed" || !/^[A-Za-z0-9:.+~_-]+$/u.test(fields[1])) fail("notices_system_missing");
      packages.set(owner, fields[1]);
      const copyright = await realpath(`/usr/share/doc/${owner.split(":")[0]}/copyright`);
      if (!inside("/usr/share/doc", copyright)) fail("notices_system_missing");
      const bytes = await read(copyright, 4 * MiB, "notices_system_missing");
      add(`Ubuntu package ${owner} ${fields[1]} / copyright`, bytes);
      const body = utf8(bytes);
      if (owner.startsWith("libgcc") && !body.includes("GCC Runtime Library Exception")) fail("notices_system_missing");
      const common = new Set([...body.matchAll(/\/usr\/share\/common-licenses\/([A-Za-z0-9_.-]+)/gu)].map(match => match[1]));
      for (const name of [...common].sort(compare)) {
        const filename = await realpath(`/usr/share/common-licenses/${name}`);
        if (!inside("/usr/share/common-licenses", filename)) fail("notices_system_missing");
        add(`Ubuntu common license / ${name}`, await read(filename, MiB, "notices_system_missing"));
      }
    }
    if (![...packages.keys()].some(name => name.startsWith("libgcc-11-dev")) || ![...packages.keys()].some(name => name.startsWith("libc6-dev"))) fail("notices_build_incomplete");
    const heading = "AI Charts Linux CLI third-party notices\n\nSelected from actual Cargo artifacts, bundled SQLite, Rust runtime source and toolchain notices, GNU bfd LOAD entries, and resolved Ubuntu runtime packages. Build-only and platform-extraneous source notices are retained conservatively; this does not assert that all listed code is linked. Project LICENSE is distributed separately.\n";
    const chunks = [Buffer.from(heading)];
    for (const [label, bytes] of [...sections].sort(([a], [b]) => compare(a, b))) chunks.push(Buffer.from(`\n===== ${label} =====\nSHA-256: ${digest(bytes)}\n\n`), bytes, Buffer.from("\n"));
    const bytes = Buffer.concat(chunks);
    if (bytes.length > 64 * MiB) fail("notices_limit");
    return { ok: true, value: { bytes, sha256: digest(bytes), components: sections.size } };
  } catch (error) { return { ok: false, error: ERRORS.has(error) ? error : "notices_invalid_input" }; }
}
