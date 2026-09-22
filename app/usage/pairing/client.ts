import { decodePairingPublicReply, encodePairingDecision, parsePairingFragment, PAIRING_PUBLIC_MAX_BYTES,
  PAIRING_PUBLIC_MEDIA, type PairingDecision, type PairingPublicReply, type PairingApproval } from "@/lib/usage/pairing-public";

const unavailable = () => new Error("pairing_unavailable");
export type PairingView = Readonly<{ kind: "loading" | "disabled" | "invalid" | "unavailable" | "uncertain" | "expired" | "rejected" | "deciding" }>
  | Readonly<{ kind: "start" | "starting"; intentId: string }>
  | Readonly<{ kind: "reply"; reply: PairingApproval }>;

/** One browser request, with a bounded decoded body and no decision retry. */
export async function requestPairing(signal: AbortSignal, decision?: Readonly<{ decision: PairingDecision; csrfToken: string }>,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = globalThis.fetch): Promise<PairingPublicReply> {
  const body = decision === undefined ? undefined : encodePairingDecision(decision.decision, decision.csrfToken);
  if (body === null || signal.aborted) throw unavailable();
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    response = await fetcher("/api/usage/pairing", { method: decision === undefined ? "GET" : "POST", body,
      headers: { accept: "application/json", ...(decision === undefined ? {} : { "content-type": "application/json" }) },
      credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    if (signal.aborted || response.redirected || response.headers.has("location") || response.headers.get("content-type") !== PAIRING_PUBLIC_MEDIA
      || response.body === null || ![200, 400, 403, 405, 503].includes(response.status)) throw unavailable();
    // Browser fetch exposes decoded bytes; compressed Content-Length describes
    // the transfer, not this stream. The decoded limit always applies below.
    const encoding = response.headers.get("content-encoding");
    const declared = encoding === null || encoding.trim().toLowerCase() === "identity" ? response.headers.get("content-length") : null;
    if (declared !== null && (!/^[1-9][0-9]{0,2}$/u.test(declared) || Number(declared) > PAIRING_PUBLIC_MAX_BYTES)) throw unavailable();
    reader = response.body.getReader();
    const bytes = new Uint8Array(PAIRING_PUBLIC_MAX_BYTES);
    let length = 0;
    for (let reads = 0; reads <= PAIRING_PUBLIC_MAX_BYTES; reads++) {
      const chunk = await reader.read();
      if (signal.aborted) throw unavailable();
      if (chunk.done) { complete = true; break; }
      if (chunk.value.byteLength > bytes.length - length) throw unavailable();
      bytes.set(chunk.value, length); length += chunk.value.byteLength;
    }
    if (!complete || (declared !== null && Number(declared) !== length)) throw unavailable();
    const reply = decodePairingPublicReply(bytes.subarray(0, length), response.status);
    if (reply === null || signal.aborted) throw unavailable();
    return reply;
  } catch { throw unavailable(); }
  finally {
    if (reader !== undefined) {
      if (!complete) { try { await reader.cancel(); } catch { /* No body is disclosed or retried. */ } }
      reader.releaseLock();
    } else if (response?.body !== undefined && response.body !== null) {
      try { await response.body.cancel(); } catch { /* Browser owns request disposal. */ }
    }
  }
}

export interface PairingBrowser {
  /** Remove the fragment before returning it, including when the feature is closed. */
  takeFragment(): string;
  request(signal: AbortSignal, decision?: Readonly<{ decision: PairingDecision; csrfToken: string }>): Promise<PairingPublicReply>;
  now(): number;
  later(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}

/** Component-owned external browser state. Construction has no browser effects;
 * the only automatic request is the callback page's initial status read. */
export function createPairingController(available: boolean, browser: PairingBrowser) {
  const initial: PairingView = Object.freeze({ kind: available ? "loading" : "disabled" });
  let view: PairingView = initial, fragment: string | undefined, mounted = false, id = 0;
  let pending: AbortController | null = null, timer: unknown, expiry: unknown;
  const listeners = new Set<() => void>();
  function emit(next: PairingView) { view = Object.freeze(next); for (const listener of listeners) listener(); }
  function clearTimers() { if (timer !== undefined) browser.clear(timer); if (expiry !== undefined) browser.clear(expiry); timer = expiry = undefined; }
  function stop() { id++; pending?.abort(); pending = null; clearTimers(); }
  function live(reply: PairingApproval): boolean {
    const now = browser.now();
    return Number.isSafeInteger(now) && now >= 0 && now < reply.expiresAtMs;
  }
  function accept(reply: PairingPublicReply) {
    if ("error" in reply) { emit({ kind: reply.error.code === "USAGE_PAIRING_AUTH_REJECTED" ? "rejected" : "unavailable" }); return; }
    if (!live(reply)) { emit({ kind: "expired" }); return; }
    emit({ kind: "reply", reply });
    expiry = browser.later(() => { if (mounted && view.kind === "reply" && view.reply === reply) emit({ kind: "expired" }); },
      Math.min(reply.expiresAtMs - browser.now(), 600_000));
  }
  async function perform(decision?: Readonly<{ decision: PairingDecision; csrfToken: string }>) {
    if (!mounted || !available) return;
    stop();
    const own = id, controller = new AbortController(); pending = controller;
    emit({ kind: decision === undefined ? "loading" : "deciding" });
    timer = browser.later(() => {
      if (mounted && own === id) { controller.abort(); emit({ kind: decision === undefined ? "unavailable" : "uncertain" }); }
    }, 20_000);
    try {
      const reply = await browser.request(controller.signal, decision);
      if (mounted && own === id && !controller.signal.aborted) accept(reply);
    } catch {
      if (mounted && own === id) emit({ kind: decision === undefined ? "unavailable" : "uncertain" });
    } finally {
      if (own === id) { if (timer !== undefined) browser.clear(timer); timer = undefined; pending = null; }
    }
  }
  return Object.freeze({
    snapshot: () => view,
    serverSnapshot: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount() {
      mounted = true;
      try {
        if (fragment === undefined) fragment = browser.takeFragment();
        if (!available) emit({ kind: "disabled" });
        else if (fragment !== "") {
          const intentId = parsePairingFragment(fragment);
          emit(intentId === null ? { kind: "invalid" } : { kind: "start", intentId });
        } else void perform();
      } catch { emit({ kind: "unavailable" }); }
      return () => { mounted = false; stop(); };
    },
    read() { if (["reply", "unavailable", "uncertain", "rejected"].includes(view.kind)) void perform(); },
    decide(decision: PairingDecision) {
      // Sign-in approves the collector; a recorded attempt can still be denied
      // until the terminal confirms. Pending approvals remain for older workers.
      if (view.kind !== "reply" || !(view.reply.state === "pending"
        || (decision === "deny" && view.reply.state === "browser-approved"))) return;
      if (!live(view.reply)) { emit({ kind: "expired" }); return; }
      void perform({ decision, csrfToken: view.reply.csrfToken });
    },
    navigating() { if (view.kind === "start") emit({ kind: "starting", intentId: view.intentId }); },
  });
}
