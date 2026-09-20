import "server-only";
import { parsePrivateDaysRequest, type PrivateDaysRequestV1 } from "./private-days-contract";
import {
  decodePrivateDaysHttpResponse, encodePrivateDaysHttpRequest, parsePrivateDaysRange, privateDaysHttpLength, privateDaysSnapshot,
  PRIVATE_DAYS_HTTP_RESPONSE_BYTES, PRIVATE_DAYS_HTTP_URL, type PrivateDaysQueryResult,
} from "./private-days-http-contract";
import {
  PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, PAIRING_HTTP_MEDIA, PAIRING_HTTP_STAGE_MS,
  pairingHttpBody, pairingHttpDiscard, pairingHttpToken,
} from "./pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";
import type { PrivateDaysDiagnostic } from "./private-days-diagnostic";

/** Trusted request-owned port: readOutcome() verifies the live Accounts session.
 * current() fences the exact configuration/authority across awaits; finish()
 * invalidates the scope without authorizing retries. No default port is installed. */
export interface PrivateDaysSessionScope {
  read(): Promise<unknown>;
  readOutcome(): Promise<unknown>;
  current(): boolean;
  finish(): void;
  providerAttempted?(): boolean;
}
export interface PrivateDaysTransportDependencies extends PairingHttpEffects {
  available(): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getContext(): unknown;
  registerLifetime(terminal: Promise<void>): void;
  beginSession(request: Request): PrivateDaysSessionScope | null;
}
export type PrivateDaysTransportOutcome = Readonly<{ kind: "query"; result: PrivateDaysQueryResult }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("private_days_transport_unavailable");
const failedOutcome = (): PrivateDaysTransportOutcome => Object.freeze({ kind: "unavailable" });
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

