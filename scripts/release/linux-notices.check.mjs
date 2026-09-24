import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink, truncate, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectLinuxNotices, planLinuxNotices, linuxNativeDiagnostic, linuxSystemDiagnostic, LINUX_LINK_MAP_MAX_BYTES } from "./linux-notices.mjs";
import { SUPPORT_SOURCE, SUPPORT_FILES } from "./support-source.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
const registry = "registry+https://github.com/rust-lang/crates.io-index";
const root = "/fixture";
function fixture(directory = root) {
  const sourceDirectory = `${directory}/source`, cargoHomeDirectory = `${directory}/cargo`;
  const targetDirectory = `${directory}/target`, sysrootDirectory = `${directory}/sysroot`, scratchDirectory = `${directory}/tmp`;
  const executablePath = `${targetDirectory}/x86_64-unknown-linux-gnu/release/aicharts`;
  const packages = [
    { id: "path+file:///source/aicharts-cli#0.1.0", name: "aicharts-cli", version: "0.1.0", source: null, license: "MIT", license_file: null, manifest_path: `${sourceDirectory}/crates/aicharts-cli/Cargo.toml` },
    { id: "registry+https://github.com/rust-lang/crates.io-index#libsqlite3-sys@0.38.2", name: "libsqlite3-sys", version: "0.38.2", source: registry, license: "MIT", license_file: null, links: "sqlite3", manifest_path: `${cargoHomeDirectory}/registry/src/index-fixture/libsqlite3-sys-0.38.2/Cargo.toml` },
    { id: "registry+https://github.com/rust-lang/crates.io-index#unicode-ident@1.0.24", name: "unicode-ident", version: "1.0.24", source: registry, license: "(MIT OR Apache-2.0) AND Unicode-3.0", license_file: null, manifest_path: `${cargoHomeDirectory}/registry/src/index-fixture/unicode-ident-1.0.24/Cargo.toml` },
  ];
  const messages = packages.map(pkg => ({ reason: "compiler-artifact", package_id: pkg.id, manifest_path: pkg.manifest_path,
    target: { name: pkg.name === "aicharts-cli" ? "aicharts" : pkg.name.replaceAll("-", "_"), kind: pkg.name === "aicharts-cli" ? ["bin"] : ["lib"] },
    profile: { test: false }, filenames: pkg.name === "aicharts-cli" ? [executablePath] : [`${targetDirectory}/release/deps/lib${pkg.name.replaceAll("-", "_")}-123abc.rlib`],
    executable: pkg.name === "aicharts-cli" ? executablePath : null }));
  const out_dir = `${targetDirectory}/x86_64-unknown-linux-gnu/release/build/libsqlite3-sys-0123456789abcdef/out`;
  messages.push({ reason: "build-script-executed", package_id: packages[1].id, linked_libs: ["static=sqlite3"], linked_paths: [`native=${out_dir}`], out_dir });
  messages.push({ reason: "build-finished", success: true });
  const loads = [messages[1].filenames[0], `${sysrootDirectory}/lib/rustlib/x86_64-unknown-linux-gnu/lib/libstd-abc.rlib`, `${sysrootDirectory}/lib/rustlib/x86_64-unknown-linux-gnu/lib/libcompiler_builtins-def.rlib`, "/usr/lib/gcc/x86_64-linux-gnu/11/crtbeginS.o", "/usr/lib/x86_64-linux-gnu/Scrt1.o"];
  const input = { sourceDirectory, cargoHomeDirectory, targetDirectory, sysrootDirectory, scratchDirectory, executablePath,
    dynamicLibraries: [{ soname: "libc.so.6", path: "/lib/x86_64-linux-gnu/libc.so.6" }, { soname: "ld-linux-x86-64.so.2", path: "/lib64/ld-linux-x86-64.so.2" }] };
  function update() {
    input.cargoMetadataBytes = encode({ version: 1, packages });
    input.cargoMessagesBytes = Buffer.from(messages.map(message => JSON.stringify(message)).join("\n") + "\n");
    input.linkMapBytes = Buffer.from(`Linker script and memory map\n${loads.map(file => `LOAD ${file}\n`).join("")}OUTPUT(${executablePath} elf64-x86-64)\n`);
    return input;
  }
  return { input: update(), packages, messages, loads, update };
}

const ringLicenses = ["LICENSE", "LICENSE-BoringSSL", "LICENSE-other-bits", "src/polyfill/once_cell/LICENSE-APACHE", "src/polyfill/once_cell/LICENSE-MIT"];
const zstdLicenses = ["LICENSE", "LICENSE.BSD-3-Clause", "zstd/LICENSE"];
function addRing(f) {
  const pkg = { id: `${registry}#ring@0.17.14`, name: "ring", version: "0.17.14", source: registry, license: "Apache-2.0 AND ISC", license_file: null,
    links: "ring_core_0_17_14_", manifest_path: `${f.input.cargoHomeDirectory}/registry/src/index-fixture/ring-0.17.14/Cargo.toml` };
  const out_dir = `${f.input.targetDirectory}/x86_64-unknown-linux-gnu/release/build/ring-fedcba9876543210/out`;
  f.packages.push(pkg);
  f.messages.splice(-1, 0, { reason: "compiler-artifact", package_id: pkg.id, manifest_path: pkg.manifest_path,
    target: { name: "ring", kind: ["lib"] }, profile: { test: false }, executable: null,
    filenames: [`${f.input.targetDirectory}/x86_64-unknown-linux-gnu/release/deps/libring-abc123.rlib`] },
  { reason: "build-script-executed", package_id: pkg.id, linked_libs: ["static=ring_core_0_17_14_", "static=ring_core_0_17_14__test"], linked_paths: [`native=${out_dir}`], out_dir });
  f.update();
  return pkg;
}

function addCustody(f, changes = {}) {
  const pkg = { id: "path+file:///source/aicharts-custody#0.1.0", name: "aicharts-custody", version: "0.1.0", source: null,
    license: "MIT", license_file: null, manifest_path: `${f.input.sourceDirectory}/crates/aicharts-custody/Cargo.toml`, ...changes };
  const target = pkg.name.replaceAll("-", "_");
  const filename = `${f.input.targetDirectory}/x86_64-unknown-linux-gnu/release/deps/lib${target}-abcdef123.rlib`;
  f.packages.push(pkg);
  f.messages.splice(-1, 0, { reason: "compiler-artifact", package_id: pkg.id, manifest_path: pkg.manifest_path,
    target: { name: target, kind: ["lib"] }, profile: { test: false }, executable: null, filenames: [filename] });
  f.loads.push(filename);
  f.update();
  return pkg;
}

