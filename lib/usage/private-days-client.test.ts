import { expect, test } from "bun:test";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { privateDaysInputRange, readPrivateDays, utcDayInput } from "./private-days-client";
import {
  encodePrivateDaysPublicResponse, PRIVATE_DAYS_PUBLIC_MAX_BYTES, PRIVATE_DAYS_PUBLIC_MEDIA,
  type PrivateDaysPublicReply, type PrivateDaysRange,
} from "./private-days-public";

const accountId = `acct_${"a".repeat(32)}`;
const range: PrivateDaysRange = { firstUtcDay: 10, dayCount: 2 };
const empty = { usageOccurrences: 0, observedAccountedTokens: "0", observedOutputTokens: "0" };
const ready: PrivateDaysPublicReply = { schemaVersion: 1, state: "ready", value: {
  schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
  journalRevision: 1, journalCommittedAtMs: 1_000_000, firstUtcDay: 10, days: [
    { utcDay: 10, codex: { usageOccurrences: 2, observedAccountedTokens: "10", observedOutputTokens: "4" }, claudeCode: empty,
      devin: { usageOccurrences: 1, observedAccountedTokens: "7", observedOutputTokens: "2" } },
    { utcDay: 11, codex: empty, claudeCode: { usageOccurrences: 1, observedAccountedTokens: "5", observedOutputTokens: "1" }, devin: empty },
  ],
} };
const encoded = encodePrivateDaysPublicResponse(ready, range)!;
const signal = () => new AbortController().signal;
const fetchPort = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => handler as typeof fetch;

function streamed(chunks: readonly Uint8Array[] = [encoded], options: {
  status?: number; headers?: Record<string, string>; onPull?: (pulls: number) => void; cancelThrows?: boolean;
} = {}) {
  let pulls = 0, cancels = 0, next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++; options.onPull?.(pulls);
      if (next === chunks.length) controller.close();
      else controller.enqueue(chunks[next++]);
    },
    cancel() { cancels++; if (options.cancelThrows) throw new Error("SYNTHETIC_PRIVATE_CANARY"); },
  }, { highWaterMark: 0 });
  const response = new Response(body, { status: options.status ?? 200,
    headers: { "x-aicharts-account-id": accountId, "content-type": PRIVATE_DAYS_PUBLIC_MEDIA, ...options.headers } });
  return { body, response, fetch: fetchPort(async () => response), counts: () => ({ pulls, cancels }) };
}

async function refused(operation: () => Promise<unknown>) {
  let failure: unknown;
  try { await operation(); } catch (error) { failure = error; }
  if (!(failure instanceof Error)) throw new Error("Expected a bounded client failure.");
  expect(failure.message).toBe("usage_unavailable");
  expect(Object.hasOwn(failure, "cause")).toBe(false);
}

test("private daily data cannot be accepted without one canonical response account", async () => {
  for (const identity of [null, "", "foreign", `${accountId}, ${accountId}`]) {
    const f = streamed();
    if (identity === null) f.response.headers.delete("x-aicharts-account-id"); else f.response.headers.set("x-aicharts-account-id", identity);
    await refused(() => readPrivateDays(range, signal(), f.fetch));
  }
});

test("date controls use real UTC calendar days, including leap years and the epoch", () => {
  expect(utcDayInput(0)).toBe("1970-01-01");
  expect(privateDaysInputRange("1970-01-01", "1970-01-01")).toEqual({ firstUtcDay: 0, dayCount: 1 });
  const leap = privateDaysInputRange("2024-02-28", "2024-03-01")!;
  expect(leap).toEqual({ firstUtcDay: 19_781, dayCount: 3 });
  expect(utcDayInput(leap.firstUtcDay + 1)).toBe("2024-02-29");
  expect(privateDaysInputRange("2000-02-29", "2000-02-29")).not.toBeNull();
  expect(Object.isFrozen(leap)).toBe(true);
  for (const invalid of ["2023-02-29", "2100-02-29", "2024-02-30", "2024-04-31", "2024-13-01", "1969-12-31",
    "2024-2-01", "2024-02-01T00:00:00Z", " 2024-02-01", "2024-02-01\n"]) {
    expect(privateDaysInputRange(invalid, invalid)).toBeNull();
  }
});

test("date ranges preserve inclusive 31-day bounds and refuse reversed or missing endpoints", () => {
  expect(privateDaysInputRange("2024-01-01", "2024-01-31")).toEqual({ firstUtcDay: 19_723, dayCount: 31 });
  expect(privateDaysInputRange("2024-01-01", "2024-02-01")).toBeNull();
  expect(privateDaysInputRange("2024-03-01", "2024-02-29")).toBeNull();
  expect(privateDaysInputRange("", "2024-02-01")).toBeNull();
  expect(privateDaysInputRange("2024-02-01", "")).toBeNull();
});

