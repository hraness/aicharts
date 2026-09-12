import { createLocalJWKSet, errors, jwtVerify, type JWK, type JWTVerifyResult } from "jose";
import { boundedJson, byteView, decodeBase64Url, exactKeys, record } from "./bounded-json";

export interface RequestLifetime {
  waitUntil(promise: Promise<void>): void;
}

export interface VerifierDependencies {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

declare const coordinatorBrand: unique symbol;
export type VerifiedCoordinator = Readonly<{ [coordinatorBrand]: true }>;
export type VerificationResult =
  | Readonly<{ ok: true; value: VerifiedCoordinator }>
  | Readonly<{ ok: false; error: "unauthorized" | "unavailable" }>;

const unauthorized = Object.freeze({ ok: false, error: "unauthorized" } as const);
const unavailable = Object.freeze({ ok: false, error: "unavailable" } as const);
const identity = Object.freeze({
  iss: "https://oidc.vercel.com/hraness",
  aud: "https://vercel.com/hraness",
  sub: "owner:hraness:project:aicharts:environment:production",
  owner: "hraness", owner_id: "team_UAd1iD2XogJlbFg4h14mRaPM",
  project: "aicharts", project_id: "prj_0ppMfRRMDfiVsQ1JaekoxSZ7Mwgn",
  environment: "production",
});
const requiredClaims = Object.freeze([...Object.keys(identity), "exp", "iat", "nbf"]);
const JWKS_URL = "https://oidc.vercel.com/hraness/.well-known/jwks";
const MAX_DATE = 8_640_000_000_000_000;
const CACHE_MS = 300_000;
const COOLDOWN_MS = 30_000;
const FETCH_MS = 2_000;
const VERIFY_MS = 5_000;
const MAX_BODY = 16_384;
const MAX_READS = MAX_BODY + 1;

type KeyEntry = Readonly<{ key: CryptoKey; signatureBytes: number }>;
type Cache = Readonly<{ keys: ReadonlyMap<string, KeyEntry>; expires: number }>;
type Token = Readonly<{ compact: string; kid: string; signatureBytes: number; expires: number; issued: number; begins: number }>;
type Timer = { handle: unknown };

function kid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/u.test(value);
}
function safe(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= max;
}
function checkedHeader(input: unknown): string {
  const header = record(input);
  exactKeys(header, ["alg", "typ", "kid"]);
  if (header.alg !== "RS256" || typeof header.typ !== "string" || !/^[jJ][wW][tT]$/u.test(header.typ) || !kid(header.kid)) throw unauthorized;
  return header.kid;
}
function checkedClaims(input: unknown) {
  const claims = record(input);
  for (const [name, expected] of Object.entries(identity)) if (claims[name] !== expected) throw unauthorized;
  if (Object.hasOwn(claims, "nfb")) throw unauthorized;
  const { exp, iat, nbf } = claims;
  if (!safe(exp, MAX_DATE / 1000) || !safe(iat, MAX_DATE / 1000) || !safe(nbf, MAX_DATE / 1000) || exp <= iat || exp - iat > 7200 || nbf >= exp) throw unauthorized;
  return { expires: exp * 1000, issued: iat * 1000, begins: nbf * 1000 };
}
function active(token: Pick<Token, "expires" | "issued" | "begins">, now: number) {
  if (now < token.issued || now < token.begins || now >= token.expires) throw unauthorized;
}
function tokenInput(input: unknown): Token {
  if (typeof input !== "string" || input.length === 0 || input.length > 8192 || /[^A-Za-z0-9_.-]/u.test(input)) throw unauthorized;
  const parts = input.split(".");
  if (parts.length !== 3) throw unauthorized;
  const header = boundedJson(decodeBase64Url(parts[0]!, 512));
  const claims = boundedJson(decodeBase64Url(parts[1]!, 4096));
  const signature = decodeBase64Url(parts[2]!, 512);
  if (signature.length < 256) throw unauthorized;
  return Object.freeze({ compact: input, kid: checkedHeader(header), signatureBytes: signature.length, ...checkedClaims(claims) });
}
function admittedJwks(input: unknown): { keys: JWK[]; lengths: number[] } {
  const set = record(input); exactKeys(set, ["keys"]);
  if (!Array.isArray(set.keys) || set.keys.length > 8) throw unavailable;
  const seen = new Set<string>(); const keys: JWK[] = []; const lengths: number[] = [];
  for (const inputKey of set.keys) {
    const key = record(inputKey);
    exactKeys(key, ["kty", "kid", "n", "e"], ["alg", "use", "key_ops", "ext"]);
    if (key.kty !== "RSA" || !kid(key.kid) || seen.has(key.kid) || typeof key.n !== "string" || key.e !== "AQAB") throw unavailable;
    if ((Object.hasOwn(key, "alg") && key.alg !== "RS256") || (Object.hasOwn(key, "use") && key.use !== "sig") || (Object.hasOwn(key, "ext") && key.ext !== true)) throw unavailable;
    if (Object.hasOwn(key, "key_ops") && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== "verify")) throw unavailable;
    const modulus = decodeBase64Url(key.n, 512);
    const bits = (modulus.length - 1) * 8 + 32 - Math.clz32(modulus[0]!);
    if (modulus[0] === 0 || bits < 2048 || bits > 4096 || !(modulus[modulus.length - 1]! & 1)) throw unavailable;
    seen.add(key.kid); lengths.push(modulus.length);
    keys.push({ kty: "RSA", kid: key.kid, n: key.n, e: "AQAB", alg: "RS256", use: "sig", key_ops: ["verify"], ext: true });
  }
  return { keys, lengths };
}
function signatureFailure(error: unknown): boolean {
  return error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired || error instanceof errors.JWSInvalid;
}

