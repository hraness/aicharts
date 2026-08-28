#!/usr/bin/env bun

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import {
  CodexRateLimitRecorderFailure,
  type CodexRateLimitReadResult,
  type CodexRateLimitReader,
  type CodexRateLimitRecorderResult,
  readCodexRateLimits,
  recordCodexRateLimits,
} from "./codex-rate-limit-tracking";

const AUTH_FILE_MAX_BYTES = 1_048_576;
const LEDGER_FILE_MAX_BYTES = 16 * 1_048_576;
const LOCK_STALE_AFTER_MS = 5 * 60 * 1_000;
const MAX_ACCOUNTS = 50_000;
const MAX_INTERVALS = 200_000;
const MAX_CONTIGUOUS_OBSERVATION_GAP_MS = 150 * 60 * 1_000;
const SECRET_BYTES = 32;

const authModes = ["api-key", "chatgpt", "missing", "invalid", "unknown"] as const;
const planStatuses = ["not-applicable", "subscription-unverified", "unavailable"] as const;

export type RecordedAuthMode = typeof authModes[number];
export type RecordedPlanStatus = typeof planStatuses[number];

type AccountObservation = Readonly<{
  accountFingerprint: string | null;
  authMode: RecordedAuthMode;
  planStatus: RecordedPlanStatus;
}>;

type AccountEntry = {
  fingerprint: string;
  firstObservedAt: string;
  lastObservedAt: string;
};

type AccountInterval = {
  accountFingerprint: string | null;
  authMode: RecordedAuthMode;
  planStatus: RecordedPlanStatus;
  startedAt: string;
  lastObservedAt: string;
};

type AccountLedger = {
  version: 1;
  keyId: string;
  createdAt: string;
  updatedAt: string;
  accounts: AccountEntry[];
  intervals: AccountInterval[];
};

type SecretMaterial = Readonly<{
  keyId: string;
  secret: Buffer;
}>;

export type RecorderResult = Readonly<{
  kind: "recorded";
  observedAt: string;
  changed: boolean;
  observedAccountFingerprintCount: number;
  authMode: RecordedAuthMode;
  planStatus: RecordedPlanStatus;
  rateLimits: CodexRateLimitRecorderResult;
}> | Readonly<{
  kind: "busy";
  observedAt: string;
}>;

type RecorderPaths = Readonly<{
  auth: string;
  ledger: string;
  lock: string;
  rateLimits: string;
  secret: string;
  stateRoot: string;
}>;

type LockOwner = Readonly<{
  acquiredAt: string;
  nonce: string;
  pid: number;
}>;

class RecorderFailure extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 65) {
    super(message);
    this.name = "RecorderFailure";
    this.exitCode = exitCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function isAuthMode(value: unknown): value is RecordedAuthMode {
  return typeof value === "string" && (authModes as readonly string[]).includes(value);
}

function isPlanStatus(value: unknown): value is RecordedPlanStatus {
  return typeof value === "string" && (planStatuses as readonly string[]).includes(value);
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string"
    && /^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/.test(value);
}

function isKeyId(value: unknown): value is string {
  return typeof value === "string"
    && /^sha256:v1:[A-Za-z0-9_-]{43}$/.test(value);
}

function keyIdForSecret(secret: Buffer): string {
  const digest = createHash("sha256")
    .update("aicharts-account-hmac-key:v1\0", "utf8")
    .update(secret)
    .digest("base64url");
  return `sha256:v1:${digest}`;
}

function parseLedger(value: unknown): AccountLedger | null {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    "accounts",
    "createdAt",
    "intervals",
    "keyId",
    "updatedAt",
    "version",
  ])) return null;
  if (value.version !== 1 || !isKeyId(value.keyId) || !isIsoTimestamp(value.createdAt)
    || !isIsoTimestamp(value.updatedAt) || !Array.isArray(value.accounts)
    || value.accounts.length > MAX_ACCOUNTS || !Array.isArray(value.intervals)
    || value.intervals.length > MAX_INTERVALS) return null;

  const accounts: AccountEntry[] = [];
  const seenFingerprints = new Set<string>();
  for (const candidate of value.accounts) {
    if (!isRecord(candidate) || !hasExactlyKeys(candidate, [
      "fingerprint",
      "firstObservedAt",
      "lastObservedAt",
    ]) || !isFingerprint(candidate.fingerprint)
      || !isIsoTimestamp(candidate.firstObservedAt)
      || !isIsoTimestamp(candidate.lastObservedAt)
      || candidate.firstObservedAt > candidate.lastObservedAt
      || candidate.firstObservedAt < value.createdAt
      || candidate.lastObservedAt > value.updatedAt
      || seenFingerprints.has(candidate.fingerprint)) return null;
    seenFingerprints.add(candidate.fingerprint);
    accounts.push({
      fingerprint: candidate.fingerprint,
      firstObservedAt: candidate.firstObservedAt,
      lastObservedAt: candidate.lastObservedAt,
    });
  }

  const intervals: AccountInterval[] = [];
  for (const candidate of value.intervals) {
    if (!isRecord(candidate) || !hasExactlyKeys(candidate, [
      "accountFingerprint",
      "authMode",
      "lastObservedAt",
      "planStatus",
      "startedAt",
    ]) || (candidate.accountFingerprint !== null
      && !isFingerprint(candidate.accountFingerprint))
      || !isAuthMode(candidate.authMode) || !isPlanStatus(candidate.planStatus)
      || !isIsoTimestamp(candidate.startedAt)
      || !isIsoTimestamp(candidate.lastObservedAt)
      || candidate.startedAt > candidate.lastObservedAt
      || candidate.startedAt < value.createdAt
      || candidate.lastObservedAt > value.updatedAt
      || (candidate.accountFingerprint !== null
        && !seenFingerprints.has(candidate.accountFingerprint))) return null;
    intervals.push({
      accountFingerprint: candidate.accountFingerprint,
      authMode: candidate.authMode,
      planStatus: candidate.planStatus,
      startedAt: candidate.startedAt,
      lastObservedAt: candidate.lastObservedAt,
    });
  }

  if (value.createdAt > value.updatedAt) return null;
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index]!.startedAt < intervals[index - 1]!.lastObservedAt) return null;
  }
  return {
    version: 1,
    keyId: value.keyId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    accounts,
    intervals,
  };
}

