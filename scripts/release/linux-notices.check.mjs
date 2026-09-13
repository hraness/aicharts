import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectLinuxNotices, planLinuxNotices } from "./linux-notices.mjs";

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
    { id: "registry+https://github.com/rust-lang/crates.io-index#libsqlite3-sys@0.38.2", name: "libsqlite3-sys", version: "0.38.2", source: registry, license: "MIT", license_file: null, manifest_path: `${cargoHomeDirectory}/registry/src/index-fixture/libsqlite3-sys-0.38.2/Cargo.toml` },
    { id: "registry+https://github.com/rust-lang/crates.io-index#unicode-ident@1.0.24", name: "unicode-ident", version: "1.0.24", source: registry, license: "(MIT OR Apache-2.0) AND Unicode-3.0", license_file: null, manifest_path: `${cargoHomeDirectory}/registry/src/index-fixture/unicode-ident-1.0.24/Cargo.toml` },
  ];
  const messages = packages.map(pkg => ({ reason: "compiler-artifact", package_id: pkg.id, manifest_path: pkg.manifest_path,
    target: { name: pkg.name === "aicharts-cli" ? "aicharts" : pkg.name.replaceAll("-", "_"), kind: pkg.name === "aicharts-cli" ? ["bin"] : ["lib"] },
    profile: { test: false }, filenames: pkg.name === "aicharts-cli" ? [executablePath] : [`${targetDirectory}/release/deps/lib${pkg.name.replaceAll("-", "_")}-123abc.rlib`],
    executable: pkg.name === "aicharts-cli" ? executablePath : null }));
  messages.push({ reason: "build-script-executed", package_id: packages[1].id, linked_libs: ["static=sqlite3"] });
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

test("map paths never accept relative paths or shell-like whitespace", () => {
  for (const filename of ["../untrusted.a", "/tmp/a b.a"]) {
    const f = fixture(); f.loads.push(filename);
    assert.equal(planLinuxNotices(f.update()).ok, false);
  }
});

