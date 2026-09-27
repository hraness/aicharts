import "server-only";

/** The one provider response this cache may replay. */
export const USAGE_USERINFO_URL = "https://account.hraness.com/api/auth/oauth2/userinfo";
/** How long one live verdict may answer later private reads for the same bearer.
 * A revoked session is refused by this server within this window. */
export const USAGE_USERINFO_REUSE_MS = 60_000;
const ENTRIES = 256;
const BODY_BYTES = 16_384;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Entry = Readonly<{ expiresAt: number; body: Uint8Array<ArrayBuffer>; contentType: string }>;

/** Replays a recent 200 userinfo body for the exact same bearer. The SDK still
 * parses and checks the replayed body against the sealed session, so a hit can
 * only repeat what Accounts already said about this token; it never widens it. */
export type UsageUserInfoCache = Readonly<{
  fetch(fetcher: Fetch, input: RequestInfo | URL, init: RequestInit | undefined, now: () => number): Promise<Response>;
}>;

function cacheableBearer(input: RequestInfo | URL, init: RequestInit | undefined): string | null {
  try {
    if (input instanceof Request || (init?.method ?? "GET") !== "GET" || init?.body != null) return null;
    if ((input instanceof URL ? input.href : String(input)) !== USAGE_USERINFO_URL) return null;
    const authorization = new Headers(init?.headers).get("authorization");
    return authorization !== null && /^Bearer [A-Za-z0-9._~+/-]{1,8192}=*$/u.test(authorization) ? authorization : null;
  } catch { return null; }
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function boundedBody(response: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[1-9][0-9]{0,4}$/u.test(declared) || Number(declared) > BODY_BYTES)) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > 0 && bytes.byteLength <= BODY_BYTES && (declared === null || Number(declared) === bytes.byteLength) ? bytes : null;
}

export function createUsageUserInfoCache(windowMs = USAGE_USERINFO_REUSE_MS): UsageUserInfoCache {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > USAGE_USERINFO_REUSE_MS) throw new Error("usage_userinfo_window");
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<void>>();
  const valid = (time: unknown): time is number => typeof time === "number" && Number.isSafeInteger(time) && time >= 0;
  const hit = (key: string, time: number, signal: AbortSignal | null | undefined): Response | null => {
    const entry = entries.get(key);
    if (entry === undefined) return null;
    // A clock that ran backwards cannot extend a verdict past its first expiry.
    if (time >= entry.expiresAt || entry.expiresAt - time > windowMs) { entries.delete(key); return null; }
    if (signal?.aborted) throw new Error("usage_userinfo_aborted");
    return new Response(entry.body.slice(), { status: 200, headers: { "content-type": entry.contentType } });
  };
  return Object.freeze({
    async fetch(fetcher, input, init, now) {
      const authorization = cacheableBearer(input, init);
      if (authorization === null) return fetcher(input, init);
      const key = await digest(authorization);
      const started = now();
      if (!valid(started)) return fetcher(input, init);
      const cached = hit(key, started, init?.signal);
      if (cached !== null) return cached;
      const inFlight = pending.get(key);
      if (inFlight !== undefined) {
        await inFlight;
        const joined = now();
        const replay = valid(joined) ? hit(key, joined, init?.signal) : null;
        if (replay !== null) return replay;
      }
      let settle!: () => void;
      const flight = new Promise<void>(resolve => { settle = resolve; });
      pending.set(key, flight);
      try {
        const response = await fetcher(input, init);
        if (response.status !== 200 || response.headers.has("location") || response.redirected) { entries.delete(key); return response; }
        const contentType = response.headers.get("content-type");
        if (contentType === null || contentType.split(";", 1)[0]!.trim().toLowerCase() !== "application/json") return response;
        let body: Uint8Array<ArrayBuffer> | null = null;
        try { body = await boundedBody(response.clone()); } catch { body = null; }
        const stored = now();
        if (body !== null && valid(stored) && stored >= started) {
          entries.delete(key);
          entries.set(key, Object.freeze({ expiresAt: started + windowMs, body, contentType }));
          for (const [oldest, entry] of entries) {
            if (entries.size <= ENTRIES && entry.expiresAt > stored) break;
            entries.delete(oldest);
          }
        }
        return response;
      } finally {
        if (pending.get(key) === flight) pending.delete(key);
        settle();
      }
    },
  });
}