function normalizedAuthMode(value: unknown): RecordedAuthMode {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "chatgpt") return "chatgpt";
  if (normalized === "api-key" || normalized === "apikey") return "api-key";
  return "unknown";
}

function hmacAccountId(accountId: string, secret: Buffer): string {
  const digest = createHmac("sha256", secret).update(accountId, "utf8").digest("base64url");
  return `hmac-sha256:v1:${digest}`;
}

/**
 * Narrows a parsed auth document to the only two fields this recorder uses.
 * The returned value never contains the raw account identifier.
 */
export function observeParsedAuth(value: unknown, secret: Buffer): AccountObservation {
  if (!isRecord(value)) {
    return { accountFingerprint: null, authMode: "invalid", planStatus: "unavailable" };
  }
  const authMode = normalizedAuthMode(value.auth_mode);
  if (authMode === "api-key") {
    return { accountFingerprint: null, authMode, planStatus: "not-applicable" };
  }
  if (authMode !== "chatgpt") {
    return { accountFingerprint: null, authMode, planStatus: "unavailable" };
  }
  const tokens = value.tokens;
  if (!isRecord(tokens) || typeof tokens.account_id !== "string"
    || tokens.account_id.length === 0 || tokens.account_id.length > 4_096) {
    return {
      accountFingerprint: null,
      authMode: "chatgpt",
      planStatus: "subscription-unverified",
    };
  }
  return {
    accountFingerprint: hmacAccountId(tokens.account_id, secret),
    authMode: "chatgpt",
    planStatus: "subscription-unverified",
  };
}

function assertOwnedByCurrentUser(ownerUid: number, label: string): void {
  if (typeof process.getuid === "function" && ownerUid !== process.getuid()) {
    throw new RecorderFailure(`${label} is not owned by the current user.`);
  }
}

async function ensurePrivateStateDirectory(stateRoot: string): Promise<void> {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const metadata = await lstat(stateRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new RecorderFailure("Account recorder state path is not a private directory.");
  }
  assertOwnedByCurrentUser(metadata.uid, "Account recorder state directory");
  if ((metadata.mode & 0o777) !== 0o700) {
    throw new RecorderFailure("Account recorder state directory must have mode 0700.");
  }
}

