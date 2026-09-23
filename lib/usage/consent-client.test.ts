import { expect, test } from "bun:test";
import { readUsageConsent, setUsageConsent } from "./consent-client";
import { USAGE_ACCOUNT_HEADER } from "./account-public";

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`;
const ready = { schemaVersion: 1, state: "ready", value: { schemaVersion: 1, consent: false, publicHandle: null, consentedAtMs: null } } as const;
const signal = () => new AbortController().signal;
function response(accountId: string | null) {
  return new Response(JSON.stringify(ready), { headers: { "content-type": "application/json; charset=utf-8", ...(accountId === null ? {} : { [USAGE_ACCOUNT_HEADER]: accountId }) } });
}
const port = (read: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) => read as typeof fetch;

test("consent status requires an identity on the same checked response", async () => {
  expect(await readUsageConsent(signal(), port(() => response(A)))).toEqual({ ...ready, accountId: A });
  for (const accountId of [null, "foreign", `${A}, ${B}`]) {
    await expect(readUsageConsent(signal(), port(() => response(accountId)))).rejects.toThrow("usage_unavailable");
  }
});
test("consent writes carry a conditional account and do not accept a different response account or retry", async () => {
  for (const returned of [A, B]) {
    let calls = 0;
    const result = setUsageConsent({ consent: false, publicHandle: null }, A, signal(), port((_input, init) => {
      calls++; expect(new Headers(init?.headers).get(USAGE_ACCOUNT_HEADER)).toBe(A);
      expect(init?.method).toBe("POST");
      expect(new TextDecoder().decode(init?.body as Uint8Array)).not.toContain(A);
      return response(returned);
    }));
    if (returned === A) expect(await result).toEqual({ ...ready, accountId: A });
    else await expect(result).rejects.toThrow("usage_unavailable");
    expect(calls).toBe(1);
  }
});
