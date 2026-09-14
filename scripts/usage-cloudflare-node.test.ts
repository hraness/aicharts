import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = new URL("../", import.meta.url);
const loader = new URL("./usage-cloudflare-node.mjs", import.meta.url).href;
const sourceUrl = (relative: string): string => new URL(relative, repository).href;
const options = { cwd: fileURLToPath(repository), encoding: "utf8" as const, timeout: 10_000,
  maxBuffer: 65_536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test" as const } };

test("native Node imports the full qualification graph and transforms its parameter property", () => {
  const program = `
    import assert from "node:assert/strict";
    const { qualificationSummary } = await import(${JSON.stringify(sourceUrl("scripts/usage-cloudflare-qualification.ts"))});
    const { parseQualificationRun, QUALIFICATION_RUN_MS } = await import(${JSON.stringify(sourceUrl("fixtures/usage/cloudflare-qualification.ts"))});
    const { AdmissionFault } = await import(${JSON.stringify(sourceUrl("services/usage-worker/src/admission-policy.ts"))});
    const { namespaceAnchorKey, encodeNamespaceAnchor } = await import(${JSON.stringify(sourceUrl("services/usage-worker/src/namespace-anchor.ts"))});
    const fault = new AdmissionFault("revoked");
    assert.equal(fault.code, "revoked");
    assert.equal(fault.message, "revoked");
    const run = parseQualificationRun({ schemaVersion: 1, runId: "d".repeat(24), createdAtMs: 20_010 * 86_400_000,
      expiresAtMs: 20_010 * 86_400_000 + QUALIFICATION_RUN_MS, firstUtcDay: 20_007,
      generationOne: "1".repeat(64), generationTwo: "2".repeat(64) });
    assert.ok(run);
    const summary = qualificationSummary({ schemaVersion: 1, accountId: "a".repeat(32), sourceSha: "b".repeat(40),
      sourceDigest: "c".repeat(64), run, deployments: [], steps: [] });
    assert.equal(summary.completedSteps, 0);
    assert.equal(summary.totalSteps, 41);
    assert.equal(summary.productionActivation, false);
    const accountId = "acct_" + "a".repeat(32);
    assert.equal(namespaceAnchorKey(accountId), "account-control/v1/" + "a".repeat(32) + "/namespace.aicn");
    assert.equal(encodeNamespaceAnchor({ accountId, namespaceKey: "3".repeat(64), intentId: "4".repeat(64),
      reservationId: "5".repeat(64), generation: "6".repeat(64), createdAtMs: run.createdAtMs }).length, 160);
    // The same existing source remains unresolved without an admitted parent/specifier edge.
    await assert.rejects(import(${JSON.stringify(sourceUrl("lib/usage/wire"))}), { code: "ERR_MODULE_NOT_FOUND" });
    process.stdout.write("qualification-node-graph-ok\\n");
  `;
  const result = spawnSync("node", ["--experimental-transform-types", "--import", loader, "--input-type=module", "--eval", program], options);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("qualification-node-graph-ok\n");
});

test("native Node executes the driver command entrypoint", () => {
  const driver = fileURLToPath(new URL("./usage-cloudflare-qualification.ts", import.meta.url));
  const result = spawnSync("node", ["--experimental-transform-types", "--import", loader,
    driver, "invalid-command", fileURLToPath(repository)], options);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("usage-cloudflare-qualification: stopped; inspect the private manifest and recorded deployment evidence");
});

test("missing native transform flag refuses before the entry source executes", () => {
  const result = spawnSync("node", ["--import", loader, "--input-type=module", "--eval", "process.stdout.write('source-loaded')"], options);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("usage-cloudflare-node: transform_types_flag_required");
});

test("Bun is refused even when the required Node flag is present", () => {
  // Bun cannot apply Node's native transform flag. Supplying only its metadata
  // isolates the runtime guard while retaining the real Bun process.
  const program = `process.execArgv.push("--experimental-transform-types");
    await import(${JSON.stringify(loader)}); process.stdout.write("source-loaded");`;
  const result = spawnSync(process.execPath, ["--eval", program], options);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("usage-cloudflare-node: native_node_24_required");
});
