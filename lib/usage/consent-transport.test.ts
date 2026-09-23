import { expect, mock, test } from "bun:test";
import { decodeUsageConsentHttpRequest, encodeUsageConsentHttpResponse, USAGE_CONSENT_HTTP_URL } from "./consent-http-contract";
import { PAIRING_HTTP_MEDIA } from "./pairing-http-contract";
mock.module("server-only", () => ({}));
const { createUsageConsentTransport } = await import("./consent-transport");

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`, now = 1_800_000_000_000;
test("consent conditions intent on the live account and binds the response to that same capture", async () => {
  for (const expectedAccountId of [A, B, null]) {
    let account = A, calls = 0; const terminals: Promise<void>[] = [];
    const run = createUsageConsentTransport({ available: () => true, now: () => now, setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      getContext: () => ({ headers: { "x-vercel-oidc-token": "a.b.c" } }), registerLifetime: terminal => { terminals.push(terminal); },
      beginSession: () => ({ read: async () => null, readOutcome: async () => ({ kind: "authenticated", value: { suiteAccountId: account, expiresAtMs: now + 60_000 } }),
        current: () => true, finish() {} }),
      fetch: async (_input, init) => {
        calls++; const query = decodeUsageConsentHttpRequest(init?.body); expect(query?.accountId).toBe(A);
        account = B;
        const response = new Response(encodeUsageConsentHttpResponse({ ok: false, error: "not_enrolled" }), { headers: { "content-type": PAIRING_HTTP_MEDIA } });
        Object.defineProperty(response, "url", { value: USAGE_CONSENT_HTTP_URL }); return response;
      },
    });
    const reply = await run(new Request("https://aicharts.io/api/usage/consent"), { operation: "set", consent: false, publicHandle: null, expectedAccountId });
    expect(calls).toBe(expectedAccountId === A ? 1 : 0);
    expect(reply).toEqual(expectedAccountId === A ? { kind: "query", accountId: A, result: { ok: false, error: "not_enrolled" } } : { kind: "unavailable" });
    await Promise.all(terminals);
  }
});
