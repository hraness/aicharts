import "server-only";
import { usageAccountId } from "./account-public";
import {
  PAIRING_HTTP_COLD_READ_RETRY_MS, PAIRING_HTTP_MEDIA, PAIRING_HTTP_STAGE_MS, pairingHttpBody, pairingHttpDiscard,
} from "./pairing-http-contract";
import type { PairingHttpWork } from "./pairing-http-work";
import { privateDaysSnapshot } from "./private-days-http-contract";

/** The account one live Accounts read established for this request. */
export type VerifiedUsageAccount = Readonly<{ suiteAccountId: string; expiresAtMs: number }>;
export type VerifiedUsageSession = Readonly<{ kind: "account"; account: VerifiedUsageAccount }>
  | Readonly<{ kind: "authentication_required" }>;

/** One verified request's Worker access: its bounded work, its request fence, its
 * monotonic clock and the platform workload token. Account authority is separate. */
export interface UsageWorkerPort {
  readonly work: PairingHttpWork;
  guard(): void;
  sample(): number;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  readonly token: string;
}

const unavailable = () => new Error("usage_worker_unavailable");

/** Read the request-owned session once, inside the fixed session stage. */
export async function verifyUsageSession(work: PairingHttpWork, guard: () => void,
  session: Readonly<{ readOutcome(): Promise<unknown> }>): Promise<VerifiedUsageSession> {
  const raw = await work.stage(PAIRING_HTTP_STAGE_MS, () => session.readOutcome());
  guard();
  if (privateDaysSnapshot(raw, ["kind"])?.kind === "authentication_required") return Object.freeze({ kind: "authentication_required" });
  const authenticated = privateDaysSnapshot(raw, ["kind", "value"]);
  if (authenticated?.kind !== "authenticated") throw unavailable();
  const account = privateDaysSnapshot(authenticated.value, ["suiteAccountId", "expiresAtMs"]);
  if (account === null || !usageAccountId(account.suiteAccountId) || typeof account.expiresAtMs !== "number"
    || !Number.isSafeInteger(account.expiresAtMs) || account.expiresAtMs <= 0 || account.expiresAtMs > 8_640_000_000_000_000) throw unavailable();
  return Object.freeze({ kind: "account", account: Object.freeze({ suiteAccountId: account.suiteAccountId, expiresAtMs: account.expiresAtMs }) });
}

/** One Worker POST for a verified account. A read may ride out one cold object:
 * the Worker abandons a booting call at its stage with 503 while the object
 * finishes loading, so a single settled retry lands on a resident object.
 * A mutation is sent exactly once; an interrupted mutation is never replayed. */
export async function usageWorkerCall<T>(port: UsageWorkerPort, call: Readonly<{
  url: string; body: Uint8Array<ArrayBuffer>; expiresAtMs: number; maxBytes: number; kind: "read" | "mutation";
  length(headers: Headers): number | null; decode(bytes: Uint8Array): T | null;
}>): Promise<T> {
  const guard = () => {
    port.guard();
    if (port.sample() >= call.expiresAtMs) throw unavailable();
    port.guard();
  };
  const controller = new AbortController(); port.work.onStop(() => { controller.abort(); });
  const attempt = async (): Promise<T | null> => {
    const response = await port.fetch(call.url, { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", authorization: `Bearer ${port.token}` },
      body: call.body, redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal,
    });
    let reading = false;
    try {
      guard();
      if (response.status === 503 && call.kind === "read") return null;
      if (response.status !== 200 || response.url !== call.url || response.redirected
        || response.headers.get("content-type") !== PAIRING_HTTP_MEDIA || response.headers.has("content-encoding")
        || response.headers.has("location") || response.headers.has("set-cookie")) throw unavailable();
      const length = call.length(response.headers);
      reading = true;
      const bytes = await pairingHttpBody(response.body, call.maxBytes, length, port.work);
      guard();
      const decoded = call.decode(bytes);
      if (decoded === null) throw unavailable();
      guard(); return decoded;
    } finally { if (!reading) await pairingHttpDiscard(response); }
  };
  guard();
  const first = await attempt();
  if (first !== null) return first;
  await new Promise<void>(resolve => { port.setTimeout(resolve, PAIRING_HTTP_COLD_READ_RETRY_MS); });
  guard();
  const second = await attempt();
  if (second === null) throw unavailable();
  return second;
}