/** Only the range comes from product input. No browser-supplied account or expiry. */
export function createPrivateDaysTransport(dependencies: PrivateDaysTransportDependencies) {
  const { fetch: fetcher, getContext, registerLifetime, beginSession, available, now, setTimeout, clearTimeout } = dependencies;
  let outstanding = 0;
  return async (request: Request, input: unknown, diagnostic?: PrivateDaysDiagnostic): Promise<PrivateDaysTransportOutcome> => {
    const failed = () => { diagnostic?.closeTransport("interrupted"); return failedOutcome(); };
    function reject(reason: Parameters<PrivateDaysDiagnostic["fail"]>[0]): never { diagnostic?.fail(reason); throw unavailable(); }
    const effects = Object.freeze({ now, clearTimeout, setTimeout: (callback: () => void, milliseconds: number) =>
      setTimeout(() => { diagnostic?.fail("timeout"); callback(); }, milliseconds) });
    try {
      diagnostic?.step("availability");
      if (available() !== true) reject("configuration");
      diagnostic?.step("input");
      const startedAt = now(), range = parsePrivateDaysRange(input);
      if (range === null || request.signal.aborted) reject("input");
      // Capture only the actual platform request context, before the first await.
      diagnostic?.step("context");
      const token = ownValue(ownValue(getContext(), "headers"), "x-vercel-oidc-token");
      if (!pairingHttpToken(token)) reject(token === undefined ? "context_missing" : "context_invalid");
      diagnostic?.step("capacity");
      if (outstanding >= PAIRING_HTTP_CAPACITY) reject("capacity");
      outstanding++;
      let observed = startedAt;
      const sample = () => {
        const current = now();
        if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) reject("clock");
        observed = current; return current;
      };
      diagnostic?.step("lifetime");
      const register = (terminal: Promise<void>) => {
        try { registerLifetime(terminal); } catch { diagnostic?.fail("registration"); throw unavailable(); }
      };
      const result = await pairingHttpWork<PrivateDaysTransportOutcome>({ ...effects, now: sample }, PAIRING_HTTP_CLIENT_MS, register, failed, () => { outstanding--; }, async work => {
        diagnostic?.step("session_start");
        const session = beginSession(request);
        if (session === null) reject("session");
        const recordAttempt = () => {
          try { diagnostic?.attempted(session.providerAttempted?.()); } catch { /* Unknown diagnostic bit. */ }
        };
        work.onStop(() => { recordAttempt(); session.finish(); });
        let query: PrivateDaysRequestV1 | null = null;
        const guard = () => {
          work.guard();
          if (request.signal.aborted || available() !== true || session.current() !== true || (query !== null && sample() >= query.sessionExpiresAtMs)) reject("guard");
          work.guard();
        };
        guard();
        diagnostic?.step("session_read");
        diagnostic?.session("pending", null);
        const raw = await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
          const outcome = await session.readOutcome();
          // The Accounts scope can close itself for unavailable. Capture only
          // its bounded outcome before stage/authority guards discard it.
          let attempted: unknown = null;
          try { attempted = session.providerAttempted?.(); } catch { /* Unknown diagnostic bit. */ }
          const negative = privateDaysSnapshot(outcome, ["kind"]);
          const authenticated = privateDaysSnapshot(outcome, ["kind", "value"]);
          diagnostic?.session(negative?.kind ?? (authenticated?.kind === "authenticated" ? "authenticated" : "malformed"), attempted);
          return outcome;
        });
        guard();
        const negative = privateDaysSnapshot(raw, ["kind"]);
        if (negative?.kind === "authentication_required") { guard(); return Object.freeze({ kind: "authentication_required" }); }
        const authenticated = privateDaysSnapshot(raw, ["kind", "value"]);
        if (authenticated?.kind !== "authenticated") reject("session");
        diagnostic?.step("query");
        const account = privateDaysSnapshot(authenticated.value, ["suiteAccountId", "expiresAtMs"]);
        if (account === null) reject("query");
        query = parsePrivateDaysRequest({ schemaVersion: 1, accountId: account.suiteAccountId,
          sessionExpiresAtMs: account.expiresAtMs, firstUtcDay: range.firstUtcDay, dayCount: range.dayCount });
        if (query === null) reject("query");
        diagnostic?.step("encode");
        const captured = query, encoded = encodePrivateDaysHttpRequest(captured);
        if (encoded === null) reject("encode");
        const controller = new AbortController(); work.onStop(() => { controller.abort(); });
        guard();
        diagnostic?.step("worker_dispatch"); diagnostic?.dispatched();
        let response: Response;
        try { response = await fetcher(PRIVATE_DAYS_HTTP_URL, { method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", authorization: `Bearer ${token}` },
          body: encoded, redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal,
        }); } catch { return reject("worker_fetch"); }
        diagnostic?.status(response.status);
        let reading = false;
        try {
          guard();
          diagnostic?.step("worker_framing");
          if (response.status !== 200) reject("status");
          if (response.url !== PRIVATE_DAYS_HTTP_URL) reject("url");
          if (response.redirected) reject("redirect");
          if (response.headers.get("content-type") !== PAIRING_HTTP_MEDIA) reject("media");
          if (response.headers.has("content-encoding")) reject("encoding");
          if (response.headers.has("location")) reject("location");
          if (response.headers.has("set-cookie")) reject("cookie");
          diagnostic?.step("worker_length");
          let length: number | null;
          try { length = privateDaysHttpLength(response.headers, PRIVATE_DAYS_HTTP_RESPONSE_BYTES); } catch { return reject("length"); }
          reading = true;
          diagnostic?.step("worker_body");
          let bytes: Uint8Array;
          try { bytes = await pairingHttpBody(response.body, PRIVATE_DAYS_HTTP_RESPONSE_BYTES, length, work); } catch { return reject("body"); }
          guard();
          diagnostic?.step("worker_decode");
          const domain = decodePrivateDaysHttpResponse(bytes, captured);
          if (domain === null) reject("decode");
          diagnostic?.domain(domain.ok ? "success" : domain.error);
          guard(); diagnostic?.step("complete"); return Object.freeze({ kind: "query", result: domain });
        } finally { if (!reading) await pairingHttpDiscard(response); }
      }, startedAt);
      diagnostic?.closeTransport(); return result;
    } catch { return failed(); }
  };
}
