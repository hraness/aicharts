import "server-only";
import { parseUsageConsentDecision, parseUsageConsentRequest, type UsageConsentRequestV1 } from "./consent-contract";
import {
  decodeUsageConsentHttpResponse, encodeUsageConsentHttpRequest,
  USAGE_CONSENT_HTTP_URL, type UsageConsentQueryResult,
} from "./consent-http-contract";
import {
  PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, PAIRING_HTTP_MEDIA, PAIRING_HTTP_STAGE_MS,
  pairingHttpBody, pairingHttpDiscard, pairingHttpToken,
} from "./pairing-http-contract";
import { privateDaysHttpLength, privateDaysSnapshot } from "./private-days-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";
import type { PrivateDaysSessionScope } from "./private-days-transport";

/** Same trusted request-owned port as private days: readOutcome() verifies the
 * live Accounts session and derives the opaque account id and expiry. The
 * browser only supplies the consent decision, never identity. */
export interface UsageConsentTransportDependencies extends PairingHttpEffects {
  available(): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getContext(): unknown;
  registerLifetime(terminal: Promise<void>): void;
  beginSession(request: Request): PrivateDaysSessionScope | null;
}
export type UsageConsentOperationInput =
  | Readonly<{ operation: "status" }>
  | Readonly<{ operation: "set"; consent: boolean; publicHandle: string | null }>;
export type UsageConsentTransportOutcome = Readonly<{ kind: "query"; result: UsageConsentQueryResult }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("usage_consent_transport_unavailable");
const failed = (): UsageConsentTransportOutcome => Object.freeze({ kind: "unavailable" });
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}
function parseOperation(value: unknown): UsageConsentOperationInput | null {
  const status = privateDaysSnapshot(value, ["operation"]);
  if (status?.operation === "status") return Object.freeze({ operation: "status" });
  const set = privateDaysSnapshot(value, ["operation", "consent", "publicHandle"]);
  if (set?.operation !== "set") return null;
  const decision = parseUsageConsentDecision({ consent: set.consent, publicHandle: set.publicHandle });
  return decision === null ? null : Object.freeze({ operation: "set", ...decision });
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
      const token = ownValue(ownValue(getContext(), "headers"), "x-vercel-oidc-token");
      if (!pairingHttpToken(token) || outstanding >= PAIRING_HTTP_CAPACITY) throw unavailable();
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
        let query: UsageConsentRequestV1 | null = null;
        const guard = () => {
          work.guard();
          if (request.signal.aborted || available() !== true || session.current() !== true || (query !== null && sample() >= query.sessionExpiresAtMs)) throw unavailable();
          work.guard();
        };
        guard();
        const raw = await work.stage(PAIRING_HTTP_STAGE_MS, () => session.readOutcome());
        guard();
        const negative = privateDaysSnapshot(raw, ["kind"]);
        if (negative?.kind === "authentication_required") { guard(); return Object.freeze({ kind: "authentication_required" }); }
        const authenticated = privateDaysSnapshot(raw, ["kind", "value"]);
        if (authenticated?.kind !== "authenticated") throw unavailable();
        const account = privateDaysSnapshot(authenticated.value, ["suiteAccountId", "expiresAtMs"]);
        if (account === null) throw unavailable();
        query = parseUsageConsentRequest(operation.operation === "status"
          ? { schemaVersion: 1, accountId: account.suiteAccountId,
              sessionExpiresAtMs: account.expiresAtMs, operation: "status" }
          : { schemaVersion: 1, accountId: account.suiteAccountId,
              sessionExpiresAtMs: account.expiresAtMs, operation: "set",
              consent: operation.consent, publicHandle: operation.publicHandle });
        if (query === null) throw unavailable();
        const captured = query, encoded = encodeUsageConsentHttpRequest(captured);
        if (encoded === null) throw unavailable();
        const controller = new AbortController(); work.onStop(() => { controller.abort(); });
        guard();
        const response = await fetcher(USAGE_CONSENT_HTTP_URL, { method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", authorization: `Bearer ${token}` },
          body: encoded, redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal,
        });
        let reading = false;
        try {
          guard();
          if (response.status !== 200 || response.url !== USAGE_CONSENT_HTTP_URL || response.redirected
            || response.headers.get("content-type") !== PAIRING_HTTP_MEDIA || response.headers.has("content-encoding")
            || response.headers.has("location") || response.headers.has("set-cookie")) throw unavailable();
          const length = privateDaysHttpLength(response.headers, 1_024);
          reading = true;
          const bytes = await pairingHttpBody(response.body, 1_024, length, work);
          guard();
          const domain = decodeUsageConsentHttpResponse(bytes);
          if (domain === null) throw unavailable();
          guard(); return Object.freeze({ kind: "query", result: domain });
        } finally { if (!reading) await pairingHttpDiscard(response); }
      }, startedAt);
      return result;
    } catch { return failed(); }
  };
}