export function createUsageOidcVerifier(dependencies: VerifierDependencies) {
  // Trusted functions are snapshotted; callers cannot turn request data into policy.
  const { fetch: fetcher, now, setTimeout: later, clearTimeout: clear } = dependencies;
  let cache: Cache | undefined;
  let clockGeneration: object = Object.freeze({});
  let observed = 0;
  let nextFetch = 0;
  let nextTicket = 0;
  let fetchTicket: number | undefined;
  const verificationTickets = new Set<number>();

  function sample(): number {
    let value: unknown;
    try { value = now(); } catch { value = undefined; }
    if (!safe(value, MAX_DATE - CACHE_MS) || value < observed) {
      cache = undefined;
      clockGeneration = Object.freeze({});
      throw unavailable;
    }
    observed = value;
    return value;
  }
  function ticket(): number {
    if (nextTicket >= Number.MAX_SAFE_INTEGER) throw unavailable;
    return ++nextTicket;
  }
  function clearTimer(timer: Timer | undefined) {
    if (timer) { try { clear(timer.handle); } catch { /* Trusted timer failure cannot skip other cleanup. */ } }
  }

  return Object.freeze({
    beginRequest(ctx: RequestLifetime) {
      let open = true;
      let used = false;
      let authority: { handle: VerifiedCoordinator; cache: Cache; expires: number } | undefined;
      let stopOwner: (() => void) | undefined;
      return Object.freeze({
        verify(input: unknown): Promise<VerificationResult> {
          if (!open || used) return Promise.resolve(unavailable);
          used = true;
          let token: Token;
          try { token = tokenInput(input); } catch { return Promise.resolve(unauthorized); }
          let started: number;
          try { started = sample(); } catch { return Promise.resolve(unavailable); }
          try { active(token, started); } catch { return Promise.resolve(unauthorized); }
          if (verificationTickets.size >= 8) return Promise.resolve(unavailable);
          let ownTicket: number;
          try { ownTicket = ticket(); } catch { return Promise.resolve(unavailable); }
          verificationTickets.add(ownTicket);
          const generation = clockGeneration;
          let registered = false;
          let stopped = false;
          let released = false;
          let responseTimer: Timer | undefined;
          let controller: AbortController | undefined;
          let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
          let canceledRead: Promise<void> | undefined;
          let aborted = false;
          let responseSettled = false;
          let resolveResponse!: (result: VerificationResult) => void;
          const response = new Promise<VerificationResult>((resolve) => { resolveResponse = resolve; });
          const settle = (result: VerificationResult) => {
            if (!responseSettled) { responseSettled = true; resolveResponse(result); }
          };
          function cancel() {
            if (controller && !aborted) { aborted = true; controller.abort(); }
            if (reader && !canceledRead) {
              try { canceledRead = reader.cancel().then(() => {}, () => {}); }
              catch { canceledRead = Promise.resolve(); }
            }
          }
          const stop = () => { stopped = true; authority = undefined; cancel(); settle(unavailable); };
          stopOwner = stop;
          function guard(): number {
            const current = sample();
            if (!open || !registered || stopped || generation !== clockGeneration || current >= started + VERIFY_MS) throw unavailable;
            active(token, current);
            return current;
          }
          const release = () => {
            if (!released) { released = true; verificationTickets.delete(ownTicket); }
          };

          async function refresh(flightStart: number): Promise<Cache> {
            const ownFetch = ticket();
            fetchTicket = ownFetch;
            nextFetch = flightStart + COOLDOWN_MS;
            controller = new AbortController();
            let timer: Timer | undefined;
            let complete = false;
            const checkFlight = () => {
              const current = guard();
              if (current >= flightStart + FETCH_MS || fetchTicket !== ownFetch) throw unavailable;
              return current;
            };
            try {
              timer = { handle: later(stop, FETCH_MS) };
              const result = await fetcher(JWKS_URL, {
                method: "GET", redirect: "manual", credentials: "omit",
                headers: { Accept: "application/json, application/jwk-set+json" }, signal: controller.signal,
              });
              reader = result.body?.getReader();
              checkFlight();
              if (result.status !== 200 || result.redirected || result.url !== JWKS_URL || result.headers.has("content-encoding") || !reader) throw unavailable;
              const media = result.headers.get("content-type");
              if (media === null || !/^\s*application\/(?:json|jwk-set\+json)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu.test(media)) throw unavailable;
              const lengthHeader = result.headers.get("content-length");
              let length: number | undefined;
              if (lengthHeader !== null) {
                if (!/^[1-9][0-9]*$/u.test(lengthHeader) || lengthHeader.length > 5) throw unavailable;
                length = Number(lengthHeader);
                if (length > MAX_BODY) throw unavailable;
              }
              const bytes = new Uint8Array(MAX_BODY);
              let size = 0;
              let reads = 0;
              while (true) {
                if (reads++ >= MAX_READS) throw unavailable;
                const read = await reader.read(); checkFlight();
                if (read.done) break;
                const chunk = byteView(read.value);
                if (chunk.length > MAX_BODY - size) throw unavailable;
                bytes.set(chunk, size); size += chunk.length;
              }
              if (size === 0 || (length !== undefined && size !== length)) throw unavailable;
              const owned = admittedJwks(boundedJson(bytes.subarray(0, size)));
              const resolver = createLocalJWKSet({ keys: owned.keys });
              const keys = new Map<string, KeyEntry>();
              for (let index = 0; index < owned.keys.length; index++) {
                checkFlight();
                const jwk = owned.keys[index]!;
                const key = await resolver({ alg: "RS256", kid: jwk.kid });
                checkFlight();
                const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
                if (key.type !== "public" || algorithm.name !== "RSASSA-PKCS1-v1_5" || algorithm.hash?.name !== "SHA-256" || !Number.isInteger(algorithm.modulusLength) || algorithm.modulusLength < 2048 || algorithm.modulusLength > 4096 || Math.ceil(algorithm.modulusLength / 8) !== owned.lengths[index] || key.usages.length !== 1 || key.usages[0] !== "verify") throw unavailable;
                keys.set(jwk.kid!, Object.freeze({ key, signatureBytes: owned.lengths[index]! }));
              }
              checkFlight();
              const admitted = Object.freeze({ keys, expires: flightStart + CACHE_MS });
              cache = admitted;
              complete = true;
              return admitted;
            } catch (error) {
              throw error === unauthorized ? unauthorized : unavailable;
            } finally {
              clearTimer(timer);
              if (!complete) cancel();
              if (canceledRead) await canceledRead;
              try { reader?.releaseLock(); } catch { /* No I/O follows release. */ }
              reader = undefined; controller = undefined;
              if (fetchTicket === ownFetch) {
                try { nextFetch = Math.max(nextFetch, sample() + COOLDOWN_MS); } catch { /* Retain the old clock floor and reservation. */ }
                fetchTicket = undefined;
              }
            }
          }

          const work = Promise.resolve().then(async () => {
            try {
              if (!registered || !open || stopped) return unavailable;
              responseTimer = { handle: later(stop, VERIFY_MS) };
              const current = guard();
              let selected = cache && current < cache.expires ? cache : undefined;
              if (!selected?.keys.has(token.kid)) {
                if (fetchTicket !== undefined) return unavailable;
                if (current < nextFetch) return selected ? unauthorized : unavailable;
                selected = await refresh(current);
              }
              const entry = selected.keys.get(token.kid);
              if (!entry) return unauthorized;
              const beforeVerify = guard();
              if (cache !== selected || beforeVerify >= selected.expires) return unavailable;
              if (token.signatureBytes !== entry.signatureBytes) return unauthorized;
              let verified: JWTVerifyResult;
              try {
                verified = await jwtVerify(token.compact, entry.key, {
                  algorithms: ["RS256"], issuer: identity.iss, audience: identity.aud, subject: identity.sub,
                  typ: "jwt", requiredClaims: [...requiredClaims], maxTokenAge: 7200, clockTolerance: 0,
                  currentDate: new Date(beforeVerify),
                });
              } catch (error) {
                // jose can mask verify exceptions as bad signatures. Recheck our
                // own fences even on that indistinguishable rejection path.
                const rejectedAt = guard();
                if (cache !== selected || rejectedAt >= selected.expires) return unavailable;
                return signatureFailure(error) ? unauthorized : unavailable;
              }
              const finalTime = guard();
              if (cache !== selected || finalTime >= selected.expires) return unavailable;
              if (checkedHeader(verified.protectedHeader) !== token.kid) return unauthorized;
              const times = checkedClaims(verified.payload); active(times, finalTime);
              const handle = Object.freeze(Object.create(null)) as VerifiedCoordinator;
              authority = { handle, cache: selected, expires: times.expires };
              return Object.freeze({ ok: true, value: handle } as const);
            } catch (error) {
              return error === unauthorized ? unauthorized : unavailable;
            } finally {
              clearTimer(responseTimer);
              release();
              stopOwner = undefined;
            }
          });
          // Register the actual owner/cleanup promise before its microtask can start.
          const terminal = work.then((result) => { settle(result); }, () => { settle(unavailable); });
          try { ctx.waitUntil(terminal); registered = true; }
          catch { stopped = true; release(); settle(unavailable); }
          return response;
        },
        isCurrent(handle: unknown) {
          if (!open || !authority || authority.handle !== handle) return false;
          try {
            const current = sample();
            return cache === authority.cache && current < authority.expires && current < authority.cache.expires;
          } catch { return false; }
        },
        finish() { open = false; authority = undefined; stopOwner?.(); },
      });
    },
  });
}