test("bfd retains absolute GCC dot segments and rustc hidden temp directories", () => {
  const f = fixture();
  f.loads.push("/usr/lib/gcc/x86_64-linux-gnu/11/../../../x86_64-linux-gnu/Scrt1.o", "/fixture/tmp/.rustcAb9/symbols.o");
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

async function diskFixture(fn) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "aicharts-notices-"));
  // macOS /var is a symlink; the collector takes canonical runner-owned roots.
  const { realpath } = await import("node:fs/promises");
  const directory = await realpath(temporary);
  try {
    const f = fixture(directory);
    for (const key of ["sourceDirectory", "cargoHomeDirectory", "targetDirectory", "sysrootDirectory", "scratchDirectory"]) await mkdir(f.input[key], { recursive: true });
    await mkdir(`${f.input.sourceDirectory}/distribution/cli`, { recursive: true });
    const policy = { schemaVersion: 1, registry, packages: [] };
    for (const pkg of f.packages.filter(pkg => pkg.source)) {
      const dir = path.dirname(pkg.manifest_path);
      await mkdir(dir, { recursive: true });
      const body = Buffer.from(`Synthetic ${pkg.name} notice fixture\n`);
      const file = pkg.name === "unicode-ident" ? "LICENSE-UNICODE" : "LICENSE";
      const checksum = digest(Buffer.from(pkg.name));
      await writeFile(`${dir}/${file}`, body);
      await writeFile(`${dir}/.cargo-checksum.json`, encode({ files: {}, package: checksum }));
      policy.packages.push({ name: pkg.name, version: pkg.version, checksum, license: pkg.license, files: [{ path: file, sha256: digest(body) }] });
      if (pkg.name === "libsqlite3-sys") {
        await mkdir(`${dir}/sqlite3`);
        await writeFile(`${dir}/sqlite3/sqlite3.c`, "** version 3.53.2.\n/*\n** 2001 September 15\n** The author disclaims copyright\n** May you share freely, never taking more than you give.\n*/\n");
      }
    }
    const policyPath = `${f.input.sourceDirectory}/distribution/cli/linux-notices.json`;
    await writeFile(policyPath, encode(policy));
    await fn(f, policy, async () => writeFile(policyPath, encode(policy)));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("collector refuses unmapped crate instead of admitting nonempty notice bytes", async () => {
  await diskFixture(async (f, policy, save) => {
    policy.packages = []; await save();
    assert.deepEqual(await collectLinuxNotices(f.input), { ok: false, error: "notices_unmapped_crate" });
  });
});

test("collector binds registry notice bytes and package checksum to owned mapping", async () => {
  await diskFixture(async (f) => {
    await writeFile(path.join(path.dirname(f.packages[1].manifest_path), "LICENSE"), "altered notice\n");
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_crate_changed");
  });
  await diskFixture(async (f) => {
    await writeFile(path.join(path.dirname(f.packages[1].manifest_path), ".cargo-checksum.json"), encode({ package: "0".repeat(64) }));
    assert.equal((await collectLinuxNotices(f.input)).error, "notices_crate_changed");
  });
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
    for (const file of pkg.files) { assert.match(file.sha256, /^[0-9a-f]{64}$/u); assert.equal(file.path.includes("/"), false); }
  }
  assert.ok(seen.has("libsqlite3-sys@0.38.2"));
  assert.ok(policy.packages.find(pkg => pkg.name === "unicode-ident").files.some(file => file.path === "LICENSE-UNICODE"));
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
    const sysroot = f.input.sysrootDirectory;
    for (const name of ["COPYRIGHT", "COPYRIGHT.html", "COPYRIGHT-library.html", "LICENSE-MIT", "LICENSE-APACHE", "licenses/MIT.txt", "licenses/Apache-2.0.txt", "licenses/Unicode-3.0.txt"]) {
      const filename = `${sysroot}/share/doc/rust/${name}`;
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `Synthetic Rust notice: ${name}\n`);
    }
    for (const name of ["compiler-builtins/LICENSE.txt", "stdarch/LICENSE-MIT", "backtrace/LICENSE-MIT", "backtrace/LICENSE-APACHE", "vendor/libc-0.2.185/LICENSE-MIT"]) {
      const filename = `${sysroot}/lib/rustlib/src/rust/library/${name}`;
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, `Synthetic Rust source notice: ${name}\n`);
    }
    const virtual = new Map([
      ["/usr/lib/gcc/x86_64-linux-gnu/11/crtbeginS.o", "libgcc-11-dev:amd64"],
      ["/usr/lib/x86_64-linux-gnu/Scrt1.o", "libc6-dev:amd64"],
      ["/lib/x86_64-linux-gnu/libc.so.6", "libc6:amd64"],
      ["/lib64/ld-linux-x86-64.so.2", "libc6:amd64"],
    ]);
    // The filesystem resolves GCC's spelling, while dpkg records the canonical
    // package path. A same-basename but different target is never sufficient.
    f.loads[4] = "/usr/lib/gcc/x86_64-linux-gnu/11/../../../x86_64-linux-gnu/Scrt1.o";
    f.update();
    const docFiles = new Map();
    for (const pkg of ["libgcc-11-dev", "libc6-dev", "libc6"]) {
      const file = `${f.input.sourceDirectory}/${pkg}.copyright`;
      await writeFile(file, `${pkg} synthetic copyright\nGCC Runtime Library Exception\n/usr/share/common-licenses/GPL-3\n`);
      docFiles.set(`/usr/share/doc/${pkg}/copyright`, file);
    }
    const common = `${f.input.sourceDirectory}/GPL-3`;
    await writeFile(common, "Synthetic common GPL-3 license fixture\n");
    docFiles.set("/usr/share/common-licenses/GPL-3", common);
    let queries = 0;
    mock.module("node:child_process", { namedExports: { execFile: (file, args, options, callback) => {
      assert.equal(file, "/usr/bin/dpkg-query");
      assert.deepEqual(options.env, { PATH: "/usr/bin:/bin", LC_ALL: "C" });
      assert.equal(options.timeout, 5000);
      queries += 1;
      let stdout;
      if (args[0] === "-S") {
        assert.equal(args.length, 2);
        assert.ok(virtual.has(args[1]));
        stdout = `${virtual.get(args[1])}: ${args[1]}\n`;
      } else {
        assert.equal(args[0], "-W");
        assert.equal(args[1], "-f=${binary:Package}\t${Version}\t${Status}\n");
        stdout = `${args[2]}\t11.4.0-test\tinstall ok installed\n`;
      }
      callback(null, { stdout });
    } } });
    mock.module("node:fs/promises", { namedExports: {
      ...actual,
      realpath: async file => virtual.has(path.normalize(file)) ? path.normalize(file) : docFiles.has(file) ? file : actual.realpath(file),
      lstat: (file, options) => actual.lstat(docFiles.get(file) ?? file, options),
      open: (file, flags) => actual.open(docFiles.get(file) ?? file, flags),
    } });
    try {
      // Fresh module instance sees owned fakes. Production exports have no effect
      // override and this test never invokes or reads the host's dpkg/system docs.
      const { collectLinuxNotices: collect } = await import("./linux-notices.mjs?synthetic-full-join");
      const first = await collect(f.input);
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.value.sha256, digest(first.value.bytes));
      const body = first.value.bytes.toString();
      assert.match(body, /SQLite 3\.53\.2 amalgamation/u);
      assert.match(body, /Rust REUSE license \/ Unicode-3\.0\.txt/u);
      assert.match(body, /Ubuntu package libgcc-11-dev:amd64/u);
      assert.match(body, /Ubuntu common license \/ GPL-3/u);
      assert.equal(body.includes(f.input.sourceDirectory), false);
      assert.equal(body.includes(f.input.cargoHomeDirectory), false);
      const second = await collect(f.input);
      assert.equal(second.ok, true);
      assert.deepEqual(second.value.bytes, first.value.bytes);
      assert.equal(second.value.sha256, first.value.sha256);
      assert.equal(second.value.components, first.value.components);
      assert.ok(queries > 0 && queries <= 16);
    } finally { mock.restoreAll(); }
  });
});