function addZstd(f) {
  const pkg = addRing(f);
  const oldId = pkg.id;
  Object.assign(pkg, { id: `${registry}#zstd-sys@2.1.0+zstd.1.5.7`, name: "zstd-sys", version: "2.1.0+zstd.1.5.7", license: "BSD-3-Clause", links: "zstd",
    manifest_path: `${f.input.cargoHomeDirectory}/registry/src/index-fixture/zstd-sys-2.1.0+zstd.1.5.7/Cargo.toml` });
  for (const message of f.messages.filter(value => value.package_id === oldId)) {
    message.package_id = pkg.id;
    if (message.reason === "compiler-artifact") {
      message.manifest_path = pkg.manifest_path;
      message.target.name = "zstd_sys";
      message.filenames = [`${f.input.targetDirectory}/x86_64-unknown-linux-gnu/release/deps/libzstd_sys-abc123.rlib`];
    } else {
      message.out_dir = message.out_dir.replace("ring-", "zstd-sys-");
      message.linked_libs = ["static=zstd"];
      message.linked_paths = [`native=${message.out_dir}`];
    }
  }
  f.update();
  return pkg;
}

test("bundled Zstandard requires its exact reviewed native provider and output", () => {
  const f = fixture(); addZstd(f);
  const result = planLinuxNotices(f.input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.nativeArchives.map(value => path.basename(value.file)), ["libsqlite3.a", "libzstd.a"]);
  f.messages.at(-2).linked_libs = ["dylib=zstd"];
  assert.equal(planLinuxNotices(f.update()).error, "notices_unknown_native");
  f.messages.at(-2).linked_libs = ["static=zstd"];
  f.packages.at(-1).version = "2.1.1+zstd.1.5.7";
  assert.equal(planLinuxNotices(f.update()).error, "notices_unknown_native");
});

test("vendored Tokscale retains its pinned MIT notice and rejects identity or notice substitution", async () => {
  await diskFixture(async f => {
    const pkg = addCustody(f, { id: "path+file:///source/vendor/tokscale-core#4.17.0-aicharts.1", name: "tokscale-core", version: "4.17.0-aicharts.1",
      manifest_path: `${f.input.sourceDirectory}/vendor/tokscale-core/Cargo.toml` });
    const file = path.join(path.dirname(pkg.manifest_path), "LICENSE");
    await mkdir(path.dirname(file), { recursive: true });
    const license = await readFile(new URL("../../vendor/tokscale-core/LICENSE", import.meta.url));
    await writeFile(file, license);
    assert.equal((await collectLinuxNotices(f.update())).error, "notices_rust_missing");
    for (const [field, value] of [["version", "4.17.1"], ["license", "Apache-2.0"], ["license_file", "LICENSE"]]) {
      const before = pkg[field]; pkg[field] = value;
      assert.equal((await collectLinuxNotices(f.update())).error, "notices_unmapped_crate");
      pkg[field] = before;
    }
    await writeFile(file, "Changed notice\n");
    assert.equal((await collectLinuxNotices(f.update())).error, "notices_crate_changed");
  });
});

async function addSupport(f) {
  const checkout = `${f.input.cargoHomeDirectory}/git/checkouts/support-foundation-fixture/ed89e58`;
  for (const file of Object.keys(SUPPORT_FILES)) {
    const bytes = await readFile(new URL(`../../node_modules/@hraness/support-foundation/${file}`, import.meta.url));
    assert.equal(digest(bytes), SUPPORT_FILES[file]);
    await mkdir(path.dirname(`${checkout}/${file}`), { recursive: true });
    await writeFile(`${checkout}/${file}`, bytes);
  }
  return addCustody(f, { id: `${SUPPORT_SOURCE}#hraness-support-foundation@0.4.0`,
    name: "hraness-support-foundation", version: "0.4.0", source: SUPPORT_SOURCE,
    manifest_path: `${checkout}/rust/Cargo.toml` });
}

test("pinned SQLite and Ring build outputs join exact Cargo metadata without requiring direct LOAD", () => {
  const f = fixture(); addRing(f);
  const result = planLinuxNotices(f.input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.nativeArchives.map(value => path.basename(value.file)), ["libsqlite3.a", "libring_core_0_17_14_.a", "libring_core_0_17_14__test.a"]);
  for (const archive of result.value.nativeArchives) {
    assert.ok(f.packages.some(pkg => pkg.id === archive.packageId));
    assert.equal(path.dirname(archive.file), archive.outDirectory);
    assert.equal(result.value.loads.includes(archive.file), false);
  }
});

test("native attribution refuses substituted providers, link modes, names, duplicates and search paths", () => {
  const cases = [
    [f => { f.packages.at(-1).version = "0.17.15"; }, "build_script_provider"],
    [f => { f.packages.at(-1).source = null; }, "build_script_provider"],
    [f => { f.packages.at(-1).links = "PRIVATE_CANARY"; }, "build_script_provider"],
    [f => { f.messages.at(-2).linked_libs[0] = "dylib=ring_core_0_17_14_"; }, "build_script_links"],
    [f => { f.messages.at(-2).linked_libs[0] = "static:+whole-archive=ring_core_0_17_14_"; }, "build_script_links"],
    [f => { f.messages.at(-2).linked_libs[1] = "static=ring_core_0_17_14_"; }, "build_script_links"],
    [f => { f.messages.at(-2).linked_libs.push("static=PRIVATE_CANARY"); }, "build_script_links"],
    [f => { f.messages.at(-2).linked_paths.push("native=/PRIVATE_CANARY"); }, "build_script_path"],
    [f => { f.messages.at(-2).linked_paths = [f.messages.at(-2).out_dir]; }, "build_script_path"],
    [f => { f.messages.at(-2).out_dir += "/../out"; }, "build_script_path"],
    [f => { const script = f.messages.at(-2); script.out_dir = script.out_dir.replace("ring-", "other-"); script.linked_paths = [`native=${script.out_dir}`]; }, "build_script_path"],
    [f => { const script = f.messages.at(-2); script.out_dir = script.out_dir.replace("x86_64-unknown-linux-gnu/release", "release"); script.linked_paths = [`native=${script.out_dir}`]; }, "build_script_path"],
  ];
  for (const [mutate, category] of cases) {
    const f = fixture(); addRing(f); mutate(f);
    const result = planLinuxNotices(f.update());
    assert.deepEqual(result, { ok: false, error: "notices_unknown_native", nativeCategory: category });
    assert.equal(JSON.stringify(result).includes("PRIVATE_CANARY"), false);
  }
  const f = fixture(); addRing(f); f.messages.splice(-1, 0, { ...f.messages.at(-2) });
  assert.equal(planLinuxNotices(f.update()).error, "notices_build_incomplete");
  f.messages.splice(-3, 2);
  assert.equal(planLinuxNotices(f.update()).error, "notices_build_incomplete");
});

test("native diagnostic projection does not invoke accessors or retain arbitrary fields", () => {
  let calls = 0;
  assert.equal(linuxNativeDiagnostic({ error: "notices_unknown_native", nativeCategory: "system_library", path: "PRIVATE_CANARY" }), "system_library");
  assert.equal(linuxNativeDiagnostic({ error: "notices_unknown_native", nativeCategory: "PRIVATE_CANARY" }), null);
  assert.equal(linuxNativeDiagnostic({ error: "notices_invalid_input", nativeCategory: "system_library" }), null);
  assert.equal(linuxNativeDiagnostic({ error: "notices_unknown_native", get nativeCategory() { calls++; return "system_library"; } }), null);
  assert.equal(linuxNativeDiagnostic(new Proxy({}, { getOwnPropertyDescriptor() { calls++; throw new Error("PRIVATE_CANARY"); } })), null);
  assert.equal(calls, 0);
});

