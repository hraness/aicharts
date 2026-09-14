import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Resolve the runtime belonging to this repository's pinned Wrangler install.
// The tracked Node import hook owns only the driver's admitted source edges.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve("miniflare")).href);
const { dispatchQualificationStep, prepareQualification, qualificationConfigs, recordQualificationDeployment, QUALIFICATION_TARGET } =
  await import(new URL("./usage-cloudflare-qualification.ts", import.meta.url));
const { qualificationDigest } = await import(new URL("../fixtures/usage/cloudflare-qualification.ts", import.meta.url));

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
    const forbidden = ["authorization", "cookie", "origin", "content-encoding", "transfer-encoding"];
    const body = new Uint8Array(await request.arrayBuffer());
    const validEnvelope = request.url === "https://aicharts-usage-qualification.invalid/v1/run" && request.method === "POST"
      && request.headers.get("content-type") === "application/json" && request.headers.get("accept") === "application/json"
      && forbidden.every(name => !request.headers.has(name)) && request.headers.get("content-length") === String(body.byteLength);
    if (!validEnvelope) return Response.json({ accepted: false, transferEncoding: request.headers.get("transfer-encoding"), contentLength: request.headers.get("content-length"), bodyLength: body.byteLength }, { status: 400 });
    if (${JSON.stringify(mode)} === "redirect" && new URL(request.url).pathname !== "/follow")
      return new Response(null, { status: 302, headers: { location: "https://synthetic.invalid/follow" } });
    const requestText = new TextDecoder().decode(body);
    const input = JSON.parse(requestText);
    if (requestText !== JSON.stringify({ schemaVersion: 1, runId: input.runId, stage: "inspect" }))
      return Response.json({ accepted: false, canonical: false }, { status: 400 });
    const value = { objects: [] };
    const replyBody = JSON.stringify({ schemaVersion: 1, runId: input.runId, stage: input.stage, ok: true, value });
    return new Response(replyBody, { headers: {
      "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow",
    } });
  } };`;
}

async function run(mode) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "aicharts-node-binding-parent-")));
  const path = join(parent, "run");
  let runtime;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    try { await runtime?.dispose(); }
    finally { await rm(parent, { recursive: true, force: true }); }
  })();
  const terminate = () => { void cleanup().finally(() => process.exit(143)); };
  process.once("SIGTERM", terminate);
  try {
    runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, workers: [
      { name: "driver", compatibilityDate: "2026-09-10", modules: true,
        script: "export default { fetch() { return new Response(null, { status: 503 }); } };",
        serviceBindings: { QUALIFICATION: "target" } },
      { name: "target", compatibilityDate: "2026-09-10", modules: true, script: targetScript(mode) },
    ] }));
    const manifest = await prepareQualification(path, sourceSha, { accountId, ...QUALIFICATION_TARGET });
    await recordQualificationDeployment(path, receipt(manifest), false);
    const calls = [];
    const platform = await runtime.getBindings("driver");
    const controlBody = new TextEncoder().encode("{\"control\":true}");
    const control = await platform.QUALIFICATION.fetch("https://aicharts-usage-qualification.invalid/v1/run", {
      method: "POST", redirect: "error", headers: { accept: "application/json", "content-type": "application/json" }, body: controlBody,
    });
    assert.equal(control.status, 400);
    assert.deepEqual(await control.json(), { accepted: false, transferEncoding: "chunked", contentLength: null, bodyLength: controlBody.byteLength });
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
    assert.ok(calls[0].init.body instanceof Uint8Array);
    assert.deepEqual(calls[0].init.headers, { accept: "application/json", "content-type": "application/json", "content-length": String(calls[0].init.body.byteLength) });
    assert.equal(Buffer.from(calls[0].init.body).toString("hex"), result.steps[0].requestHex);
    if (mode === "success") {
      assert.equal(result.steps[0].state, "complete");
    } else {
      assert.equal(result.steps[0].state, "ambiguous");
      assert.equal(calls.length, 1, "redirect response must not trigger a second service request");
    }
    assert.deepEqual(await (await platform.QUALIFICATION.fetch("https://synthetic.invalid/count")).json(), { count: 3 });
  } finally {
    try { await cleanup(); }
    finally { process.removeListener("SIGTERM", terminate); }
  }
}

await run("success");
await run("redirect");
console.log(JSON.stringify({ schemaVersion: 1, nativeNode: true, localBinding: true, exactRequest: true, redirectRefused: true, cleanupComplete: true }));