async function readPrivateRegularFile(
  filePath: string,
  label: string,
  maximumBytes: number,
): Promise<Buffer | null> {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    if (isRecord(error) && error.code === "ELOOP") {
      throw new RecorderFailure(`${label} must not be a symbolic link.`);
    }
    throw new RecorderFailure(`Unable to open ${label.toLowerCase()}.`);
  }
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new RecorderFailure(`${label} must be a regular file.`);
    assertOwnedByCurrentUser(metadata.uid, label);
    if ((metadata.mode & 0o077) !== 0) {
      throw new RecorderFailure(`${label} permissions are too broad; mode 0600 is required.`);
    }
    if (metadata.size > maximumBytes) {
      throw new RecorderFailure(`${label} exceeds its safe size limit.`);
    }
    const bytes = await file.readFile();
    if (bytes.length > maximumBytes) {
      throw new RecorderFailure(`${label} exceeds its safe size limit.`);
    }
    return bytes;
  } finally {
    await file.close();
  }
}

function parseSecretMaterial(bytes: Buffer): SecretMaterial | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !hasExactlyKeys(parsed, ["key", "keyId", "version"])
    || parsed.version !== 1 || typeof parsed.key !== "string" || !isKeyId(parsed.keyId)) {
    return null;
  }
  const secret = Buffer.from(parsed.key, "base64url");
  if (secret.length !== SECRET_BYTES || secret.toString("base64url") !== parsed.key
    || keyIdForSecret(secret) !== parsed.keyId) return null;
  return { keyId: parsed.keyId, secret };
}

async function readOrCreateSecret(
  secretPath: string,
  allowCreate: boolean,
): Promise<SecretMaterial> {
  const existing = await readPrivateRegularFile(secretPath, "Account HMAC secret", 512);
  if (existing !== null) {
    const material = parseSecretMaterial(existing);
    if (material === null) throw new RecorderFailure("Account HMAC secret is invalid.");
    return material;
  }
  if (!allowCreate) {
    throw new RecorderFailure("Account HMAC secret is missing while observations exist.");
  }

  const secret = randomBytes(SECRET_BYTES);
  const material: SecretMaterial = { keyId: keyIdForSecret(secret), secret };
  let candidate;
  try {
    candidate = await open(secretPath, "wx", 0o600);
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") {
      throw new RecorderFailure("Unable to create account HMAC secret.");
    }
    const raced = await readPrivateRegularFile(secretPath, "Account HMAC secret", 512);
    if (raced === null) throw new RecorderFailure("Account HMAC secret creation raced.");
    const racedMaterial = parseSecretMaterial(raced);
    if (racedMaterial === null) throw new RecorderFailure("Account HMAC secret is invalid.");
    return racedMaterial;
  }
  try {
    await candidate.writeFile(`${JSON.stringify({
      version: 1,
      keyId: material.keyId,
      key: secret.toString("base64url"),
    })}\n`, "utf8");
    await candidate.chmod(0o600);
    await candidate.sync();
    await candidate.close();
    candidate = undefined;
    return material;
  } catch {
    if (candidate !== undefined) await candidate.close().catch(() => undefined);
    await unlink(secretPath).catch(() => undefined);
    throw new RecorderFailure("Unable to create account HMAC secret.");
  }
}

async function readAuthObservation(authPath: string, secret: Buffer): Promise<AccountObservation> {
  const authBytes = await readPrivateRegularFile(authPath, "Codex auth file", AUTH_FILE_MAX_BYTES);
  if (authBytes === null) {
    return { accountFingerprint: null, authMode: "missing", planStatus: "unavailable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(authBytes.toString("utf8")) as unknown;
  } catch {
    return { accountFingerprint: null, authMode: "invalid", planStatus: "unavailable" };
  }
  return observeParsedAuth(parsed, secret);
}

async function readLedger(ledgerPath: string): Promise<AccountLedger | null> {
  const bytes = await readPrivateRegularFile(ledgerPath, "Account observation ledger", LEDGER_FILE_MAX_BYTES);
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new RecorderFailure("Account observation ledger is invalid JSON.");
  }
  const ledger = parseLedger(parsed);
  if (ledger === null) throw new RecorderFailure("Account observation ledger is invalid.");
  return ledger;
}