test("system diagnostic projection retains only fixed failure locations without reading accessors", () => {
  let calls = 0;
  assert.equal(linuxSystemDiagnostic({ error: "notices_system_missing", systemCategory: "package_query_terminated", output: "PRIVATE_CANARY" }), "package_query_terminated");
  assert.equal(linuxSystemDiagnostic({ error: "notices_system_missing", systemCategory: "PRIVATE_CANARY" }), null);
  assert.equal(linuxSystemDiagnostic({ error: "notices_invalid_input", systemCategory: "package_record" }), null);
  assert.equal(linuxSystemDiagnostic(Object.create({ error: "notices_system_missing", systemCategory: "package_record" })), null);
  assert.equal(linuxSystemDiagnostic({ error: "notices_system_missing", get systemCategory() { calls++; throw new Error("PRIVATE_CANARY"); } }), null);
  assert.equal(linuxSystemDiagnostic({ get error() { calls++; throw new Error("PRIVATE_CANARY"); }, systemCategory: "package_record" }), null);
  assert.equal(linuxSystemDiagnostic(new Proxy({}, { getOwnPropertyDescriptor() { calls++; throw new Error("PRIVATE_CANARY"); } })), null);
  assert.equal(calls, 0);
});

test("actual-message shape joins package identities, executable and bfd map", () => {
  const f = fixture(), result = planLinuxNotices(f.input);
  assert.equal(result.ok, true);
  assert.equal(result.value.compiled.length, 3);
  assert.equal(result.value.executable, f.input.executablePath);
  assert.equal(result.value.artifactFiles.size, 3);
  assert.equal(result.value.loads.length, 5);
});

test("unbuilt metadata packages do not enter the attributed graph", () => {
  const f = fixture();
  f.packages.push({ ...f.packages[1], id: "unbuilt-id", name: "unbuilt", version: "9.0.0" });
  const result = planLinuxNotices(f.update());
  assert.equal(result.ok, true);
  assert.equal(result.value.compiled.some(pkg => pkg.name === "unbuilt"), false);
});

test("failed, absent and non-final successful build endings are refused", () => {
  for (const mutate of [f => f.messages.pop(), f => { f.messages.at(-1).success = false; }, f => f.messages.push({ reason: "compiler-message" })]) {
    const f = fixture(); mutate(f);
    assert.equal(planLinuxNotices(f.update()).error, "notices_build_incomplete");
  }
});

test("test artifacts, different executables and unmatched package IDs are refused", () => {
  for (const mutate of [f => { f.messages[0].profile.test = true; }, f => { f.messages[0].executable = "/other/bin"; }, f => { f.messages[1].package_id = "absent"; }, f => { f.messages[1].manifest_path = "/other/Cargo.toml"; }]) {
    const f = fixture(); mutate(f);
    assert.equal(planLinuxNotices(f.update()).error, "notices_build_incomplete");
  }
});

test("extra native build-script inputs and missing bundled SQLite refuse", () => {
  const f = fixture();
  f.messages.at(-2).linked_libs.push("ssl");
  assert.equal(planLinuxNotices(f.update()).error, "notices_unknown_native");
  f.messages.at(-2).linked_libs = [];
  assert.equal(planLinuxNotices(f.update()).error, "notices_build_incomplete");
});

test("lld maps, empty maps and maps bound to another output refuse", () => {
  for (const map of ["VMA LMA Size Align Out In Symbol\n", "Linker script and memory map\n", "Linker script and memory map\nLOAD /tmp/input.o\nOUTPUT(/wrong elf64-x86-64)\n"]) {
    const f = fixture(); f.input.linkMapBytes = Buffer.from(map);
    assert.equal(planLinuxNotices(f.input).error, "notices_build_incomplete");
  }
});

test("complete bfd maps above 8 MiB, at the measured fc95b51 size and at the shared 64 MiB bound retain exact attribution", () => {
  assert.equal(LINUX_LINK_MAP_MAX_BYTES, 64 * 1024 * 1024);
  const f = fixture(), expected = planLinuxNotices(f.input);
  assert.equal(expected.ok, true);
  const measuredMap = f.input.linkMapBytes;
  // 33,690,505 bytes is the map that run 36066135869 refused under the old 32 MiB bound.
  for (const size of [8 * 1024 * 1024 + 1, 33_690_505, LINUX_LINK_MAP_MAX_BYTES]) {
    // Ignored map whitespace changes size without changing any LOAD or OUTPUT.
    const padded = Buffer.alloc(size, 0x20); measuredMap.copy(padded); padded[size - 1] = 0x0a;
    f.input.linkMapBytes = padded;
    assert.deepEqual(planLinuxNotices(f.input), expected);
  }
  // Invalid UTF-8 beyond the byte bound must be refused before decoding.
  f.input.linkMapBytes = Buffer.alloc(LINUX_LINK_MAP_MAX_BYTES + 1, 0xff);
  assert.deepEqual(planLinuxNotices(f.input), { ok: false, error: "notices_limit" });
});

test("map paths never accept relative paths or shell-like whitespace", () => {
  for (const filename of ["../untrusted.a", "/tmp/a b.a"]) {
    const f = fixture(); f.loads.push(filename);
    assert.equal(planLinuxNotices(f.update()).ok, false);
  }
});

test("bfd retains absolute GCC dot segments before system attribution", () => {
  const f = fixture();
  f.loads.push("/usr/lib/gcc/x86_64-linux-gnu/11/../../../x86_64-linux-gnu/Scrt1.o");
  const result = planLinuxNotices(f.update());
  assert.equal(result.ok, true);
  assert.ok(result.value.loads.some(filename => filename.includes("/../")));
});

test("hashed Cargo link output must stay in the adjacent deps directory", () => {
  for (const accepted of [true, false]) {
    const f = fixture();
    const output = accepted ? `${path.dirname(f.input.executablePath)}/deps/aicharts-abc123` : "/other/deps/aicharts-abc123";
    f.input.linkMapBytes = Buffer.from(f.input.linkMapBytes.toString().replace(`OUTPUT(${f.input.executablePath} `, `OUTPUT(${output} `));
    const result = planLinuxNotices(f.input);
    assert.equal(result.ok, accepted);
    if (accepted) assert.equal(result.value.linkOutput, output);
  }
});

test("bounded JSON failures produce fixed diagnostics without echoing input", () => {
  const f = fixture();
  f.input.cargoMessagesBytes = Buffer.from("PRIVATE_CANARY_NOT_A_BUILD\n");
  assert.deepEqual(planLinuxNotices(f.input), { ok: false, error: "notices_build_incomplete" });
  f.input.cargoMetadataBytes = Buffer.alloc(16 * 1024 * 1024 + 1);
  assert.equal(planLinuxNotices(f.input).error, "notices_limit");
});

