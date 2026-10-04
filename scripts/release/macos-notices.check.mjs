import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { collectMacosNotices } from "./macos-notices.mjs";

const REGISTRY = "registry+https://github.com/rust-lang/crates.io-index";
const digest = text => createHash("sha256").update(text).digest("hex");
let root, input;

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "aicharts-macos-notices-")));
  const source = path.join(root, "source"), cargoHome = path.join(root, "cargo"), sysroot = path.join(root, "sysroot");
  const crate = path.join(cargoHome, "registry/src/index.crates.io-0000000000000000/demo-1.0.0");
  write(path.join(crate, "LICENSE-MIT"), "demo MIT text\n");
  write(path.join(source, "distribution/cli/linux-notices.json"), JSON.stringify({
    schemaVersion: 1, registry: REGISTRY,
    packages: [{ name: "demo", version: "1.0.0", checksum: "0".repeat(64), license: "MIT", files: [{ path: "LICENSE-MIT", sha256: digest("demo MIT text\n") }] }],
  }));
  for (const name of ["COPYRIGHT.html", "COPYRIGHT-library.html", "licenses/MIT.txt", "licenses/Apache-2.0.txt", "licenses/Unicode-3.0.txt"]) write(path.join(sysroot, "share/doc/rust", name), `${name}\n`);
  for (const name of ["compiler-builtins/LICENSE.txt", "stdarch/LICENSE-MIT", "backtrace/LICENSE-MIT", "backtrace/LICENSE-APACHE", "vendor/hashbrown-0.15.0/LICENSE-MIT"]) {
    write(path.join(sysroot, "lib/rustlib/src/rust/library", name), `${name}\n`);
  }
  const packages = [
    { id: "path+file:///source/crates/aicharts-cli#0.3.1", name: "aicharts-cli", version: "0.3.1", source: null, license: "MIT", manifest_path: path.join(source, "crates/aicharts-cli/Cargo.toml") },
    { id: `${REGISTRY}#demo@1.0.0`, name: "demo", version: "1.0.0", source: REGISTRY, license: "MIT", manifest_path: path.join(crate, "Cargo.toml") },
  ];
  const messages = packages.map(pkg => JSON.stringify({ reason: "compiler-artifact", package_id: pkg.id, target: { kind: ["lib"] } })).join("\n") + "\n";
  input = { source, cargoHome, sysroot, messages, metadata: { packages } };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("covers mapped crates and the Rust toolchain while leaving the project LICENSE to the archive", async () => {
  const { bytes, components } = await collectMacosNotices(input);
  const text = bytes.toString("utf8");
  assert.ok(text.startsWith("AI Charts macOS CLI third-party notices\n"));
  assert.ok(text.includes(`===== Cargo demo 1.0.0 (MIT) / LICENSE-MIT =====\nSHA-256: ${digest("demo MIT text\n")}\n\ndemo MIT text\n`));
  assert.ok(text.includes("===== Rust REUSE license / Unicode-3.0.txt ====="));
  assert.ok(text.includes("===== Rust vendored source hashbrown-0.15.0 / LICENSE-MIT ====="));
  assert.ok(!text.includes("aicharts-cli"));
  assert.equal(components, 1 + 2 + 3 + 4 + 1);
  const labels = [...text.matchAll(/^===== (.+) =====$/gmu)].map(match => match[1]);
  assert.deepEqual(labels, [...labels].sort());
});

test("fails closed on an unmapped crate, a changed license text or a build without the binary", async () => {
  const unmapped = structuredClone(input);
  unmapped.metadata.packages[1].version = "1.0.1";
  unmapped.metadata.packages[1].id = `${REGISTRY}#demo@1.0.1`;
  unmapped.messages = input.messages.replace("demo@1.0.0", "demo@1.0.1");
  await assert.rejects(collectMacosNotices(unmapped), /notices_unmapped_crate:demo@1\.0\.1/u);
  const noBinary = { ...input, messages: input.messages.split("\n").slice(1).join("\n") };
  await assert.rejects(collectMacosNotices(noBinary), /notices_build_incomplete/u);
  write(path.join(input.cargoHome, "registry/src/index.crates.io-0000000000000000/demo-1.0.0/LICENSE-MIT"), "changed\n");
  await assert.rejects(collectMacosNotices(input), /notices_crate_changed:demo@1\.0\.0/u);
});

test("refuses a symlinked toolchain notice", async () => {
  const file = path.join(input.sysroot, "share/doc/rust/COPYRIGHT.html");
  rmSync(file);
  const { symlinkSync } = await import("node:fs");
  symlinkSync(path.join(input.sysroot, "share/doc/rust/COPYRIGHT-library.html"), file);
  await assert.rejects(collectMacosNotices(input), /notices_rust_missing/u);
});
