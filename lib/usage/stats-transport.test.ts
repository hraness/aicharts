import { expect, mock, test } from "bun:test";
import { decodeStatsHttpRequest, encodeStatsHttpResponse, STATS_HTTP_URL } from "./stats-http-contract";
import { PAIRING_HTTP_MEDIA } from "./pairing-http-contract";
mock.module("server-only", () => ({}));
const { createStatsTransport } = await import("./stats-transport");

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`, now = 1_800_000_000_000;
test("the private response identity is captured with its query, never from a later account lookup", async () => {
  for (const close of [false, true]) {
    let account = A, current = true, finished = 0, reads = 0;
    const terminals: Promise<void>[] = [];
    const query = createStatsTransport({ available: () => true, now: () => now, setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      getContext: () => ({ headers: { "x-vercel-oidc-token": "a.b.c" } }), registerLifetime: terminal => { terminals.push(terminal); },
      beginSession: () => ({ read: async () => null, readOutcome: async () => { reads++; return { kind: "authenticated", value: { suiteAccountId: account, expiresAtMs: now + 60_000 } }; },
        current: () => current, finish: () => { finished++; } }),
      fetch: async (_input, init) => {
        const request = decodeStatsHttpRequest(init?.body);
        expect(request?.accountId).toBe(A);
        account = B; if (close) current = false;
        const bytes = encodeStatsHttpResponse(request, { ok: false, error: "not_started" });
        expect(bytes).not.toBeNull();
        const response = new Response(bytes, { headers: { "content-type": PAIRING_HTTP_MEDIA } });
        Object.defineProperty(response, "url", { value: STATS_HTTP_URL }); return response;
      },
    });
    const result = await query(new Request("https://aicharts.io/api/usage/stats"), { firstUtcDay: 20_000, dayCount: 1 });
    expect(result).toEqual(close ? { kind: "unavailable" } : { kind: "query", accountId: A, result: { ok: false, error: "not_started" } });
    expect(reads).toBe(1); await Promise.all(terminals); expect(finished).toBe(1);
  }
});
