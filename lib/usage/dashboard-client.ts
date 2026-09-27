import { decodeUsageAccountReply, usageAccountStatus, type UsageAccountReply } from "./account-public";
import { decodeUsageConsentPublicReply, type UsageConsentPublicReply } from "./consent-public";
import type { UsageConsentReadReply } from "./consent-client";
import {
  decodeUsageDashboardFrame, usageDashboardErrorStatus, usageDashboardPath, USAGE_DASHBOARD_MAX_BYTES, USAGE_DASHBOARD_MEDIA,
  type UsageDashboardError, type UsageDashboardQuery,
} from "./dashboard-public";
import type { StatsRange } from "./stats-http-contract";
import { decodeStatsTotalsPublicReply, statsTotalsPublicStatus } from "./stats-totals-public";
import type { StatsTotalsReadReply } from "./stats-totals-client";

/** Opaque hosted stats bytes; only the private report worker decodes them. An
 * unavailable reply is unbound, exactly as the standalone stats route sends it. */
export type UsageDashboardStatsBody = Readonly<{ body: Blob; status: number; accountId: string | null; range: StatsRange }>;
export type UsageDashboardRead =
  | Readonly<{ kind: "ready"; accountId: string; sessionRefreshInMs: number; account?: UsageAccountReply;
      totals?: StatsTotalsReadReply; consent?: UsageConsentReadReply; stats?: UsageDashboardStatsBody }>
  | Readonly<{ kind: "error"; error: UsageDashboardError }>;

const unavailable = () => new Error("usage_unavailable");
const MAX_READS = 65_536;
const consentStatus = (reply: UsageConsentPublicReply): number => "error" in reply
  ? { invalid_request: 400, authentication_required: 401, request_rejected: 403, method_not_allowed: 405, handle_unavailable: 409, publishing_full: 409, unavailable: 503 }[reply.error.code]
  : 200;

/** One same-origin read of several private parts. Each part must decode with its
 * standalone endpoint's own decoder and carry that endpoint's exact status, and
 * every bound part names the frame's single verified account. No persistence. */
export async function readUsageDashboard(query: UsageDashboardQuery, signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch): Promise<UsageDashboardRead> {
  const path = usageDashboardPath(query);
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    if (path === null || signal.aborted) throw unavailable();
    response = await fetcher(path, { method: "GET", headers: { accept: USAGE_DASHBOARD_MEDIA },
      credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    if (signal.aborted || response.redirected || response.body === null || response.headers.get("content-type") !== USAGE_DASHBOARD_MEDIA
      || ![200, 400, 401, 403, 405, 503].includes(response.status)) throw unavailable();
    const encoding = response.headers.get("content-encoding");
    const declared = encoding === null || encoding.trim().toLowerCase() === "identity" ? response.headers.get("content-length") : null;
    if (declared !== null && (!/^[1-9][0-9]{0,7}$/u.test(declared) || Number(declared) > USAGE_DASHBOARD_MAX_BYTES)) throw unavailable();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (let reads = 0; reads <= MAX_READS; reads++) {
      const chunk = await reader.read();
      if (signal.aborted) throw unavailable();
      if (chunk.done) { complete = true; break; }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0 || chunk.value.byteLength > USAGE_DASHBOARD_MAX_BYTES - length) throw unavailable();
      // Own each chunk now: a producer may reuse its buffer on the next pull.
      chunks.push(chunk.value.slice()); length += chunk.value.byteLength;
    }
    if (!complete || (declared !== null && Number(declared) !== length)) throw unavailable();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const frame = decodeUsageDashboardFrame(bytes);
    if (frame === null || signal.aborted) throw unavailable();
    if (frame.kind === "error") {
      if (usageDashboardErrorStatus(frame.error) !== response.status) throw unavailable();
      return frame;
    }
    if (response.status !== 200 || frame.parts.map(part => part.part).join() !== query.parts.join()) throw unavailable();
    const accountId = frame.accountId;
    let account: UsageAccountReply | undefined, totals: StatsTotalsReadReply | undefined;
    let consent: UsageConsentReadReply | undefined, stats: UsageDashboardStatsBody | undefined;
    for (const part of frame.parts) {
      if (part.part === "account") {
        const reply = decodeUsageAccountReply(part.bytes);
        if (reply === null || usageAccountStatus(reply) !== part.status || !("account" in reply) || reply.account.accountId !== accountId) throw unavailable();
        account = reply;
      } else if (part.part === "totals") {
        const reply = decodeStatsTotalsPublicReply(part.bytes);
        if (reply === null || statsTotalsPublicStatus(reply) !== part.status) throw unavailable();
        totals = Object.freeze({ ...reply, accountId: reply.ok || reply.error === "not_enrolled" ? accountId : null });
      } else if (part.part === "consent") {
        const reply = decodeUsageConsentPublicReply(part.bytes);
        if (reply === null || consentStatus(reply) !== part.status) throw unavailable();
        consent = "error" in reply ? reply : Object.freeze({ ...reply, accountId });
      } else {
        if (query.range === null) throw unavailable();
        stats = Object.freeze({ body: new Blob([part.bytes]), status: part.status, accountId: part.status === 503 ? null : accountId, range: query.range });
      }
    }
    return Object.freeze({ kind: "ready", accountId, sessionRefreshInMs: frame.sessionRefreshInMs,
      ...(account === undefined ? {} : { account }), ...(totals === undefined ? {} : { totals }),
      ...(consent === undefined ? {} : { consent }), ...(stats === undefined ? {} : { stats }) });
  } catch { throw unavailable(); }
  finally {
    if (reader !== undefined) {
      if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* No response disclosure. */ } }
      try { reader.releaseLock(); } catch { /* A pending aborted read owns no result. */ }
    } else { try { void response?.body?.cancel().catch(() => {}); } catch { /* Browser owns disposal. */ } }
  }
}