function updateLedger(
  current: AccountLedger,
  observation: AccountObservation,
  observedAt: string,
): Readonly<{ changed: boolean; ledger: AccountLedger }> {
  if (observedAt < current.updatedAt) {
    throw new RecorderFailure("System clock moved behind the account observation ledger.");
  }
  const accounts = current.accounts.map(account => ({ ...account }));
  if (observation.accountFingerprint !== null) {
    const existing = accounts.find(account => account.fingerprint === observation.accountFingerprint);
    if (existing === undefined) {
      if (accounts.length >= MAX_ACCOUNTS) {
        throw new RecorderFailure("Account observation ledger reached its account limit.");
      }
      accounts.push({
        fingerprint: observation.accountFingerprint,
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
      });
    } else {
      existing.lastObservedAt = observedAt;
    }
  }

  const intervals = current.intervals.map(interval => ({ ...interval }));
  const latest = intervals.at(-1);
  const changed = latest === undefined
    || latest.accountFingerprint !== observation.accountFingerprint
    || latest.authMode !== observation.authMode
    || latest.planStatus !== observation.planStatus;
  const missedCoverage = latest !== undefined
    && Date.parse(observedAt) - Date.parse(latest.lastObservedAt)
      > MAX_CONTIGUOUS_OBSERVATION_GAP_MS;
  if (changed || missedCoverage) {
    if (intervals.length >= MAX_INTERVALS) {
      throw new RecorderFailure("Account observation ledger reached its interval limit.");
    }
    intervals.push({
      accountFingerprint: observation.accountFingerprint,
      authMode: observation.authMode,
      planStatus: observation.planStatus,
      startedAt: observedAt,
      lastObservedAt: observedAt,
    });
  } else {
    latest.lastObservedAt = observedAt;
  }
  return {
    changed,
    ledger: {
      version: 1,
      keyId: current.keyId,
      createdAt: current.createdAt,
      updatedAt: observedAt,
      accounts,
      intervals,
    },
  };
}