test("canonical browser GET accepts ready, not-enrolled and the five exact error statuses", async () => {
  const cases: readonly [PrivateDaysPublicReply, number][] = [
    [ready, 200], [{ schemaVersion: 1, state: "not_enrolled" }, 200],
    [{ schemaVersion: 1, error: { code: "invalid_request" } }, 400],
    [{ schemaVersion: 1, error: { code: "authentication_required" } }, 401],
    [{ schemaVersion: 1, error: { code: "request_rejected" } }, 403],
    [{ schemaVersion: 1, error: { code: "method_not_allowed" } }, 405],
    [{ schemaVersion: 1, error: { code: "unavailable" } }, 503],
  ];
  for (const [reply, status] of cases) {
    const bytes = encodePrivateDaysPublicResponse(reply, range)!;
    // Arbitrary network segmentation must not affect canonical JSON admission.
    const f = streamed([bytes.subarray(0, 7), bytes.subarray(7)], { status });
    const controller = new AbortController(); let calls = 0;
    const fetcher = fetchPort(async (input, init) => {
      calls++;
      expect(input).toBe("/api/usage/days?firstUtcDay=10&dayCount=2");
      expect(init).toEqual({ method: "GET", headers: { accept: "application/json" }, credentials: "same-origin",
        cache: "no-store", redirect: "error", signal: controller.signal });
      return f.response;
    });
    const actual = await readPrivateDays(range, controller.signal, fetcher);
    expect(actual).toEqual("state" in reply ? { ...reply, accountId } : reply); expect(Object.isFrozen(actual)).toBe(true); expect(calls).toBe(1);
    expect(f.counts().cancels).toBe(0); expect(f.body.locked).toBe(false);
  }
});

test("browser-decoded gzip and br replies use decoded bytes, not encoded Content-Length", async () => {
  for (const [encoding, compressed] of [["gzip", gzipSync(encoded)], ["br", brotliCompressSync(encoded)]] as const) {
    expect(compressed.byteLength).not.toBe(encoded.byteLength);
    // Fetch exposes this decoded body while retaining the wire encoding headers.
    const f = streamed([encoded], { headers: { "content-encoding": encoding, "content-length": String(compressed.byteLength) } });
    expect(await readPrivateDays(range, signal(), f.fetch)).toEqual({ ...ready, accountId });
    expect(f.counts().cancels).toBe(0); expect(f.body.locked).toBe(false);
  }
});

test("unencoded and identity lengths must match the full decoded body", async () => {
  for (const encoding of [undefined, "identity", " Identity "]) {
    const headers: Record<string, string> = encoding === undefined ? {} : { "content-encoding": encoding };
    const accepted = streamed([encoded], { headers: { ...headers, "content-length": String(encoded.byteLength) } });
    expect(await readPrivateDays(range, signal(), accepted.fetch)).toEqual({ ...ready, accountId });
    for (const declared of [encoded.byteLength - 1, encoded.byteLength + 1]) {
      const f = streamed([encoded], { headers: { ...headers, "content-length": String(declared) } });
      await refused(() => readPrivateDays(range, signal(), f.fetch));
      expect(f.body.locked).toBe(false);
    }
  }
  const invalid = streamed([encoded], { headers: { "content-length": "01" } });
  await refused(() => readPrivateDays(range, signal(), invalid.fetch));
  expect(invalid.counts()).toEqual({ pulls: 0, cancels: 1 });
});

test("status, day range and canonical body must agree before a reply is returned", async () => {
  const failure = encodePrivateDaysPublicResponse({ schemaVersion: 1, error: { code: "unavailable" } }, range)!;
  const noncanonical = new TextEncoder().encode(`${new TextDecoder().decode(encoded)}\n`);
  for (const f of [streamed([encoded], { status: 401 }), streamed([failure]), streamed([noncanonical]), streamed([])]) {
    await refused(() => readPrivateDays(range, signal(), f.fetch)); expect(f.body.locked).toBe(false);
  }
  for (const changed of [{ ...range, firstUtcDay: 11 }, { ...range, dayCount: 1 }]) {
    const f = streamed(); await refused(() => readPrivateDays(changed, signal(), f.fetch));
    expect(f.body.locked).toBe(false);
  }
});