async function diskFixture(fn, { ring = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "aicharts-notices-"));
  // macOS /var is a symlink; the collector takes canonical runner-owned roots.
  const { realpath } = await import("node:fs/promises");
  const directory = await realpath(temporary);
  try {
    const f = fixture(directory);
    if (ring) addRing(f);
    for (const key of ["sourceDirectory", "cargoHomeDirectory", "targetDirectory", "sysrootDirectory", "scratchDirectory"]) await mkdir(f.input[key], { recursive: true });
    await mkdir(`${f.input.sourceDirectory}/distribution/cli`, { recursive: true });
    const policy = { schemaVersion: 1, registry, packages: [] };
    for (const pkg of f.packages.filter(pkg => pkg.source)) {
      const dir = path.dirname(pkg.manifest_path);
      await mkdir(dir, { recursive: true });
      const body = Buffer.from(`Synthetic ${pkg.name} notice fixture\n`);
      const names = pkg.name === "ring" ? ringLicenses : [pkg.name === "unicode-ident" ? "LICENSE-UNICODE" : "LICENSE"];
      const archive = Buffer.from(`Synthetic cached archive for ${pkg.name} ${pkg.version}\n`);
      const checksum = digest(archive);
      for (const file of names) {
        await mkdir(path.dirname(`${dir}/${file}`), { recursive: true });
        await writeFile(`${dir}/${file}`, body);
      }
      await mkdir(path.dirname(crateArchive(f, pkg)), { recursive: true });
      await writeFile(crateArchive(f, pkg), archive);
      policy.packages.push({ name: pkg.name, version: pkg.version, checksum, license: pkg.license, files: names.map(file => ({ path: file, sha256: digest(body) })) });
      if (pkg.name === "libsqlite3-sys") {
        await mkdir(`${dir}/sqlite3`);
        await writeFile(`${dir}/sqlite3/sqlite3.c`, "** version 3.53.2.\n/*\n** 2001 September 15\n** The author disclaims copyright\n** May you share freely, never taking more than you give.\n*/\n");
      }
    }
    for (const script of f.messages.filter(message => message.reason === "build-script-executed")) {
      await mkdir(script.out_dir, { recursive: true });
      for (const name of script.linked_libs) await writeFile(`${script.out_dir}/lib${name.slice(7)}.a`, "!<arch>\n");
    }
    const policyPath = `${f.input.sourceDirectory}/distribution/cli/linux-notices.json`;
    await writeFile(policyPath, encode(policy));
    await fn(f, policy, async () => writeFile(policyPath, encode(policy)));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function crateArchive(f, pkg) {
  return path.join(f.input.cargoHomeDirectory, "registry/cache", path.basename(path.dirname(path.dirname(pkg.manifest_path))), `${pkg.name}-${pkg.version}.crate`);
}

test("pinned rustc symbols object uses the exact measured link output parent", async () => {
  for (const hashed of [false, true]) {
    await diskFixture(async f => {
      const executable = f.input.executablePath;
      const output = hashed ? path.join(path.dirname(executable), "deps/aicharts-0123456789abcdef") : executable;
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(executable, "Synthetic matching linker output\n");
      if (hashed) await writeFile(output, "Synthetic matching linker output\n");
      f.loads.push(`${path.dirname(output)}/rustcAz09xY/symbols.o`);
      const input = f.update();
      input.linkMapBytes = Buffer.from(input.linkMapBytes.toString().replace(`OUTPUT(${executable} `, `OUTPUT(${output} `));
      // This minimal fixture stops at the next gate; the complete Ubuntu join
      // below proves successful attribution with the same generated object.
      assert.deepEqual(await collectLinuxNotices(input), { ok: false, error: "notices_rust_missing" });
    });
  }
});

test("rustc symbol attribution rejects other outputs, aliases and unrecognized objects", async () => {
  for (const hashed of [false, true]) {
    await diskFixture(async f => {
      const executable = f.input.executablePath;
      const output = hashed ? path.join(path.dirname(executable), "deps/aicharts-0123456789abcdef") : executable;
      const directory = path.dirname(output);
      await mkdir(directory, { recursive: true });
      await writeFile(executable, "Synthetic matching linker output\n");
      if (hashed) await writeFile(output, "Synthetic matching linker output\n");
      const cases = [
        [`${hashed ? path.dirname(executable) : path.join(directory, "deps")}/rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}-other/rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}/other-output/rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09xY/nested/symbols.o`, "unknown_load"],
        [`${directory}/./rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}/../${path.basename(directory)}/rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09xY/../rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}//rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09xY/symbol.o`, "unknown_load"],
        [`${directory}/rustcAz09xY/symbols.o.extra`, "unknown_load"],
        [`${directory}/rustcAz09xY/unrecognized.o`, "unknown_load"],
        [`${directory}/rustcAz09xY/symbols.a`, "generated_archive_load"],
        [`${directory}/symbols.o`, "unknown_load"],
        [`${directory}/aicharts-0123456789abcdef.rcgu.o`, "unknown_load"],
        [`${directory}/.rustcAz09xY/symbols.o`, "unknown_load"],
        [`${directory}/rustc/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09x/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09xY0/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09x-/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09x_/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09xé/symbols.o`, "unknown_load"],
        [`${directory}/rustcAz09xY.extra/symbols.o`, "unknown_load"],
        [`${f.input.sourceDirectory}/rustcAz09xY/symbols.o`, "unknown_load"],
        [`${f.input.scratchDirectory}/rustcAz09xY/symbols.o`, "scratch_load"],
        [`${f.input.scratchDirectory}/.rustcAz09xY/symbols.o`, "scratch_load"],
      ];
      for (const [file, category] of cases) {
        f.loads.push(file);
        const input = f.update();
        input.linkMapBytes = Buffer.from(input.linkMapBytes.toString().replace(`OUTPUT(${executable} `, `OUTPUT(${output} `));
        assert.deepEqual(await collectLinuxNotices(input), { ok: false, error: "notices_unknown_native", nativeCategory: category }, file);
        f.loads.pop();
      }
    });
  }
});

test("collector admits only exact regular native outputs, whether bundled or directly loaded", async () => {
  await diskFixture(async f => {
    const archives = planLinuxNotices(f.input).value.nativeArchives;
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_rust_missing");
    f.loads.push(...archives.map(archive => archive.file));
    assert.equal((await collectLinuxNotices(f.update())).error, "notices_rust_missing");
    for (const alias of [archives[0].file.replace("/out/", "/out/../out/"), path.join(archives[0].outDirectory, "libunreviewed.a"), path.join(f.input.scratchDirectory, ".rustcAb9/libsqlite3.a")]) {
      f.loads.push(alias);
      const result = await collectLinuxNotices(f.update());
      assert.equal(result.error, "notices_unknown_native");
      assert.equal(result.nativeCategory, alias.includes(".rustc") ? "scratch_load" : "generated_archive_load");
      f.loads.pop();
    }
    const other = path.join(archives[0].outDirectory, "libunreviewed.a");
    f.messages[1].filenames.push(other); f.loads.push(other);
    assert.deepEqual(await collectLinuxNotices(f.update()), { ok: false, error: "notices_unknown_native", nativeCategory: "artifact_path" });
  }, { ring: true });
});

test("missing, thin, empty, oversized and aliased native archives stay closed", async () => {
  for (const mode of ["missing", "thin", "empty", "oversized", "file-link", "directory-link"]) {
    await diskFixture(async f => {
      const archive = planLinuxNotices(f.input).value.nativeArchives[0], bytes = await readFile(archive.file);
      await rm(archive.file);
      if (mode === "thin") await writeFile(archive.file, "!<thin>\n");
      if (mode === "empty") await writeFile(archive.file, "");
      if (mode === "oversized") { await writeFile(archive.file, bytes); await truncate(archive.file, 32 * 1024 * 1024 + 1); }
      if (mode === "file-link") {
        const other = path.join(f.input.scratchDirectory, "same-native.a"); await writeFile(other, bytes); await symlink(other, archive.file);
      }
      if (mode === "directory-link") {
        const other = path.join(f.input.scratchDirectory, "same-output"); await mkdir(other);
        await writeFile(path.join(other, path.basename(archive.file)), bytes);
        await rm(archive.outDirectory, { recursive: true }); await symlink(other, archive.outDirectory);
      }
      assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_unknown_native", nativeCategory: "generated_archive" }, mode);
    });
  }
  await diskFixture(async f => {
    for (const archive of planLinuxNotices(f.input).value.nativeArchives) await truncate(archive.file, 22 * 1024 * 1024);
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_limit");
  }, { ring: true });
});

test("Ring nested notices are exact, mandatory, hash-bound and free of file or parent aliases", async () => {
  for (const mode of ["omitted", "changed", "missing", "file-link", "parent-link", "other-path", "other-package"]) {
    await diskFixture(async (f, policy, save) => {
      const pkg = f.packages.find(pkg => pkg.name === "ring"), mapped = policy.packages.find(pkg => pkg.name === "ring");
      const relative = ringLicenses[3], file = path.join(path.dirname(pkg.manifest_path), relative), bytes = await readFile(file);
      if (mode === "omitted") mapped.files = mapped.files.filter(value => value.path !== relative);
      if (mode === "changed") await writeFile(file, "changed notice\n");
      if (mode === "missing") await rm(file);
      if (mode === "file-link") {
        const other = path.join(f.input.scratchDirectory, "same-notice"); await writeFile(other, bytes); await rm(file); await symlink(other, file);
      }
      if (mode === "parent-link") {
        const other = path.join(f.input.scratchDirectory, "same-licenses"); await rename(path.dirname(file), other); await symlink(other, path.dirname(file));
      }
      if (mode === "other-path") mapped.files.push({ path: "src/other/LICENSE-MIT", sha256: digest(bytes) });
      if (mode === "other-package") policy.packages[0].files.push({ path: relative, sha256: digest(bytes) });
      await save();
      assert.equal((await collectLinuxNotices(f.input)).error, ["omitted", "other-path", "other-package"].includes(mode) ? "notices_unmapped_crate" : "notices_crate_changed", mode);
    }, { ring: true });
  }
});

test("collector validates Cargo registry archives without a vendored checksum file", async () => {
  await diskFixture(async f => {
    // Ordinary registry extraction has the cached .crate archive, not the
    // .cargo-checksum.json file that Cargo writes for a vendored directory.
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_rust_missing" });
  });
});

test("custody attribution rejects unknown or renamed workspace crates, foreign sources and paths, and changed licenses", async () => {
  const cases = [
    ["unknown workspace crate", () => ({ name: "unreviewed-workspace" }), "notices_unmapped_crate"],
    ["renamed product crate", () => ({ name: "aicharts-custody-renamed" }), "notices_unmapped_crate"],
    ["registry source", () => ({ source: registry }), "notices_unmapped_crate"],
    ["foreign source", () => ({ source: "git+https://example.invalid/PRIVATE_CANARY" }), "notices_unmapped_crate"],
    ["foreign manifest", f => ({ manifest_path: `${f.input.scratchDirectory}/aicharts-custody/Cargo.toml` }), "notices_unmapped_crate"],
    ["sibling manifest", f => ({ manifest_path: `${f.input.sourceDirectory}-other/crates/aicharts-custody/Cargo.toml` }), "notices_unmapped_crate"],
    ["noncanonical manifest", f => ({ manifest_path: `${f.input.sourceDirectory}/crates/./aicharts-custody/Cargo.toml` }), "notices_invalid_input"],
    ["changed license", () => ({ license: "Apache-2.0" }), "notices_unmapped_crate"],
  ];
  for (const [label, changes, error] of cases) {
    await diskFixture(async f => {
      addCustody(f, changes(f));
      assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error }, label);
    });
  }
});

