import assert from "node:assert/strict";
import test from "node:test";
import { encodeLinuxQualificationReport, validateLinuxQualificationReport } from "./linux-qualification.mjs";

const input = {
  schemaVersion: 1, qualified: true, profile: "linux-cli-v1", version: "0.1.0",
  source: { commit: "a".repeat(40), tree: "b".repeat(40), commitTime: "2026-09-12T18:00:00Z" },
  runner: { label: "ubuntu-22.04", imageVersion: "20260910.1", runId: "123", runAttempt: 1 },
  toolchain: { rustChannel: "1.97.1", rustCommit: "c".repeat(40), nodeMajor: 24, cCompiler: { name: "gcc", version: "11.4.0" } },
  target: { triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64", dynamicDependencies: ["libc.so.6", "libgcc_s.so.1"] },
  executable: { bytes: 1000, sha256: "d".repeat(64) }, smoke: { passed: true, invocations: 8 },
  notices: { complete: true, bytes: 2000, sha256: "e".repeat(64) },
};

test("qualification reports encode and validate canonically", () => {
  const encoded = encodeLinuxQualificationReport(input);
  assert.equal(encoded.ok, true);
  if (!encoded.ok) return;
  const decoded = validateLinuxQualificationReport(encoded.value.bytes);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.value, encoded.value.value);
  assert.equal(decoded.value.sha256, encoded.value.sha256);
});

test("qualification refuses incomplete, wrong-profile and noncanonical reports", () => {
  assert.deepEqual(encodeLinuxQualificationReport({ ...input, qualified: false }), { ok: false, error: "invalid_report" });
  assert.deepEqual(encodeLinuxQualificationReport({ ...input, profile: "linux-cli-v2" }), { ok: false, error: "unsupported_profile" });
  const encoded = encodeLinuxQualificationReport(input);
  assert.equal(encoded.ok, true);
  if (!encoded.ok) return;
  const tampered = Buffer.from(encoded.value.bytes);
  tampered[tampered.length - 2] ^= 1;
  assert.deepEqual(validateLinuxQualificationReport(tampered), { ok: false, error: "invalid_report" });
});

test("qualification refuses unsupported dependencies and oversized reports", () => {
  assert.deepEqual(encodeLinuxQualificationReport({ ...input, target: { ...input.target, dynamicDependencies: ["/tmp/lib.so"] } }), { ok: false, error: "invalid_report" });
  assert.deepEqual(validateLinuxQualificationReport(new Uint8Array(65 * 1024)), { ok: false, error: "limit_exceeded" });
});