test("unusable HTTP framing cancels the unopened response body", async () => {
  const redirected = streamed(); Object.defineProperty(redirected.response, "redirected", { value: true });
  for (const f of [redirected, streamed([encoded], { status: 418 }), streamed([encoded], { headers: { "content-type": "text/html" } }),
    streamed([encoded], { headers: { "content-length": String(PRIVATE_DAYS_PUBLIC_MAX_BYTES + 1) } })]) {
    await refused(() => readPrivateDays(range, signal(), f.fetch));
    expect(f.counts()).toEqual({ pulls: 0, cancels: 1 }); expect(f.body.locked).toBe(false);
  }
  await refused(() => readPrivateDays(range, signal(), fetchPort(async () => new Response(null, { headers: { "content-type": PRIVATE_DAYS_PUBLIC_MEDIA } }))));
});

test("decoded byte limits hold even when the wire length is small or absent", async () => {
  const variants: readonly Record<string, string>[] = [{}, { "content-encoding": "gzip", "content-length": "23" }];
  for (const headers of variants) {
    const f = streamed([new Uint8Array(PRIVATE_DAYS_PUBLIC_MAX_BYTES), Uint8Array.of(1)], { headers });
    await refused(() => readPrivateDays(range, signal(), f.fetch));
    expect(f.counts()).toEqual({ pulls: 2, cancels: 1 }); expect(f.body.locked).toBe(false);
  }
});

test("empty-chunk streams stop within the read budget and valid byte-sized chunks still finish", async () => {
  // Finite beyond the policy budget: a missing read cap fails without hanging.
  const emptyChunks = Array.from({ length: PRIVATE_DAYS_PUBLIC_MAX_BYTES + 2 }, () => new Uint8Array());
  const f = streamed(emptyChunks);
  await refused(() => readPrivateDays(range, signal(), f.fetch));
  expect(f.counts().pulls).toBeLessThanOrEqual(PRIVATE_DAYS_PUBLIC_MAX_BYTES + 1);
  expect(f.counts().cancels).toBe(1); expect(f.body.locked).toBe(false);
  const bytes = streamed(Array.from(encoded, byte => Uint8Array.of(byte)));
  expect(await readPrivateDays(range, signal(), bytes.fetch)).toEqual({ ...ready, accountId });
  expect(bytes.counts().cancels).toBe(0); expect(bytes.body.locked).toBe(false);
});

test("invalid ranges and already-aborted requests have no fetch or retry", async () => {
  let calls = 0;
  const fetcher = fetchPort(async () => { calls++; throw new Error("SYNTHETIC_PRIVATE_CANARY"); });
  const controller = new AbortController(); controller.abort();
  await refused(() => readPrivateDays(range, controller.signal, fetcher));
  await refused(() => readPrivateDays({ ...range, dayCount: 32 }, signal(), fetcher));
  await refused(() => readPrivateDays({ ...range, accountId: "SYNTHETIC_PRIVATE_CANARY" } as PrivateDaysRange, signal(), fetcher));
  expect(calls).toBe(0);
  await refused(() => readPrivateDays(range, signal(), fetcher)); expect(calls).toBe(1);
});

test("abort after fetch or during a read suppresses the result and cancels owned body work", async () => {
  const beforeRead = new AbortController(), unopened = streamed();
  await refused(() => readPrivateDays(range, beforeRead.signal, fetchPort(async () => { beforeRead.abort(); return unopened.response; })));
  expect(unopened.counts()).toEqual({ pulls: 0, cancels: 1 }); expect(unopened.body.locked).toBe(false);
  const duringRead = new AbortController();
  const active = streamed([encoded.subarray(0, 7), encoded.subarray(7)], { onPull(pulls) { if (pulls === 2) duringRead.abort(); } });
  await refused(() => readPrivateDays(range, duringRead.signal, active.fetch));
  expect(active.counts()).toEqual({ pulls: 2, cancels: 1 }); expect(active.body.locked).toBe(false);
});

test("body and cancellation failures retain the fixed error and release the reader", async () => {
  const broken = streamed([encoded], { onPull() { throw new Error("SYNTHETIC_PRIVATE_CANARY"); } });
  await refused(() => readPrivateDays(range, signal(), broken.fetch)); expect(broken.body.locked).toBe(false);
  const rejectedCancel = streamed([new Uint8Array(PRIVATE_DAYS_PUBLIC_MAX_BYTES + 1)], { cancelThrows: true });
  await refused(() => readPrivateDays(range, signal(), rejectedCancel.fetch));
  expect(rejectedCancel.counts().cancels).toBe(1); expect(rejectedCancel.body.locked).toBe(false);
});