test("collector refuses unmapped crate instead of admitting nonempty notice bytes", async () => {
  await diskFixture(async (f, policy, save) => {
    policy.packages = []; await save();
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_unmapped_crate" });
  });
});

test("the single reviewed Git crate requires exact identity, compiled files and license bytes", async () => {
  await diskFixture(async f => {
    const pkg = await addSupport(f);
    // The minimal fixture progresses past dependency admission to its missing
    // Rust toolchain notices. The complete Ubuntu join below covers success.
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_rust_missing" });
    for (const [field, value] of [["source", SUPPORT_SOURCE.replace("ed89e584", "00000000")],
      ["name", "other-package"], ["version", "0.4.1"], ["license", "Apache-2.0"], ["license_file", "LICENSE"]]) {
      const original = pkg[field]; pkg[field] = value; f.update();
      assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_unmapped_crate" });
      pkg[field] = original; f.update();
    }
    const checkout = path.dirname(path.dirname(pkg.manifest_path));
    for (const file of Object.keys(SUPPORT_FILES)) {
      const filename = path.join(checkout, file), original = await readFile(filename);
      await writeFile(filename, Buffer.concat([original, Buffer.from("mutation")]));
      assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_crate_changed" });
      await writeFile(filename, original);
    }
    const message = f.messages.find(message => message.package_id === pkg.id);
    const original = pkg.manifest_path; pkg.manifest_path = `${f.input.scratchDirectory}/rust/Cargo.toml`; message.manifest_path = pkg.manifest_path; f.update();
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_crate_changed" });
    pkg.manifest_path = original; message.manifest_path = original; f.update();
    message.target.kind = ["custom-build"]; f.update();
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_unmapped_crate" });
    message.target.kind = ["lib"]; f.update();
    const buildScript = path.join(checkout, "rust/build.rs");
    await writeFile(buildScript, "fn main() {}\n");
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_crate_changed" });
    await rm(buildScript);
    const license = path.join(checkout, "LICENSE");
    await rename(license, `${license}.retained`); await symlink(`${license}.retained`, license);
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_crate_changed" });
  });
});

test("collector binds registry notice bytes and package checksum to owned mapping", async () => {
  await diskFixture(async (f) => {
    await writeFile(path.join(path.dirname(f.packages[1].manifest_path), "LICENSE"), "altered notice\n");
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_crate_changed");
  });
  await diskFixture(async (f) => {
    await writeFile(crateArchive(f, f.packages[1]), "altered cached archive\n");
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_crate_changed");
  });
});

