import {
  decodeUsageConsentDecision, decodeUsageConsentPublicReply, encodeUsageConsentDecision,
  USAGE_CONSENT_PUBLIC_MAX_BYTES, USAGE_CONSENT_PUBLIC_MEDIA, USAGE_CONSENT_PUBLIC_PATH,
  type UsageConsentPublicReply,
} from "./consent-public";
import type { UsageConsentDecision } from "./consent-contract";

const unavailable = () => new Error("usage_unavailable");
const statuses = [200, 400, 401, 403, 405, 409, 503] as const;

async function bounded(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const encoding = response.headers.get("content-encoding");
  const declared = encoding === null || encoding.trim().toLowerCase() === "identity"
    ? response.headers.get("content-length") : null;
  if (declared !== null && (!/^[1-9][0-9]{0,4}$/u.test(declared) || Number(declared) > USAGE_CONSENT_PUBLIC_MAX_BYTES)) throw unavailable();
  if (response.body === null) throw unavailable();
  const reader = response.body.getReader();
  let complete = false;
  try {
    const bytes = new Uint8Array(USAGE_CONSENT_PUBLIC_MAX_BYTES);
    let length = 0;
    for (let reads = 0; reads <= USAGE_CONSENT_PUBLIC_MAX_BYTES; reads++) {
      const chunk = await reader.read();
      if (signal.aborted) throw unavailable();
      if (chunk.done) { complete = true; break; }
      if (chunk.value.byteLength > bytes.length - length) throw unavailable();
      bytes.set(chunk.value, length); length += chunk.value.byteLength;
    }
    if (!complete || (declared !== null && Number(declared) !== length)) throw unavailable();
    return bytes.subarray(0, length);
  } finally {
    if (!complete) { try { await reader.cancel(); } catch { /* Browser owns disposal. */ } }
    reader.releaseLock();
  }
}
function statusOf(reply: UsageConsentPublicReply): number {
  return "error" in reply
    ? { invalid_request: 400, authentication_required: 401, request_rejected: 403, method_not_allowed: 405, handle_unavailable: 409, publishing_full: 409, unavailable: 503 }[reply.error.code]
    : 200;
}

/** Only this tab's request; no browser persistence, credentials in JSON or retries. */
export async function readUsageConsent(
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<UsageConsentPublicReply> {
  if (signal.aborted) throw unavailable();
  let response: Response | undefined;
  try {
    response = await fetcher(USAGE_CONSENT_PUBLIC_PATH, { method: "GET", headers: { accept: "application/json" },
      credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    if (signal.aborted || response.redirected || response.headers.get("content-type") !== USAGE_CONSENT_PUBLIC_MEDIA
      || !statuses.includes(response.status as 200)) throw unavailable();
    const bytes = await bounded(response, signal);
    const reply = decodeUsageConsentPublicReply(bytes);
    if (reply === null || statusOf(reply) !== response.status || signal.aborted) throw unavailable();
    return reply;
  } catch { throw unavailable(); }
  finally {
    if (response?.body !== null && response?.body !== undefined) {
      try { await response.body.cancel(); } catch { /* No retry or response disclosure. */ }
    }
  }
}

/** The consent decision is the only accepted body; account identity is always
 * derived server-side from the live session. */
export async function setUsageConsent(
  decision: UsageConsentDecision,
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<UsageConsentPublicReply> {
  const body = encodeUsageConsentDecision(decision);
  if (body === null || decodeUsageConsentDecision(body) === null || signal.aborted) throw unavailable();
  let response: Response | undefined;
  try {
    response = await fetcher(USAGE_CONSENT_PUBLIC_PATH, { method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "content-length": `${body.length}` },
      credentials: "same-origin", cache: "no-store", redirect: "error", body, signal });
    if (signal.aborted || response.redirected || response.headers.get("content-type") !== USAGE_CONSENT_PUBLIC_MEDIA
      || !statuses.includes(response.status as 200)) throw unavailable();
    const bytes = await bounded(response, signal);
    const reply = decodeUsageConsentPublicReply(bytes);
    if (reply === null || statusOf(reply) !== response.status || signal.aborted) throw unavailable();
    return reply;
  } catch { throw unavailable(); }
  finally {
    if (response?.body !== null && response?.body !== undefined) {
      try { await response.body.cancel(); } catch { /* No retry or response disclosure. */ }
    }
  }
}
