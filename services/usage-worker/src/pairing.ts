import { DurableObject } from "cloudflare:workers";

/** Dormant internal RPC primitives, not an authenticated HTTP API. */
export type PairingError =
  | "invalid_input" | "not_initialized" | "conflict" | "unauthorized"
  | "expired" | "throttled" | "attempt_limit" | "invalid_transition"
  | "authentication_not_fresh" | "storage_invalid" | "clock_regressed";
export type PairingResult<T> = { ok: true; value: T } | { ok: false; error: PairingError };
export type PairingStatus = "pending" | "browser-approved" | "terminal-confirmed" | "denied" | "expired";
export type PairingView = {
  state: PairingStatus;
  expiresAtMs: number;
  pollAfterMs: number;
  approvedAccountId: string | null;
};
export type BrowserPairingView = {
  state: PairingStatus;
  expiresAtMs: number;
  accountId: string | null;
  authenticationExpiresAtMs: number | null;
};
type Authentication = { accountId: string; authTimeMs: number; sessionExpiresAtMs: number; recordedAtMs: number };
type Attempt = {
  id: string; nonceCommitment: string; contextCommitment: string;
  startedAtMs: number; authentication: Authentication | null;
};
type State = {
  intentId: string; pollCommitment: string; uploadCommitment: string;
  createdAtMs: number; expiresAtMs: number; observedAtMs: number; nextPollAtMs: number;
  failedAttempts: number; browserAttempts: number; status: PairingStatus;
  attempt: Attempt | null; approvedAccountId: string | null;
};
type BrowserProof = { intentId: string; attemptId: string; browserNonce: string; contextToken: string };
type BrowserDigests = { nonce: string; context: string };

export const PAIRING_TTL_MS = 600_000;
export const POLL_INTERVAL_MS = 5_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const MAX_BROWSER_ATTEMPTS = 4;
const MAX_TIME = 8_640_000_000_000_000;
const MAX_PAYLOAD = 8_192;
const SCHEMA_SQL = "CREATE TABLE pairing_state (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0), payload TEXT CHECK (payload IS NULL OR length(payload) <= 8192))";
const STATE_KEYS = ["intentId", "pollCommitment", "uploadCommitment", "createdAtMs", "expiresAtMs", "observedAtMs", "nextPollAtMs", "failedAttempts", "browserAttempts", "status", "attempt", "approvedAccountId"];
const BROWSER_KEYS = ["intentId", "attemptId", "browserNonce", "contextToken"];
const ok = <T>(value: T): PairingResult<T> => ({ ok: true, value });
const err = (error: PairingError): PairingResult<never> => ({ ok: false, error });
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
const boundedInteger = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
const hex = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
// This matches the immutable Suite Accounts SDK's opaque account identifier.
const account = (value: unknown): value is string => typeof value === "string" && value.length === 37 && /^acct_[0-9a-f]{32}$/u.test(value);

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every(key => typeof key === "string" && keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
    && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
}

function same(left: string, right: string): boolean {
  // Inputs are fixed-size commitments. Avoid a data-dependent early exit.
  let difference = left.length ^ right.length;
  for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function digest(role: string, ...parts: string[]): Promise<string> {
  const input = new TextEncoder().encode(["aicharts:pairing:v1", role, ...parts].join("\0"));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The future client computes this from a separate random upload secret; no upload secret is sent here. */
export async function uploadSecretCommitment(intentId: unknown, secret: unknown): Promise<PairingResult<string>> {
  if (!hex(intentId) || !hex(secret)) return err("invalid_input");
  return ok(await digest("upload", intentId, secret));
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function browserInput(value: unknown, extra: readonly string[] = []): value is BrowserProof & Record<string, unknown> {
  return exact(value, [...BROWSER_KEYS, ...extra]) && BROWSER_KEYS.every(key => hex(value[key]));
}

/** Own only data properties before hashing or another asynchronous boundary. */
function browserSnapshot(value: unknown, extra: readonly string[] = []): (BrowserProof & Record<string, unknown>) | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = [...BROWSER_KEYS, ...extra];
    const own = Reflect.ownKeys(descriptors);
    if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return null;
      result[key] = descriptor.value as unknown;
    }
    return BROWSER_KEYS.every(key => hex(result[key])) ? result as BrowserProof & Record<string, unknown> : null;
  } catch { return null; }
}