test("missing, empty, oversized and symlinked cached archives remain closed", async () => {
  for (const mode of ["missing", "empty", "oversized", "file-link", "directory-link"]) {
    await diskFixture(async f => {
      const archive = crateArchive(f, f.packages[1]), bytes = await readFile(archive);
      await rm(archive);
      if (mode === "empty") await writeFile(archive, Buffer.alloc(0));
      if (mode === "oversized") await writeFile(archive, Buffer.alloc(8 * 1024 * 1024 + 1));
      if (mode === "file-link") {
        const target = path.join(f.input.scratchDirectory, "same-archive");
        await writeFile(target, bytes); await symlink(target, archive);
      }
      if (mode === "directory-link") {
        const target = path.join(f.input.scratchDirectory, "same-registry");
        await mkdir(target); await writeFile(path.join(target, path.basename(archive)), bytes);
        await rm(path.dirname(archive), { recursive: true }); await symlink(target, path.dirname(archive));
      }
      assert.equal((await collectLinuxNotices(f.input)).error, "notices_crate_changed", mode);
    });
  }
});

test("collector refuses unmapped native LOAD before any dpkg query", async () => {
  await diskFixture(async f => {
    f.loads.push("/usr/lib/unreviewed.a");
    assert.equal((await collectLinuxNotices(f.update())).error, "notices_unknown_native");
  });
});

test("collector reports absent actual Rust notice evidence rather than success", async () => {
  await diskFixture(async f => {
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_rust_missing" });
  });
});

test("hashed linker output must be byte-identical to the exposed executable", async () => {
  await diskFixture(async f => {
    const output = `${path.dirname(f.input.executablePath)}/deps/aicharts-abc123`;
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, "first executable");
    await writeFile(f.input.executablePath, "different executable");
    f.input.linkMapBytes = Buffer.from(f.input.linkMapBytes.toString().replace(`OUTPUT(${f.input.executablePath} `, `OUTPUT(${output} `));
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_build_incomplete");
    await writeFile(f.input.executablePath, "first executable");
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_rust_missing");
  });
});

test("source mapping is unique, pinned and covers SQLite and Unicode notices", async () => {
  const policy = JSON.parse(await readFile(new URL("../../distribution/cli/linux-notices.json", import.meta.url), "utf8"));
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.registry, registry);
  const seen = new Set();
  for (const pkg of policy.packages) {
    const id = `${pkg.name}@${pkg.version}`;
    assert.equal(seen.has(id), false); seen.add(id);
    assert.match(pkg.checksum, /^[0-9a-f]{64}$/u);
    assert.ok(pkg.files.length > 0);
    for (const file of pkg.files) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/u);
      if (file.path.includes("/")) {
        if (id === "ring@0.17.14") assert.ok(ringLicenses.slice(3).includes(file.path));
        else { assert.equal(id, "zstd-sys@2.1.0+zstd.1.5.7"); assert.ok(zstdLicenses.includes(file.path)); }
      }
    }
  }
  assert.ok(seen.has("libsqlite3-sys@0.38.2"));
  assert.ok(policy.packages.find(pkg => pkg.name === "unicode-ident").files.some(file => file.path === "LICENSE-UNICODE"));
  assert.deepEqual(policy.packages.find(pkg => pkg.name === "ring" && pkg.version === "0.17.14").files.map(file => file.path).sort(), [...ringLicenses].sort());
  assert.deepEqual(policy.packages.find(pkg => pkg.name === "zstd-sys" && pkg.version === "2.1.0+zstd.1.5.7").files.map(file => file.path).sort(), [...zstdLicenses].sort());
  assert.ok(policy.packages.length <= 256);
});