async function atomicWriteLedger(ledgerPath: string, ledger: AccountLedger): Promise<void> {
  const directory = path.dirname(ledgerPath);
  const candidatePath = path.join(
    directory,
    `.account-observations.${process.pid}.${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > LEDGER_FILE_MAX_BYTES) {
    throw new RecorderFailure("Account observation ledger reached its serialized size limit.");
  }
  let candidate;
  try {
    candidate = await open(candidatePath, "wx", 0o600);
    await candidate.writeFile(serialized, "utf8");
    await candidate.chmod(0o600);
    await candidate.sync();
    await candidate.close();
    candidate = undefined;
    await rename(candidatePath, ledgerPath);
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    if (candidate !== undefined) await candidate.close().catch(() => undefined);
    await unlink(candidatePath).catch(() => undefined);
    throw new RecorderFailure("Unable to write account observation ledger atomically.");
  }
}

function isLockOwner(value: unknown): value is LockOwner {
  return isRecord(value) && hasExactlyKeys(value, ["acquiredAt", "nonce", "pid"])
    && isIsoTimestamp(value.acquiredAt)
    && typeof value.nonce === "string" && /^[A-Za-z0-9_-]{22}$/.test(value.nonce)
    && typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === "EPERM";
  }
}

async function clearStaleLock(lockPath: string): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(lockPath);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return true;
    throw new RecorderFailure("Unable to inspect account recorder lock.");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new RecorderFailure("Account recorder lock path is unsafe.");
  }
  const ownerPath = path.join(lockPath, "owner.json");
  let owner: LockOwner | null = null;
  try {
    const parsed = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
    owner = isLockOwner(parsed) ? parsed : null;
  } catch {
    owner = null;
  }
  const oldEnough = Date.now() - metadata.mtimeMs >= LOCK_STALE_AFTER_MS;
  if ((owner !== null && processIsAlive(owner.pid)) || (owner === null && !oldEnough)) {
    return false;
  }
  try {
    await unlink(ownerPath).catch(error => {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    });
    await rmdir(lockPath);
    return true;
  } catch (error) {
    if (isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTEMPTY")) return false;
    throw new RecorderFailure("Unable to recover stale account recorder lock.");
  }
}

export async function acquireRecorderLock(
  lockPath: string,
  acquiredAt: string,
): Promise<null | (() => Promise<void>)> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if (!isRecord(error) || error.code !== "EEXIST") {
        throw new RecorderFailure("Unable to create account recorder lock.");
      }
      if (!await clearStaleLock(lockPath)) return null;
      continue;
    }
    const nonce = randomBytes(16).toString("base64url");
    const owner: LockOwner = { acquiredAt, nonce, pid: process.pid };
    const ownerPath = path.join(lockPath, "owner.json");
    try {
      const ownerFile = await open(ownerPath, "wx", 0o600);
      try {
        await ownerFile.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
        await ownerFile.sync();
      } finally {
        await ownerFile.close();
      }
    } catch {
      await unlink(ownerPath).catch(() => undefined);
      await rmdir(lockPath).catch(() => undefined);
      throw new RecorderFailure("Unable to initialize account recorder lock.");
    }
    return async () => {
      let stillOwned = false;
      try {
        const parsed = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
        stillOwned = isLockOwner(parsed) && parsed.nonce === nonce && parsed.pid === process.pid;
      } catch {
        stillOwned = false;
      }
      if (!stillOwned) return;
      await unlink(ownerPath).catch(() => undefined);
      await rmdir(lockPath).catch(() => undefined);
    };
  }
  return null;
}

export function recorderPaths(environment: NodeJS.ProcessEnv): RecorderPaths {
  const home = environment.HOME;
  if (typeof home !== "string" || home.length === 0 || !path.isAbsolute(home)) {
    throw new RecorderFailure("HOME must be an absolute path.", 64);
  }
  const stateBase = typeof environment.XDG_STATE_HOME === "string"
    && environment.XDG_STATE_HOME.length > 0
    ? environment.XDG_STATE_HOME
    : path.join(home, ".local", "state");
  if (!path.isAbsolute(stateBase)) {
    throw new RecorderFailure("XDG_STATE_HOME must be an absolute path.", 64);
  }
  const stateRoot = path.join(stateBase, "aicharts", "gpt-subsidy");
  return {
    auth: path.join(home, ".codex", "auth.json"),
    ledger: path.join(stateRoot, "account-observations.json"),
    lock: path.join(stateRoot, ".account-recorder.lock"),
    rateLimits: path.join(stateRoot, "codex-rate-limit-observations.json"),
    secret: path.join(stateRoot, "account-hmac.key"),
    stateRoot,
  };
}

export async function recordCodexAccount(
  environment: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
  rateLimitReader?: CodexRateLimitReader,
): Promise<RecorderResult> {
  const observedAt = now.toISOString();
  const paths = recorderPaths(environment);
  await ensurePrivateStateDirectory(paths.stateRoot);
  const releaseLock = await acquireRecorderLock(paths.lock, observedAt);
  if (releaseLock === null) return { kind: "busy", observedAt };
  try {
    const existingLedger = await readLedger(paths.ledger);
    const secret = await readOrCreateSecret(paths.secret, existingLedger === null);
    if (existingLedger !== null && existingLedger.keyId !== secret.keyId) {
      throw new RecorderFailure("Account HMAC secret does not match the observation ledger.");
    }
    const observation = await readAuthObservation(paths.auth, secret.secret);
    const current: AccountLedger = existingLedger ?? {
      version: 1,
      keyId: secret.keyId,
      createdAt: observedAt,
      updatedAt: observedAt,
      accounts: [],
      intervals: [],
    };
    const update = updateLedger(current, observation, observedAt);
    await atomicWriteLedger(paths.ledger, update.ledger);
    let rateLimits: CodexRateLimitRecorderResult;
    try {
      let confirmedRead: CodexRateLimitReadResult | null = null;
      if (observation.accountFingerprint !== null) {
        confirmedRead = await (rateLimitReader ?? readCodexRateLimits)(environment);
        const confirmation = await readAuthObservation(paths.auth, secret.secret);
        if (confirmation.accountFingerprint !== observation.accountFingerprint
          || confirmation.authMode !== observation.authMode
          || confirmation.planStatus !== observation.planStatus) {
          throw new RecorderFailure(
            "Codex account changed during the rate-limit observation.",
          );
        }
      }
      rateLimits = await recordCodexRateLimits({
        accountFingerprint: observation.accountFingerprint,
        environment,
        keyId: secret.keyId,
        ledgerPath: paths.rateLimits,
        observedAt,
        reader: confirmedRead === null ? rateLimitReader : async () => confirmedRead!,
      });
    } catch (error) {
      if (error instanceof CodexRateLimitRecorderFailure) {
        throw new RecorderFailure(error.message, error.exitCode);
      }
      throw error;
    }
    return {
      kind: "recorded",
      observedAt,
      changed: update.changed,
      observedAccountFingerprintCount: update.ledger.accounts.length,
      authMode: observation.authMode,
      planStatus: observation.planStatus,
      rateLimits,
    };
  } finally {
    await releaseLock();
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    process.stderr.write("Usage: aicharts-record-codex-account\n");
    process.exitCode = 64;
    return;
  }
  try {
    const result = await recordCodexAccount();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.kind === "busy") process.exitCode = 75;
  } catch (error) {
    const failure = error instanceof RecorderFailure
      ? error
      : new RecorderFailure("Account recorder failed safely.");
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = failure.exitCode;
  }
}

if (import.meta.main) await main();