async function browserDigests(value: BrowserProof): Promise<BrowserDigests> {
  return {
    nonce: await digest("browser-nonce", value.intentId, value.browserNonce),
    context: await digest("browser-context", value.intentId, value.attemptId, value.browserNonce, value.contextToken),
  };
}

function validState(value: unknown): value is State {
  if (!exact(value, STATE_KEYS) || !hex(value.intentId) || !hex(value.pollCommitment) || !hex(value.uploadCommitment)
    || value.pollCommitment === value.uploadCommitment || !isTime(value.createdAtMs) || !isTime(value.expiresAtMs)
    || value.expiresAtMs - value.createdAtMs !== PAIRING_TTL_MS || !isTime(value.observedAtMs)
    || value.observedAtMs < value.createdAtMs || !isTime(value.nextPollAtMs)
    || value.nextPollAtMs < value.createdAtMs || value.nextPollAtMs > value.observedAtMs + POLL_INTERVAL_MS
    || !boundedInteger(value.failedAttempts, MAX_FAILED_ATTEMPTS) || !boundedInteger(value.browserAttempts, MAX_BROWSER_ATTEMPTS)
    || !["pending", "browser-approved", "terminal-confirmed", "denied", "expired"].includes(value.status as string)
    || !(value.approvedAccountId === null || account(value.approvedAccountId))) return false;
  if (value.failedAttempts === MAX_FAILED_ATTEMPTS && value.status !== "denied") return false;
  if ((value.browserAttempts === 0) !== (value.attempt === null)) return false;
  if (value.attempt !== null) {
    const attempt = value.attempt;
    if (!exact(attempt, ["id", "nonceCommitment", "contextCommitment", "startedAtMs", "authentication"])
      || !hex(attempt.id) || !hex(attempt.nonceCommitment) || !hex(attempt.contextCommitment)
      || !isTime(attempt.startedAtMs) || attempt.startedAtMs < value.createdAtMs
      || attempt.startedAtMs >= value.expiresAtMs || attempt.startedAtMs > value.observedAtMs) return false;
    if (attempt.authentication !== null) {
      const auth = attempt.authentication;
      if (!exact(auth, ["accountId", "authTimeMs", "sessionExpiresAtMs", "recordedAtMs"])
        || !account(auth.accountId) || !isTime(auth.authTimeMs) || auth.authTimeMs % 1_000 !== 0
        || auth.authTimeMs < Math.floor(attempt.startedAtMs / 1_000) * 1_000
        || !isTime(auth.recordedAtMs) || auth.recordedAtMs < attempt.startedAtMs
        || auth.authTimeMs > auth.recordedAtMs || auth.recordedAtMs >= value.expiresAtMs
        || auth.recordedAtMs > value.observedAtMs || !isTime(auth.sessionExpiresAtMs)
        || auth.sessionExpiresAtMs <= auth.recordedAtMs) return false;
    }
  }
  const approved = value.status === "browser-approved" || value.status === "terminal-confirmed";
  if (approved && (!account(value.approvedAccountId) || value.attempt === null
    || (value.attempt as Attempt).authentication?.accountId !== value.approvedAccountId)) return false;
  if (value.status === "pending" && value.approvedAccountId !== null) return false;
  return true;
}

function view(state: State, now: number): PairingView {
  return {
    state: state.status, expiresAtMs: state.expiresAtMs,
    pollAfterMs: Math.max(0, state.nextPollAtMs - now),
    approvedAccountId: state.status === "browser-approved" || state.status === "terminal-confirmed" ? state.approvedAccountId : null,
  };
}

