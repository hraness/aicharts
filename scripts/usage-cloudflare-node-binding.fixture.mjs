import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { Miniflare, convertV4MiniflareOptions } from "/Users/bg/Documents/Codex/2026-09-02/i-w/work/aicharts-admission/node_modules/miniflare/dist/src/index.js";

const root = "/Users/bg/Documents/Codex/2026-09-13/res/work/aicharts-terminal-integration";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !specifier.endsWith(".ts") && context.parentURL?.startsWith(pathToFileURL(root).href))
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context, nextResolve);
  return nextResolve(specifier, context, nextResolve);
} });
const { dispatchQualificationStep, prepareQualification, qualificationConfigs, recordQualificationDeployment, QUALIFICATION_TARGET } =
  await import(`${pathToFileURL(join(root, "scripts/usage-cloudflare-qualification.ts"))}`);
const { qualificationDigest } = await import(`${pathToFileURL(join(root, "fixtures/usage/cloudflare-qualification.ts"))}`);

const sourceSha = "b".repeat(40);
const accountId = "a".repeat(32);

function receipt(manifest) {
  return {
    schemaVersion: 1, phase: "initial", accountId, ...QUALIFICATION_TARGET,
    sourceSha: manifest.sourceSha, sourceDigest: manifest.sourceDigest,
    runDigest: qualificationDigest(JSON.stringify(manifest.run)),
    configSha256: qualificationDigest(qualificationConfigs(manifest.run, accountId).generationOne),
    versionId: "1".repeat(32), deploymentId: "2".repeat(32),
    pairingsNamespaceId: "3".repeat(32), enrollmentsNamespaceId: "4".repeat(32),
    workersDev: false, previewUrls: false, routeCount: 0, observabilityEnabled: false,
    trafficPercent: 100, verifiedAtMs: manifest.run.createdAtMs + 1,
  };
}

function targetScript(mode) {
  return `let count = 0; export default { async fetch(request) {
    count++; if (new URL(request.url).pathname === "/count") return Response.json({ count });
    if (${JSON.stringify(mode)} === "redirect" && new URL(request.url).pathname !== "/follow")
      return new Response(null, { status: 302, headers: { location: "https://synthetic.invalid/follow" } });
    const input = await request.json();
    const value = { objects: [] };
    const body = JSON.stringify({ schemaVersion: 1, runId: input.runId, stage: input.stage, ok: true, value });
    return new Response(body, { headers: {
      "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow",
    } });
  } };`;
}

async function run(mode) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "aicharts-node-binding-parent-")));
  const path = join(parent, "run");
  const runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, workers: [
    { name: "driver", compatibilityDate: "2026-09-10", modules: true,
      script: "export default { fetch() { return new Response(null, { status: 503 }); } };",
      serviceBindings: { QUALIFICATION: "target" } },
    { name: "target", compatibilityDate: "2026-09-10", modules: true, script: targetScript(mode) },
  ] }));
  try {
    const manifest = await prepareQualification(path, sourceSha, { accountId, ...QUALIFICATION_TARGET });
    await recordQualificationDeployment(path, receipt(manifest), false);
    const calls = [];
    const platform = await runtime.getBindings("driver");
    const factory = async () => ({ env: { QUALIFICATION: {
      fetch: (input, init) => {
        calls.push({ input, init, signalOpen: init.signal?.aborted === false });
        return platform.QUALIFICATION.fetch(input, init);
      },
    } }, dispose: async () => {} });
    const result = await dispatchQualificationStep(path, { factory, verifySource: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "https://aicharts-usage-qualification.invalid/v1/run");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.redirect, "error");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(calls[0].signalOpen, true);
    assert.deepEqual(calls[0].init.headers, { accept: "application/json", "content-type": "application/json" });
    assert.ok(calls[0].init.body instanceof Uint8Array);
    assert.equal(Buffer.from(calls[0].init.body).toString("hex"), result.steps[0].requestHex);
    if (mode === "success") {
      assert.equal(result.steps[0].state, "complete");
      assert.equal((await platform.QUALIFICATION.fetch("https://synthetic.invalid/count")).status, 200);
    } else {
      assert.equal(result.steps[0].state, "ambiguous");
      assert.equal(calls.length, 1, "redirect response must not trigger a second service request");
      assert.deepEqual(await (await platform.QUALIFICATION.fetch("https://synthetic.invalid/count")).json(), { count: 2 });
    }
  } finally {
    await runtime.dispose();
    await rm(parent, { recursive: true, force: true });
  }
}

await run("success");
await run("redirect");
console.log(JSON.stringify({ schemaVersion: 1, nativeNode: true, localBinding: true, exactRequest: true, redirectRefused: true, cleanupComplete: true }));
