import "server-only";
import {
  decodeLeaderboardHttpResponse, LEADERBOARD_HTTP_RESPONSE_BYTES, LEADERBOARD_HTTP_URL,
} from "./leaderboard-http-contract";
import type { LeaderboardSnapshotV1 } from "./leaderboard-contract";
import {
  PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, PAIRING_HTTP_MEDIA,
  pairingHttpBody, pairingHttpDiscard,
} from "./pairing-http-contract";
import { privateDaysHttpLength } from "./private-days-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";

/** Public read port: no Accounts session and no workload token are involved.
 * available() fences the exact configuration across awaits; the public flag is
 * the only authority gate on this path. */
export interface LeaderboardTransportDependencies extends PairingHttpEffects {
  available(): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  registerLifetime(terminal: Promise<void>): void;
}
export type LeaderboardTransportOutcome =
  | Readonly<{ kind: "ready"; value: LeaderboardSnapshotV1 }>
  | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("leaderboard_transport_unavailable");
const failed = (): LeaderboardTransportOutcome => Object.freeze({ kind: "unavailable" });

export function createLeaderboardTransport(dependencies: LeaderboardTransportDependencies) {
  const { fetch: fetcher, registerLifetime, available, now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;
  return async (request: Request): Promise<LeaderboardTransportOutcome> => {
    try {
      if (available() !== true || request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return failed();
      const startedAt = now();
      outstanding++;
      let observed = startedAt;
      const sample = () => {
        const current = now();
        if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) throw unavailable();
        observed = current; return current;
      };
      return await pairingHttpWork<LeaderboardTransportOutcome>({ ...effects, now: sample }, PAIRING_HTTP_CLIENT_MS,
        registerLifetime, failed, () => { outstanding--; }, async work => {
          const guard = () => {
            work.guard();
            if (request.signal.aborted || available() !== true) throw unavailable();
            work.guard();
          };
          guard();
          const controller = new AbortController(); work.onStop(() => { controller.abort(); });
          const response = await fetcher(LEADERBOARD_HTTP_URL, { method: "GET",
            headers: { accept: "application/json", "accept-encoding": "identity" },
            redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal });
          let reading = false;
          try {
            guard();
            if (response.status !== 200 || response.url !== LEADERBOARD_HTTP_URL || response.redirected
              || response.headers.get("content-type") !== PAIRING_HTTP_MEDIA || response.headers.has("content-encoding")
              || response.headers.has("location") || response.headers.has("set-cookie")) throw unavailable();
            const length = privateDaysHttpLength(response.headers, LEADERBOARD_HTTP_RESPONSE_BYTES);
            reading = true;
            const bytes = await pairingHttpBody(response.body, LEADERBOARD_HTTP_RESPONSE_BYTES, length, work);
            guard();
            const domain = decodeLeaderboardHttpResponse(bytes);
            if (domain === null || domain.ok !== true) throw unavailable();
            guard(); return Object.freeze({ kind: "ready", value: domain.value });
          } finally { if (!reading) await pairingHttpDiscard(response); }
        }, startedAt);
    } catch { return failed(); }
  };
}