function browserView(state: State): BrowserPairingView {
  const authentication = state.attempt?.authentication;
  return {
    state: state.status, expiresAtMs: state.expiresAtMs,
    accountId: authentication?.accountId ?? null,
    authenticationExpiresAtMs: authentication?.sessionExpiresAtMs ?? null,
  };
}

function failedProof(state: State): PairingResult<never> {
  if (state.status === "pending" || state.status === "browser-approved") {
    state.failedAttempts++;
    if (state.failedAttempts >= MAX_FAILED_ATTEMPTS) state.status = "denied";
  }
  return err("unauthorized");
}

function expired(state: State, now: number): boolean {
  if (now < state.expiresAtMs) return false;
  // Terminal decisions never become pending again, including after clock changes.
  if (state.status === "pending" || state.status === "browser-approved") state.status = "expired";
  return true;
}

function matchesBrowser(state: State, input: BrowserProof, proof: BrowserDigests): boolean {
  return state.attempt !== null && state.attempt.id === input.attemptId
    && same(state.attempt.nonceCommitment, proof.nonce) && same(state.attempt.contextCommitment, proof.context);
}

/**
 * Internal-only durable state through account-selection confirmation.
 * recordVerifiedAuthentication accepts facts from the server-only SDK coordinator
 * through a future qualified transport.
 * DTO validation does not authenticate those facts. Never forward browser JSON
 * to it. contextToken is only a product capability bound inside the
 * SDK-sealed transaction context, not proof that OIDC has run by itself.
 * There is no enrollment, credential activation, namespace recovery, or PITR API.
 */
