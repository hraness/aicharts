import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { kernelStageUnchanged, proofEnvironment, proofFilesUnchanged, sha256, stageKernel } from "./assurance-proof-common";

function snapshot() {
  const bytes = new Map([
    ["Cargo.toml", Buffer.from('[workspace]\nmembers = ["crates/aicharts-metrics"]\n[workspace.package]\nversion = "0.1.0"\nedition = "2021"\n')],
    ["Cargo.lock", Buffer.from("original workspace lock")],
    ["crates/aicharts-metrics/Cargo.toml", Buffer.from('[package]\nname = "aicharts-metrics"\nversion.workspace = true\n')],
    ["crates/aicharts-metrics/src/lib.rs", Buffer.from("pub fn measured() -> u8 { 1 }")],
    ["crates/aicharts-metrics/src/proofs.rs", Buffer.from("unchanged proof")],
    ["rust-toolchain.toml", Buffer.from('[toolchain]\nchannel = "1.97.1"\n')],
  ]);
  return { bytes, hashes: Object.fromEntries([...bytes].map(([path, bytes]) => [path, sha256(bytes)])) };
}

describe("production proof staging", () => {
  test("recorded source and generated artifacts are checked after execution", async () => {
    const run = await mkdtemp(resolve(tmpdir(), "aicharts-proof-stage-"));
    try {
      const stage = await stageKernel(run, "production", snapshot());
      expect(await kernelStageUnchanged(stage)).toBe(true);
      await writeFile(resolve(stage.path, "Proof.lean"), "exact generated proof");
      const hashes = { "Proof.lean": sha256("exact generated proof") };
      expect(await proofFilesUnchanged(stage.path, hashes)).toBe(true);
      await writeFile(resolve(stage.path, "Proof.lean"), "changed generated proof");
      expect(await proofFilesUnchanged(stage.path, hashes)).toBe(false);
      await writeFile(resolve(stage.path, "crates/aicharts-metrics/src/lib.rs"), "changed production body");
      expect(await kernelStageUnchanged(stage)).toBe(false);
    } finally { await rm(run, { recursive: true, force: true }); }
  });
  test("unrecorded source, build scripts, reused stages and harness mutations refuse", async () => {
    const run = await mkdtemp(resolve(tmpdir(), "aicharts-proof-refusal-"));
    try {
      const stage = await stageKernel(run, "production", snapshot());
      await expect(stageKernel(run, "production", snapshot())).rejects.toThrow();
      await expect(stageKernel(run, "../outside", snapshot())).rejects.toThrow("invalid_kernel_stage_name");
      await expect(stageKernel(run, "mutant", snapshot(), { id: "bad", source: "crates/aicharts-metrics/src/proofs.rs",
        exactBefore: "unchanged", exactAfter: "changed" })).rejects.toThrow("mutation_must_target_production");
      await writeFile(resolve(stage.path, "crates/aicharts-metrics/src/extra.rs"), "unrecorded module");
      expect(await kernelStageUnchanged(stage)).toBe(false);
      await rm(resolve(stage.path, "crates/aicharts-metrics/src/extra.rs"));
      expect(await kernelStageUnchanged(stage)).toBe(true);
      await writeFile(resolve(stage.path, "crates/aicharts-metrics/build.rs"), "unrecorded build script");
      expect(await kernelStageUnchanged(stage)).toBe(false);
    } finally { await rm(run, { recursive: true, force: true }); }
  });
  test("tool environments do not inherit proof paths, wrappers, preload hooks or assumptions", () => {
    expect(proofEnvironment({ HOME: "/user", PATH: "/tools", CARGO_HOME: "/cargo", RUSTUP_HOME: "/other-rust", RUSTFLAGS: "--cfg replaced",
      KANI_FLAGS: "--no-unwinding-checks", LEAN_PATH: "/replacement", LEAN_SYSROOT: "/replacement", RUSTC_WRAPPER: "/wrapper",
      DYLD_INSERT_LIBRARIES: "/injected", LD_PRELOAD: "/injected" })).toEqual({ NODE_ENV: "test", HOME: "/user", PATH: "/tools", CARGO_HOME: "/cargo", CARGO_NET_OFFLINE: "true" });
  });
});
