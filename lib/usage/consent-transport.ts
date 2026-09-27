import "server-only";
import { parseUsageConsentDecision, parseUsageConsentRequest } from "./consent-contract";
import {
  decodeUsageConsentHttpResponse, encodeUsageConsentHttpRequest,
  USAGE_CONSENT_HTTP_URL, type UsageConsentQueryResult,
} from "./consent-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS } from "./pairing-http-contract";
import { privateDaysHttpLength, privateDaysSnapshot } from "./private-days-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";
import type { PrivateDaysSessionScope } from "./private-days-transport";
import { usageAccountId } from "./account-public";
import { usageWorkloadToken } from "./stats-transport";
import { usageWorkerCall, verifyUsageSession, type UsageWorkerPort, type VerifiedUsageAccount } from "./usage-worker-read";

/** Same trusted request-owned port as private days: readOutcome() verifies the
 * live Accounts session and derives the opaque account id and expiry. The
 * browser supplies a decision and expected account, never authority. */
export interface UsageConsentTransportDependencies extends PairingHttpEffects {
  available(): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getContext(): unknown;
  registerLifetime(terminal: Promise<void>): void;
  beginSession(request: Request): PrivateDaysSessionScope | null;
}
export type UsageConsentOperationInput =
  | Readonly<{ operation: "status" }>
  | Readonly<{ operation: "set"; consent: boolean; publicHandle: string | null; expectedAccountId: string }>;
export type UsageConsentTransportOutcome = Readonly<{ kind: "query"; accountId: string; result: UsageConsentQueryResult }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("usage_consent_transport_unavailable");
const failed = (): UsageConsentTransportOutcome => Object.freeze({ kind: "unavailable" });
function parseOperation(value: unknown): UsageConsentOperationInput | null {
  const status = privateDaysSnapshot(value, ["operation"]);
  if (status?.operation === "status") return Object.freeze({ operation: "status" });
  const set = privateDaysSnapshot(value, ["operation", "consent", "publicHandle", "expectedAccountId"]);
  if (set?.operation !== "set" || !usageAccountId(set.expectedAccountId)) return null;
  const decision = parseUsageConsentDecision({ consent: set.consent, publicHandle: set.publicHandle });
  return decision === null ? null : Object.freeze({ operation: "set", ...decision, expectedAccountId: set.expectedAccountId });
}

/** One consent operation for an account this request already verified. Status is
 * a read and may ride out a cold object; a decision is sent exactly once. */
export async function runUsageConsentForAccount(port: UsageWorkerPort, account: VerifiedUsageAccount,
  operation: UsageConsentOperationInput): Promise<UsageConsentTransportOutcome> {
  if (operation.operation === "set" && operation.expectedAccountId !== account.suiteAccountId) throw unavailable();
  const query = parseUsageConsentRequest(operation.operation === "status"
    ? { schemaVersion: 1, accountId: account.suiteAccountId, sessionExpiresAtMs: account.expiresAtMs, operation: "status" }
    : { schemaVersion: 1, accountId: account.suiteAccountId, sessionExpiresAtMs: account.expiresAtMs, operation: "set",
        consent: operation.consent, publicHandle: operation.publicHandle });
  if (query === null) throw unavailable();
  const encoded = encodeUsageConsentHttpRequest(query);
  if (encoded === null) throw unavailable();
  const result = await usageWorkerCall(port, { url: USAGE_CONSENT_HTTP_URL, body: encoded, expiresAtMs: query.sessionExpiresAtMs,
    maxBytes: 1_024, kind: operation.operation === "status" ? "read" : "mutation",
    length: headers => privateDaysHttpLength(headers, 1_024), decode: bytes => decodeUsageConsentHttpResponse(bytes) });
  return Object.freeze({ kind: "query", accountId: query.accountId, result });
}

export function createUsageConsentTransport(dependencies: UsageConsentTransportDependencies) {
  const { fetch: fetcher, getContext, registerLifetime, beginSession, available, now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;
  return async (request: Request, input: unknown): Promise<UsageConsentTransportOutcome> => {
    try {
      if (available() !== true) return failed();
      const startedAt = now(), operation = parseOperation(input);
      if (operation === null || request.signal.aborted) throw unavailable();
      // Capture only the actual platform request context, before the first await.
      const token = usageWorkloadToken(getContext());
      if (token === null || outstanding >= PAIRING_HTTP_CAPACITY) throw unavailable();
      outstanding++;
      let observed = startedAt;
      const sample = () => {
        const current = now();
        if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) throw unavailable();
        observed = current; return current;
      };
      const result = await pairingHttpWork<UsageConsentTransportOutcome>({ ...effects, now: sample }, PAIRING_HTTP_CLIENT_MS, registerLifetime, failed, () => { outstanding--; }, async work => {
        const session = beginSession(request);
        if (session === null) throw unavailable();
        work.onStop(() => { session.finish(); });
        const guard = () => {
          work.guard();
          if (request.signal.aborted || available() !== true || session.current() !== true) throw unavailable();
          work.guard();
        };
        guard();
        const verified = await verifyUsageSession(work, guard, session);
        if (verified.kind === "authentication_required") return verified;
        return runUsageConsentForAccount({ work, guard, sample, fetch: fetcher, setTimeout, token }, verified.account, operation);
      }, startedAt);
      return result;
    } catch { return failed(); }
  };
}
