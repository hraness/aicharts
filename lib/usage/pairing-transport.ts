import "server-only";
import type { UsagePairingIntent } from "./pairing-auth";
import {
  decodePairingTransportRequest, decodePairingTransportResponse, encodePairingTransportRequest,
  PAIRING_TRANSPORT_MAX_RESPONSE_BYTES, type PairingTransportOperation,
} from "./pairing-transport-contract";
import {
  PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, PAIRING_HTTP_MEDIA, PAIRING_HTTP_URL,
  pairingHttpBody, pairingHttpDiscard, pairingHttpFailureBytes, pairingHttpLength, pairingHttpToken,
} from "./pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";

export interface PairingTransportDependencies extends PairingHttpEffects {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getContext(): unknown;
  registerLifetime(terminal: Promise<void>): void;
}

const unavailable = () => new Error("pairing_transport_unavailable");
function ownValue(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

/** Dormant trusted server port. This module installs no resolver or provider binding. */
export function createPairingTransport(dependencies: PairingTransportDependencies): (intentId: string) => UsagePairingIntent {
  const { fetch: fetcher, getContext, registerLifetime, now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;

  return (intentId: string) => {
    if (typeof intentId !== "string" || intentId.length !== 64 || !/^[0-9a-f]{64}$/u.test(intentId) || intentId === "0".repeat(64)) throw unavailable();

    async function invoke(operation: PairingTransportOperation, input: unknown): Promise<unknown> {
      try {
        const startedAt = now();
        const encoded = encodePairingTransportRequest({ schemaVersion: 1, operation, input });
        if (!encoded.ok) throw unavailable();
        const decoded = decodePairingTransportRequest(encoded.value);
        if (!decoded.ok || decoded.value.input.intentId !== intentId) throw unavailable();
        const request = decoded.value;
        const token = ownValue(ownValue(getContext(), "headers"), "x-vercel-oidc-token");
        if (!pairingHttpToken(token) || outstanding >= PAIRING_HTTP_CAPACITY) throw unavailable();
        outstanding++;
        const result = await pairingHttpWork(effects, PAIRING_HTTP_CLIENT_MS, registerLifetime, () => null, () => { outstanding--; }, async work => {
          const controller = new AbortController();
          work.onStop(() => { controller.abort(); });
          work.guard();
          const response = await fetcher(PAIRING_HTTP_URL, {
            method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
            body: new Uint8Array(encoded.value), redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal,
          });
          let reading = false;
          try {
            work.guard();
            if (response.url !== PAIRING_HTTP_URL || response.redirected || response.headers.get("content-type") !== PAIRING_HTTP_MEDIA
              || response.headers.has("content-encoding") || response.headers.has("location") || response.headers.has("set-cookie")) throw unavailable();
            const length = pairingHttpLength(response.headers, PAIRING_TRANSPORT_MAX_RESPONSE_BYTES);
            reading = true;
            const bytes = await pairingHttpBody(response.body, PAIRING_TRANSPORT_MAX_RESPONSE_BYTES, length, work);
            if (response.status !== 200) {
              if (response.status !== 400 && response.status !== 401 && response.status !== 503) throw unavailable();
              const expected = pairingHttpFailureBytes(response.status);
              if (bytes.length !== expected.length || bytes.some((byte, index) => byte !== expected[index])) throw unavailable();
              throw unavailable();
            }
            const domain = decodePairingTransportResponse(bytes, request);
            if (!domain.ok) throw unavailable();
            return domain.value;
          } finally { if (!reading) await pairingHttpDiscard(response); }
        }, startedAt);
        if (result === null) throw unavailable();
        return result;
      } catch { throw unavailable(); }
    }

    return Object.freeze({
      beginBrowserAttempt: (input: unknown) => invoke("beginBrowserAttempt", input),
      recordVerifiedAuthentication: (input: unknown) => invoke("recordVerifiedAuthentication", input),
      browserStatus: (input: unknown) => invoke("browserStatus", input),
      decideBrowser: (input: unknown) => invoke("decideBrowser", input),
    });
  };
}