export class PairingIntent extends DurableObject<Env> {
  #healthy = true;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      ctx.storage.transactionSync(() => {
        const objects = this.#schemaObjects();
        if (objects.length === 0) {
          ctx.storage.sql.exec(SCHEMA_SQL);
          // workerd restricts PRAGMAs, including user_version. Version the owned
          // row explicitly, in the same transaction as schema initialization.
          ctx.storage.sql.exec("INSERT INTO pairing_state (id, schema_version, revision, payload) VALUES (1, 1, 0, NULL)");
        }
        this.#assertSchema();
      });
    } catch { this.#healthy = false; }
  }

  #schemaObjects(): Record<string, SqlStorageValue>[] {
    return this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 3").toArray();
  }

  #assertSchema(): void {
    const objects = this.#schemaObjects();
    if (!this.#healthy || objects.length !== 1
      || objects[0]?.type !== "table" || objects[0]?.name !== "pairing_state" || objects[0]?.sql !== SCHEMA_SQL) throw new Error("storage_invalid");
  }

  #transaction<T>(run: (state: State | null, now: number) => { state: State | null; result: PairingResult<T> }): PairingResult<T> {
    try {
      return this.ctx.storage.transactionSync(() => {
        this.#assertSchema();
        const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM pairing_state LIMIT 2").toArray();
        const row = rows[0];
        if (rows.length !== 1 || row?.id !== 1 || row.schema_version !== 1 || typeof row.revision !== "number"
          || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) return err("storage_invalid");
        let state: State | null = null;
        if (row.payload !== null) {
          if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD) return err("storage_invalid");
          const parsed: unknown = JSON.parse(row.payload);
          if (!validState(parsed) || row.revision === 0) return err("storage_invalid");
          state = parsed;
        } else if (row.revision !== 0) return err("storage_invalid");
        const now = Date.now();
        if (!isTime(now) || now > MAX_TIME - PAIRING_TTL_MS || (state !== null && now < state.observedAtMs)) return err("clock_regressed");
        if (state !== null) state.observedAtMs = now;
        const outcome = run(state, now);
        if (outcome.state !== null) {
          if (!validState(outcome.state)) throw new Error("storage_invalid");
          const payload = JSON.stringify(outcome.state);
          if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
          this.ctx.storage.sql.exec("UPDATE pairing_state SET revision = ?, payload = ? WHERE id = 1", row.revision + 1, payload);
        }
        return outcome.result;
      });
    } catch { return err("storage_invalid"); }
  }

  #existing<T>(intentId: string, run: (state: State, now: number) => PairingResult<T>): PairingResult<T> {
    return this.#transaction((state, now) => {
      if (state === null) return { state, result: err("not_initialized") };
      if (state.intentId !== intentId) return { state, result: err("unauthorized") };
      return { state, result: run(state, now) };
    });
  }

  async initialize(input: unknown): Promise<PairingResult<{ expiresAtMs: number }>> {
    if (!exact(input, ["intentId", "pollSecret", "uploadCommitment"]) || !hex(input.intentId)
      || !hex(input.pollSecret) || !hex(input.uploadCommitment)) return err("invalid_input");
    const poll = await digest("poll", input.intentId, input.pollSecret);
    const reusedUpload = await digest("upload", input.intentId, input.pollSecret);
    if (same(input.uploadCommitment, poll) || same(input.uploadCommitment, reusedUpload)) return err("invalid_input");
    const { intentId, uploadCommitment } = input;
    return this.#transaction((state, now) => {
      if (state !== null) return { state, result: state.intentId === intentId
        && same(state.pollCommitment, poll) && same(state.uploadCommitment, uploadCommitment)
        ? ok({ expiresAtMs: state.expiresAtMs }) : err("conflict") };
      const created: State = {
        intentId, pollCommitment: poll, uploadCommitment, createdAtMs: now,
        expiresAtMs: now + PAIRING_TTL_MS, observedAtMs: now, nextPollAtMs: now,
        failedAttempts: 0, browserAttempts: 0, status: "pending", attempt: null, approvedAccountId: null,
      };
      return { state: created, result: ok({ expiresAtMs: created.expiresAtMs }) };
    });
  }

  async poll(input: unknown): Promise<PairingResult<PairingView>> {
    if (!exact(input, ["intentId", "pollSecret"]) || !hex(input.intentId) || !hex(input.pollSecret)) return err("invalid_input");
    const proof = await digest("poll", input.intentId, input.pollSecret);
    return this.#existing(input.intentId, (state, now) => {
      if (!same(state.pollCommitment, proof)) return failedProof(state);
      if (expired(state, now)) return err("expired");
      if (now < state.nextPollAtMs) return err("throttled");
      state.nextPollAtMs = now + POLL_INTERVAL_MS;
      return ok(view(state, now));
    });
  }

  async beginBrowserAttempt(input: unknown): Promise<PairingResult<{ attemptId: string; contextToken: string; startedAtMs: number; expiresAtMs: number }>> {
    if (!exact(input, ["intentId", "browserNonce"]) || !hex(input.intentId) || !hex(input.browserNonce)) return err("invalid_input");
    const attemptId = randomId();
    const contextToken = randomId();
    const proof = await browserDigests({ intentId: input.intentId, attemptId, browserNonce: input.browserNonce, contextToken });
    return this.#existing(input.intentId, (state, now) => {
      if (expired(state, now)) return err("expired");
      if (state.status !== "pending") return err("invalid_transition");
      if (state.browserAttempts >= MAX_BROWSER_ATTEMPTS) return err("attempt_limit");
      state.browserAttempts++;
      state.attempt = { id: attemptId, nonceCommitment: proof.nonce, contextCommitment: proof.context, startedAtMs: now, authentication: null };
      return ok({ attemptId, contextToken, startedAtMs: now, expiresAtMs: state.expiresAtMs });
    });
  }

  async recordVerifiedAuthentication(input: unknown): Promise<PairingResult<{ recorded: true }>> {
    if (!browserInput(input, ["accountId", "authTimeMs", "sessionExpiresAtMs"]) || !account(input.accountId)
      || !isTime(input.authTimeMs) || input.authTimeMs % 1_000 !== 0 || !isTime(input.sessionExpiresAtMs)) return err("invalid_input");
    const proof = await browserDigests(input);
    const { accountId, authTimeMs, sessionExpiresAtMs } = input;
    return this.#existing(input.intentId, (state, now) => {
      if (expired(state, now)) return err("expired");
      if (!matchesBrowser(state, input, proof)) return failedProof(state);
      if (state.status === "denied" || state.status === "expired") return err("invalid_transition");
      const attempt = state.attempt!;
      // Signed OIDC auth_time has seconds precision. No positive clock skew is admitted.
      if (authTimeMs < Math.floor(attempt.startedAtMs / 1_000) * 1_000 || authTimeMs > now || sessionExpiresAtMs <= now) return err("authentication_not_fresh");
      const recorded = attempt.authentication;
      if (recorded !== null) return recorded.accountId === accountId && recorded.authTimeMs === authTimeMs
        && recorded.sessionExpiresAtMs === sessionExpiresAtMs ? ok({ recorded: true }) : err("conflict");
      if (state.status !== "pending") return err("invalid_transition");
      attempt.authentication = { accountId, authTimeMs, sessionExpiresAtMs, recordedAtMs: now };
      return ok({ recorded: true });
    });
  }

  /** Trusted readback, not consent or an authorization grant, even after expiry. */
  async browserStatus(input: unknown): Promise<PairingResult<BrowserPairingView>> {
    const owned = browserSnapshot(input);
    if (owned === null) return err("invalid_input");
    const proof = await browserDigests(owned);
    return this.#existing(owned.intentId, (state, now) => {
      if (!matchesBrowser(state, owned, proof)) return err("unauthorized");
      expired(state, now);
      return ok(browserView(state));
    });
  }

  /** Live account/session facts come only from the trusted server coordinator. */
  async decideBrowser(input: unknown): Promise<PairingResult<BrowserPairingView>> {
    const owned = browserSnapshot(input, ["accountId", "liveSessionExpiresAtMs", "decision"]);
    if (owned === null || !account(owned.accountId) || !isTime(owned.liveSessionExpiresAtMs)
      || (owned.decision !== "approve" && owned.decision !== "deny")) return err("invalid_input");
    const { accountId, liveSessionExpiresAtMs, decision } = owned;
    const proof = await browserDigests(owned);
    return this.#existing(owned.intentId, (state, now) => {
      // Stale browser tabs and lost-reply readbacks must not spend the terminal's
      // guessing budget or deny the current browser attempt.
      if (!matchesBrowser(state, owned, proof)) return err("unauthorized");
      if (expired(state, now)) return err("expired");
      const authentication = state.attempt!.authentication;
      if (authentication === null) return err("invalid_transition");
      if (authentication.accountId !== accountId) return err("unauthorized");
      if (authentication.sessionExpiresAtMs <= now || liveSessionExpiresAtMs <= now) return err("authentication_not_fresh");
      if (decision === "approve") {
        if (state.status === "denied" || state.status === "expired") return err("invalid_transition");
        if (state.status === "pending") {
          state.status = "browser-approved";
          state.approvedAccountId = authentication.accountId;
        }
      } else {
        if (state.status === "terminal-confirmed" || state.status === "expired") return err("invalid_transition");
        state.status = "denied";
      }
      return ok(browserView(state));
    });
  }

  async confirm(input: unknown): Promise<PairingResult<PairingView>> {
    if (!exact(input, ["intentId", "pollSecret", "accountId"]) || !hex(input.intentId)
      || !hex(input.pollSecret) || !account(input.accountId)) return err("invalid_input");
    const proof = await digest("poll", input.intentId, input.pollSecret);
    return this.#existing(input.intentId, (state, now) => {
      if (!same(state.pollCommitment, proof)) return failedProof(state);
      if (expired(state, now)) return err("expired");
      if (state.status !== "browser-approved" && state.status !== "terminal-confirmed") return err("invalid_transition");
      if (state.approvedAccountId !== input.accountId) return failedProof(state);
      if (state.attempt!.authentication!.sessionExpiresAtMs <= now) return err("authentication_not_fresh");
      state.status = "terminal-confirmed";
      return ok(view(state, now));
    });
  }

}
