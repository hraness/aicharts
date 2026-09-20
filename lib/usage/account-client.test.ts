import { expect, test } from "bun:test";
import { readUsageAccount } from "./account-client";
import { USAGE_ACCOUNT_MEDIA, type UsageAccountReply } from "./account-public";
const ready = { schemaVersion: 1, state: "ready", account: { accountId: `acct_${"a".repeat(32)}` } } satisfies UsageAccountReply;
const port = (run: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) => run as typeof fetch;

test("account client requests only the fixed credential-free JSON projection", async () => {
  const controller = new AbortController();
  const value = await readUsageAccount(controller.signal, port((input, init) => {
    expect(input).toBe("/api/usage/account");
    expect(init).toEqual({ method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
    return new Response(JSON.stringify(ready), { headers: { "content-type": USAGE_ACCOUNT_MEDIA, "content-encoding": "gzip", "content-length": "1" } });
  }));
  expect(value).toEqual(ready);
});
test("account client refuses framing, body, schema and status mismatches without disclosure", async () => {
  const bytes = JSON.stringify(ready);
  const responses = [new Response(bytes, { headers: { "content-type": "application/json" } }),
    new Response(bytes, { status: 401, headers: { "content-type": USAGE_ACCOUNT_MEDIA } }),
    new Response(bytes, { headers: { "content-type": USAGE_ACCOUNT_MEDIA, "content-length": "513" } }),
    new Response(bytes, { headers: { "content-type": USAGE_ACCOUNT_MEDIA, "content-length": "1" } }),
    new Response(JSON.stringify({ ...ready, entitlementReceipt: "PRIVATE_CANARY" }), { headers: { "content-type": USAGE_ACCOUNT_MEDIA } }),
    new Response("x".repeat(513), { headers: { "content-type": USAGE_ACCOUNT_MEDIA } }),
    new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array()); } }), { headers: { "content-type": USAGE_ACCOUNT_MEDIA } })];
  for (const response of responses) {
    await expect(readUsageAccount(new AbortController().signal, port(() => response))).rejects.toEqual(new Error("usage_unavailable"));
  }
  const redirected = new Response(bytes, { headers: { "content-type": USAGE_ACCOUNT_MEDIA } }); Object.defineProperty(redirected, "redirected", { value: true });
  await expect(readUsageAccount(new AbortController().signal, port(() => redirected))).rejects.toEqual(new Error("usage_unavailable"));
});
test("aborted account reads cannot publish a late identity", async () => {
  const controller = new AbortController(); let cancelled = 0;
  await expect(readUsageAccount(controller.signal, port(() => {
    controller.abort();
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": USAGE_ACCOUNT_MEDIA } });
  }))).rejects.toEqual(new Error("usage_unavailable"));
  expect(cancelled).toBe(1);
});