test("complete synthetic Ubuntu filesystem and dpkg join emits deterministic notices", async () => {
  if (!process.execArgv.includes("--experimental-test-module-mocks")) {
    const result = await promisify(execFile)(process.execPath, ["--experimental-test-module-mocks", "--test", "--test-name-pattern=^complete synthetic Ubuntu filesystem", fileURLToPath(import.meta.url)], {
      timeout: 20_000, maxBuffer: 1024 * 1024, env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" },
    });
    assert.match(result.stdout, /pass 1/u);
    assert.doesNotMatch(result.stdout, /not ok/u);
    return;
  }
  const actual = await import("node:fs/promises");
  const { mock } = await import("node:test");
  await diskFixture(async f => {
    addCustody(f);
    await addSupport(f);
    const sysroot = f.input.sysrootDirectory;
    // Rust 1.97.1 installs generated HTML and REUSE texts. The legacy COPYRIGHT,
    // LICENSE-MIT and LICENSE-APACHE files exist only in its tarball overlay.
    const rustNotices = ["COPYRIGHT.html", "COPYRIGHT-library.html", "licenses/MIT.txt", "licenses/Apache-2.0.txt", "licenses/Unicode-3.0.txt"];
    for (const name of rustNotices) {
      const filename = `${sysroot}/share/doc/rust/${name}`;
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `Synthetic Rust notice: ${name}\n`);
    }
    const rustSourceNotices = ["compiler-builtins/LICENSE.txt", "stdarch/LICENSE-MIT", "backtrace/LICENSE-MIT", "backtrace/LICENSE-APACHE"];
    for (const name of [...rustSourceNotices, "vendor/libc-0.2.185/LICENSE-MIT"]) {
      const filename = `${sysroot}/lib/rustlib/src/rust/library/${name}`;
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `Synthetic Rust source notice: ${name}\n`);
    }
    const virtual = new Map([
      ["/usr/lib/gcc/x86_64-linux-gnu/11/crtbeginS.o", "libgcc-11-dev:amd64"],
      ["/usr/lib/x86_64-linux-gnu/Scrt1.o", "libc6-dev:amd64"],
      ["/usr/lib/x86_64-linux-gnu/libutil.a", "libc6-dev:amd64"],
      ["/lib/x86_64-linux-gnu/libc.so.6", "libc6:amd64"],
      ["/lib64/ld-linux-x86-64.so.2", "libc6:amd64"],
    ]);
    // The filesystem resolves GCC's spelling, while dpkg records the canonical
    // package path. A same-basename but different target is never sufficient.
    f.loads[4] = "/usr/lib/gcc/x86_64-linux-gnu/11/../../../x86_64-linux-gnu/Scrt1.o";
    const nativeArchives = planLinuxNotices(f.input).value.nativeArchives;
    f.loads.push(...nativeArchives.map(archive => archive.file), "/usr/lib/x86_64-linux-gnu/libutil.a", `${path.dirname(f.input.executablePath)}/rustcAz09xY/symbols.o`);
    f.update();
    const docFiles = new Map();
    for (const pkg of ["libgcc-11-dev", "libc6-dev", "libc6"]) {
      const file = `${f.input.sourceDirectory}/${pkg}.copyright`;
      // Ubuntu's GCC copyright has these unquoted sentence-terminal periods:
      // https://changelogs.ubuntu.com/changelogs/pool/main/g/gcc-11/gcc-11_11.4.0-1ubuntu1~22.04.3/copyright
      const gccProse = pkg === "libgcc-11-dev" ? "Full text: /usr/share/common-licenses/GPL.\nFull text: /usr/share/common-licenses/LGPL.\n" : "";
      await writeFile(file, `${pkg} synthetic copyright\nGCC Runtime Library Exception\n/usr/share/common-licenses/GPL-3\n${gccProse}`);
      docFiles.set(`/usr/share/doc/${pkg}/copyright`, file);
    }
    const commonNames = ["Apache-2.0", "Artistic", "BSD", "CC0-1.0", "GFDL", "GFDL-1.2", "GFDL-1.3", "GPL", "GPL-1", "GPL-2", "GPL-3", "LGPL", "LGPL-2", "LGPL-2.1", "LGPL-3", "MPL-1.1", "MPL-2.0"];
    const commonPrefix = "/usr/share/common-licenses/";
    for (const name of commonNames) {
      const common = `${f.input.sourceDirectory}/${name}`;
      await writeFile(common, `Synthetic common ${name} license fixture\n`);
      docFiles.set(`${commonPrefix}${name}`, common);
    }
    const commonLookups = [], gccCommonLookups = [];
    let queries = 0, mutateNative = false, mutateCommon = false, commonFault = null, copyrightSource = null;
    let queryFault = null, recordFault = false, copyrightFault = null;
    mock.module("node:child_process", { namedExports: { execFile: (file, args, options, callback) => {
      assert.equal(file, "/usr/bin/dpkg-query");
      assert.deepEqual(options.env, { PATH: "/usr/bin:/bin", LC_ALL: "C" });
      assert.equal(options.timeout, 30_000);
      queries += 1;
      if (queryFault !== null) {
        const error = new Error("PRIVATE_CANARY package query output");
        if (queryFault === "terminated") error.killed = true;
        if (queryFault === "output_limit") error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        callback(error);
        return;
      }
      let stdout;
      if (args[0] === "-S") {
        assert.equal(args.length, 2);
        // Ubuntu runners may expose /lib as a symlink to /usr/lib. The
        // collector deliberately queries that equivalent spelling, so the
        // synthetic owner map must accept both names while returning the
        // queried path verbatim.
        const virtualPath = virtual.has(args[1]) ? args[1] : args[1].replace(/^\/lib\//u, "/usr/lib/");
        assert.ok(virtual.has(virtualPath));
        stdout = `${virtual.get(virtualPath)}: ${args[1]}\n`;
      } else {
        assert.equal(args[0], "-W");
        assert.equal(args[1], "-f=${binary:Package}\t${Version}\t${Status}\n");
        stdout = recordFault ? "PRIVATE_CANARY invalid package record\n" : `${args[2]}\t11.4.0-test\tinstall ok installed\n`;
      }
      callback(null, { stdout });
    } } });
    mock.module("node:fs/promises", { namedExports: {
      ...actual,
      realpath: async file => {
        if (docFiles.has(file) && file.startsWith("/usr/share/doc/")) copyrightSource = file;
        if (file.startsWith("/usr/share/doc/") && copyrightFault === "outside") return "/usr/share/doc-other/PRIVATE_CANARY";
        if (file.startsWith(commonPrefix)) {
          commonLookups.push(file);
          if (copyrightSource === "/usr/share/doc/libgcc-11-dev/copyright") gccCommonLookups.push(file);
          if (commonFault === "missing" || !docFiles.has(file)) throw new Error("PRIVATE_CANARY missing fixture");
          if (commonFault === "outside") return `${f.input.sourceDirectory}/GPL`;
          if (commonFault === "sibling") return "/usr/share/common-licenses-other/GPL";
          return file;
        }
        return virtual.has(path.normalize(file)) ? path.normalize(file) : docFiles.has(file) ? file : actual.realpath(file);
      },
      lstat: (file, options) => {
        if (file.startsWith("/usr/share/doc/") && copyrightFault === "read") throw new Error("PRIVATE_CANARY copyright read failure");
        return actual.lstat(docFiles.get(file) ?? file, options);
      },
      open: async (file, flags) => {
        const handle = await actual.open(docFiles.get(file) ?? file, flags);
        const nativeChange = file === nativeArchives[0].file && mutateNative;
        const commonChange = file === `${commonPrefix}GPL` && mutateCommon;
        if (!nativeChange && !commonChange) return handle;
        return {
          stat: options => handle.stat(options), close: () => handle.close(),
          read: async (...args) => {
            const result = await handle.read(...args);
            if (nativeChange && mutateNative) { mutateNative = false; await actual.writeFile(file, "!<arch>\nchanged after open\n"); }
            if (commonChange && mutateCommon) { mutateCommon = false; await actual.writeFile(docFiles.get(file), "PRIVATE_CANARY changed after open\n"); }
            return result;
          },
        };
      },
    } });
    try {
      // Fresh module instance sees owned fakes. Production exports have no effect
      // override and this test never invokes or reads the host's dpkg/system docs.
      const { collectLinuxNotices: collect } = await import("./linux-notices.mjs?synthetic-full-join");
      const first = await collect(f.input);
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.value.sha256, digest(first.value.bytes));
      const body = first.value.bytes.toString();
      assert.match(body, /Cargo hraness-support-foundation 0\.4\.0 \(MIT\) \/ LICENSE/u);
      assert.match(body, /SQLite 3\.53\.2 amalgamation/u);
      assert.doesNotMatch(body, /===== Cargo aicharts-custody /u);
      for (const name of ringLicenses) assert.ok(body.includes(`Cargo ring 0.17.14 (Apache-2.0 AND ISC) / ${name}`));
      assert.match(body, /Rust REUSE license \/ Unicode-3\.0\.txt/u);
      for (const name of rustNotices) assert.ok(body.includes(`Synthetic Rust notice: ${name}\n`));
      for (const name of rustSourceNotices) assert.ok(body.includes(`Synthetic Rust source notice: ${name}\n`));
      assert.doesNotMatch(body, /===== Rust toolchain \/ (?:COPYRIGHT|LICENSE-MIT|LICENSE-APACHE) =====/u);
      assert.match(body, /Ubuntu package libgcc-11-dev:amd64/u);
      assert.match(body, /Ubuntu common license \/ GPL-3/u);
      assert.equal(body.includes(f.input.sourceDirectory), false);
      assert.equal(body.includes(f.input.cargoHomeDirectory), false);
      const second = await collect(f.input);
      assert.equal(second.ok, true);
      assert.deepEqual(second.value.bytes, first.value.bytes);
      assert.equal(second.value.sha256, first.value.sha256);
      assert.equal(second.value.components, first.value.components);
      // Per collection: five file owners, the deliberately missed GCC spelling,
      // and three package records. Shared libc6 ownership is queried only once.
      assert.equal(queries, 18);
      // Failure provenance survives the actual collector boundary without raw
      // package names, arguments, subprocess messages or filesystem paths.
      const expectSystem = async category => {
        const result = await collect(f.input);
        assert.deepEqual(result, { ok: false, error: "notices_system_missing", systemCategory: category });
        assert.equal(JSON.stringify(result).includes("PRIVATE_CANARY"), false);
      };
      for (const [fault, category] of [["query", "package_query"], ["terminated", "package_query_terminated"], ["output_limit", "package_query_output_limit"]]) {
        queryFault = fault;
        await expectSystem(category);
      }
      queryFault = null;
      recordFault = true;
      await expectSystem("package_record");
      recordFault = false;
      for (const [fault, category] of [["outside", "copyright_path"], ["read", "copyright_read"]]) {
        copyrightFault = fault;
        await expectSystem(category);
      }
      copyrightFault = null;
      for (const name of ["GPL", "GPL-3", "LGPL"]) {
        assert.ok(body.includes(`===== Ubuntu common license / ${name} =====\n`));
        assert.ok(body.includes(`Synthetic common ${name} license fixture\n`));
      }
      assert.equal(commonLookups.some(file => file.endsWith(".")), false);
      const gccCopyright = docFiles.get("/usr/share/doc/libgcc-11-dev/copyright");
      const gccBytes = await readFile(gccCopyright);
      const setReferences = references => writeFile(gccCopyright, `Synthetic GCC copyright\nGCC Runtime Library Exception\n${references}`);
      try {
        await writeFile(gccCopyright, "Synthetic GCC copyright without required exception\n");
        await expectSystem("gcc_exception");
        for (const [reference, category] of [
          [`prefix${commonPrefix}GPL`, "common_reference_prefix"],
          [`'${commonPrefix}GPL\"`, "common_reference_delimiter"],
          [`${commonPrefix}PRIVATE_CANARY`, "common_reference_name"],
        ]) {
          await setReferences(reference);
          await expectSystem(category);
        }
        // All known names retain one full text under every admitted quoting or
        // sentence form, regardless of duplicate/reversed source references.
        const formats = [
          name => `${commonPrefix}${name}`,
          name => `${commonPrefix}${name}.`,
          name => `'${commonPrefix}${name}'`,
          name => `"${commonPrefix}${name}"`,
          name => "`" + commonPrefix + name + "`",
          name => "`" + commonPrefix + name + "'",
        ];
        for (const format of formats) {
          await setReferences([...commonNames].reverse().flatMap(name => [format(name), format(name)]).join("\n"));
          const result = await collect(f.input);
          assert.equal(result.ok, true, JSON.stringify(result));
          const notices = result.value.bytes.toString();
          for (const name of commonNames) {
            assert.equal(notices.split(`===== Ubuntu common license / ${name} =====\n`).length - 1, 1);
            assert.ok(notices.includes(`Synthetic common ${name} license fixture\n`));
          }
        }
        for (const whitespace of [" ", "\t", "\n", "\r", "\f", "\v"]) {
          await setReferences(`${commonPrefix}LGPL-2.1.${whitespace}Next sentence.`);
          const result = await collect(f.input);
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.ok(result.value.bytes.includes(Buffer.from("===== Ubuntu common license / LGPL-2.1 =====\n")));
        }
        const malformed = [
          commonPrefix, `${commonPrefix}PRIVATE_CANARY`, `${commonPrefix}GPL..`,
          `${commonPrefix}./GPL`, `${commonPrefix}../GPL`, `${commonPrefix}subdir/GPL`,
          `${commonPrefix}GPL/PRIVATE_CANARY`, `${commonPrefix}GPL/../LGPL`, `${commonPrefix}GPL./`,
          `${commonPrefix}GPL-3.extra`, `${commonPrefix}GPL-3+extra`, `${commonPrefix}GPL-3%2fextra`,
          `${commonPrefix}GPL-3?extra`, `${commonPrefix}GPL-3#extra`, `${commonPrefix}GPL-3\\extra`,
          `${commonPrefix}GPL.,`, `${commonPrefix}GPL.)`, `${commonPrefix}GPL.\u00a0`,
          `${commonPrefix}GPL-3\u00a0`, `${commonPrefix}GPL.'`, `${commonPrefix}GPL"`,
          `"${commonPrefix}GPL'`, `'${commonPrefix}GPL"`, `"${commonPrefix}GPL\n"`,
          `/tmp${commonPrefix}GPL`, `prefix${commonPrefix}GPL`,
        ];
        for (const name of commonNames) {
          malformed.push(`'${commonPrefix}${name}.'`, `"${commonPrefix}${name}."`, "`" + commonPrefix + name + ".'", `${commonPrefix}${name}/PRIVATE_CANARY`);
        }
        for (const reference of malformed) {
          await setReferences(reference);
          // Other admitted packages may precede GCC in the sorted LOAD map.
          // The malformed document itself must cause no common-license lookup.
          const before = gccCommonLookups.length;
          assert.equal((await collect(f.input)).error, "notices_system_missing", reference);
          assert.deepEqual(gccCommonLookups.slice(before), [], reference);
        }
        await setReferences(`${commonPrefix}GPL`);
        for (const fault of ["missing", "outside", "sibling"]) {
          commonFault = fault;
          await expectSystem("common_license_path");
        }
        commonFault = null;
        const commonFile = docFiles.get(`${commonPrefix}GPL`), commonBytes = await readFile(commonFile);
        try {
          await writeFile(commonFile, Buffer.from([0xc3, 0x28]));
          assert.deepEqual(await collect(f.input), { ok: false, error: "notices_invalid_input" });
          await writeFile(commonFile, Buffer.alloc(1024 * 1024 + 1, 0x20));
          await expectSystem("common_license_read");
          await writeFile(commonFile, commonBytes);
          mutateCommon = true;
          assert.deepEqual(await collect(f.input), { ok: false, error: "notices_source_changed" });
        } finally { mutateCommon = false; await writeFile(commonFile, commonBytes); }
      } finally { commonFault = null; await writeFile(gccCopyright, gccBytes); }
      // A permitted stub name cannot substitute another Ubuntu owner's file.
      virtual.set("/usr/lib/x86_64-linux-gnu/libutil.a", "libgcc-11-dev:amd64");
      await expectSystem("package_owner");
      virtual.set("/usr/lib/x86_64-linux-gnu/libutil.a", "libc6-dev:amd64");
      mutateNative = true;
      const beforeNative = queries;
      assert.equal((await collect(f.input)).error, "notices_source_changed");
      assert.equal(queries, beforeNative);
      await writeFile(nativeArchives[0].file, "!<arch>\n");
      // Removing an installed required notice still fails before system queries;
      // archive-only legacy files are not substitutes for these actual texts.
      const requiredFiles = [
        ...rustNotices.map(name => `${sysroot}/share/doc/rust/${name}`),
        ...rustSourceNotices.map(name => `${sysroot}/lib/rustlib/src/rust/library/${name}`),
      ];
      for (const filename of requiredFiles) {
        const bytes = await readFile(filename), before = queries;
        await rm(filename);
        try {
          assert.deepEqual(await collect(f.input), { ok: false, error: "notices_rust_missing" });
          assert.equal(queries, before);
        } finally { await writeFile(filename, bytes); }
      }
    } finally { mock.restoreAll(); }
  }, { ring: true });
});
