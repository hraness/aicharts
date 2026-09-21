import { expect, test } from "bun:test";
import { createPrivateDaysHttpHandler } from "../../services/usage-worker/src/private-days-http";
import { createConsentHttpHandler } from "../../services/usage-worker/src/consent-http";
import type { PairingHttpVerifier } from "../../services/usage-worker/src/pairing-http";
import { verifierFailureStage } from "../../services/usage-worker/src/usage-failure";
import { encodePrivateDaysHttpRequest, PRIVATE_DAYS_HTTP_URL } from "./private-days-http-contract";
import { encodeUsageConsentHttpRequest, USAGE_CONSENT_HTTP_STAGE_MS, USAGE_CONSENT_HTTP_URL } from "./consent-http-contract";
import { PAIRING_HTTP_STAGE_MS } from "./pairing-http-contract";
import { USAGE_FAILURE_HEADER, USAGE_FAILURE_STAGES } from "./usage-failure-contract";

test("verifier diagnostics accept only existing fixed verifier stages and contain broken getters", () => {
  for (const stage of USAGE_FAILURE_STAGES) {
    expect(verifierFailureStage({ failureStage: stage })).toBe(stage.startsWith("verifier_") ? stage : "verifier_fetch");
  }
  for (const value of [undefined, null, 1, {}, "PRIVATE_CANARY", "verifier_clock,verifier_fetch"]) {
    expect(verifierFailureStage({ failureStage: value })).toBe("verifier_fetch");
  }
  expect(verifierFailureStage({ get failureStage() { throw new Error("PRIVATE_GETTER_CANARY"); } })).toBe("verifier_fetch");
});

test("RPC stages distinguish target lookup, synchronous invocation, rejection and pending deadline on both reads", async () => {
  const now = 1_800_000_000_000;
  const session = { schemaVersion: 1 as const, accountId: `acct_${"1".repeat(32)}`, sessionExpiresAtMs: now + 60_000 };
  const daysBody = encodePrivateDaysHttpRequest({ ...session, firstUtcDay: 20_000, dayCount: 1 });
  const consentBody = encodeUsageConsentHttpRequest({ ...session, operation: "status" });
  expect(daysBody).not.toBeNull(); expect(consentBody).not.toBeNull();
  // Consent commits and publishes in its stage, so it carries a longer budget
  // than the read-only private-days boundary; each is asserted against its own.
  for (const [url, makeHandler, body, stageMs] of [[PRIVATE_DAYS_HTTP_URL, createPrivateDaysHttpHandler, daysBody, PAIRING_HTTP_STAGE_MS],
    [USAGE_CONSENT_HTTP_URL, createConsentHttpHandler, consentBody, USAGE_CONSENT_HTTP_STAGE_MS]] as const) {
    for (const mode of ["dispatch", "sync", "rejected", "pending"] as const) {
      let entered!: () => void, rejectLate!: (error: Error) => void;
      const called = new Promise<void>(resolve => { entered = resolve; });
      const late = new Promise<unknown>((_resolve, reject) => { rejectLate = reject; });
      let calls = 0, serial = 0;
      const timers = new Map<number, { callback: () => void; delay: number }>();
      const effects = { now: () => now,
        setTimeout(callback: () => void, delay: number) { const id = ++serial; timers.set(id, { callback, delay }); return id; },
        clearTimeout(timer: unknown) { timers.delete(timer as number); } };
      const verifier: PairingHttpVerifier = { beginRequest() {
        let open = true; const handle = {};
        return { async verify() { return { ok: true, value: handle }; }, isCurrent(value) { return open && value === handle; }, finish() { open = false; } };
      } };
      const run = () => {
        calls++; entered();
        if (mode === "sync") throw new Error("PRIVATE_RPC_CANARY");
        return mode === "rejected" ? Promise.reject(new Error("PRIVATE_RPC_CANARY")) : late;
      };
      const pending: Promise<void>[] = [];
      const outward = makeHandler({ ...effects, verifier })(new Request(url, { method: "POST", body,
        headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c" } }),
      { ACCOUNT_ENROLLMENTS: { getByName() {
        if (mode === "dispatch") { entered(); throw new Error("PRIVATE_LOOKUP_CANARY"); }
        return { readImportedDays: run, readLeaderboardConsent: run, setLeaderboardConsent: run };
      } } },
      { waitUntil(terminal) { pending.push(terminal); } });
      await called;
      if (mode === "pending") {
        const timer = [...timers.values()].filter(timer => timer.delay === stageMs);
        expect(timer).toHaveLength(1); timer[0]!.callback();
      }
      const response = await outward;
      const stage = mode === "dispatch" ? "rpc_dispatch" : mode === "sync" ? "rpc_call" : mode === "rejected" ? "rpc_rejected" : "rpc_pending";
      expect(response.status).toBe(503); expect(response.headers.get(USAGE_FAILURE_HEADER)).toBe(stage);
      expect(await response.text()).toBe('{"schemaVersion":1,"error":{"code":"coordinator_unavailable"}}');
      if (mode === "pending") rejectLate(new Error("PRIVATE_LATE_RPC_CANARY"));
      await Promise.all(pending);
      expect(response.headers.get(USAGE_FAILURE_HEADER)).toBe(stage); expect(calls).toBe(mode === "dispatch" ? 0 : 1); expect(timers.size).toBe(0);
    }
  }
});

test("both HTTP reads expose only allowlisted unavailable stages and never consult diagnostics on 401", async () => {
  const effects = { now: () => 1_800_000_000_000,
    setTimeout: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds),
    clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) };
  for (const [url, makeHandler] of [[PRIVATE_DAYS_HTTP_URL, createPrivateDaysHttpHandler], [USAGE_CONSENT_HTTP_URL, createConsentHttpHandler]] as const) {
    for (const error of ["unavailable", "unauthorized"] as const) for (const diagnostic of ["verifier_clock", "rpc_dispatch", "throw", "absent"] as const) {
      let read = 0, selected = 0, finished = 0;
      const verifier: PairingHttpVerifier = { beginRequest() {
        const scope = { async verify() { return { ok: false as const, error }; }, isCurrent() { return false; }, finish() { finished++; } };
        if (diagnostic !== "absent") Object.defineProperty(scope, "failureStage", { get() {
          read++; if (diagnostic === "throw") throw new Error("PRIVATE_GETTER_CANARY"); return diagnostic;
        } });
        return scope;
      } };
      const pending: Promise<void>[] = [];
      const response = await makeHandler({ ...effects, verifier })(new Request(url, { method: "POST", body: "{}",
        headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c" } }),
      { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error("must not select"); } } },
      { waitUntil(terminal) { pending.push(terminal); } });
      await Promise.all(pending);
      expect(selected).toBe(0); expect(finished).toBe(1);
      expect(response.status).toBe(error === "unavailable" ? 503 : 401);
      expect(response.headers.get(USAGE_FAILURE_HEADER)).toBe(error === "unauthorized" ? null
        : diagnostic === "verifier_clock" ? diagnostic : "verifier_fetch");
      expect(read).toBe(error === "unauthorized" || diagnostic === "absent" ? 0 : 1);
      expect(await response.text()).toBe(error === "unauthorized"
        ? '{"schemaVersion":1,"error":{"code":"unauthorized_service"}}'
        : '{"schemaVersion":1,"error":{"code":"coordinator_unavailable"}}');
    }
  }
});
