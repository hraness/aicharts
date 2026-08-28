import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";

const APP_SERVER_RESPONSE_MAX_BYTES = 1_048_576;
const APP_SERVER_TIMEOUT_MS = 15_000;
const APP_SERVER_TERMINATION_GRACE_MS = 1_000;
const APP_SERVER_KILL_GRACE_MS = 1_000;
const LEDGER_FILE_MAX_BYTES = 32 * 1_048_576;
const LEGACY_SINGLE_BUCKET_LIMIT_ID = "codex";
const MAX_BUCKETS = 32;
const MAX_OBSERVATIONS = 200_000;
const MAX_RESETS = 200_000;
const MAX_RESET_CREDITS = 10_000;
const MAX_WINDOW_DURATION_MINS = 10 * 366 * 24 * 60;

const planTypes = [
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "team",
  "self_serve_business_prolite",
  "self_serve_business_usage_based",
  "business",
  "ent26",
  "enterprise_cbp_automation",
  "enterprise_cbp_usage_based",
  "enterprise",
  "edu",
  "edu_plus",
  "edu_pro",
  "unknown",
] as const;

const externalAuthEnvironmentKeys = [
  "CODEX_ACCESS_TOKEN",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_FEDERATION_RULE_ID",
  "OPENAI_IDENTITY_TOKEN_FILE",
  "OPENAI_WORKLOAD_IDENTITY_CONTEXT",
] as const;

const resetClassifications = [
  "provider-unscheduled",
  "reset-credit-correlated",
  "scheduled",
] as const;

const windowKinds = ["primary", "secondary"] as const;

type CodexPlanType = typeof planTypes[number];
type ResetClassification = typeof resetClassifications[number];
type WindowKind = typeof windowKinds[number];

export type CodexRateLimitWindow = Readonly<{
  resetsAt: number | null;
  usedPercent: number;
  windowDurationMins: number | null;
}>;

export type CodexRateLimitBucket = Readonly<{
  limitId: string;
  planType: CodexPlanType | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
}>;

export type CodexRateLimitReadResult = Readonly<{
  availableResetCreditCount: number | null;
  buckets: readonly CodexRateLimitBucket[];
}>;

export type TimedCodexRateLimitReadResult = Readonly<{
  observedAt: string;
  snapshot: CodexRateLimitReadResult;
}>;

export type CodexRateLimitAuthContext = Readonly<{
  codexHome: string;
}>;

type RateLimitObservation = {
  accountFingerprint: string;
  availableResetCreditCount: number | null;
  buckets: CodexRateLimitBucket[];
  lastObservedAt: string;
  startedAt: string;
};

type RateLimitReset = {
  accountFingerprint: string;
  availableResetCreditCountAfter: number | null;
  availableResetCreditCountBefore: number | null;
  classification: ResetClassification;
  currentResetAt: number;
  currentUsedPercent: number;
  detectedAt: string;
  freshCapacityPercent: 100;
  limitId: string;
  previousObservedAt: string;
  previousResetAt: number;
  previousUsedPercent: number;
  restoredPercentLowerBound: number;
  windowDurationMins: number;
  windowKind: WindowKind;
};

type RateLimitLedger = {
  createdAt: string;
  keyId: string;
  observations: RateLimitObservation[];
  resets: RateLimitReset[];
  updatedAt: string;
  version: 1;
};

export type DetectedRateLimitReset = Readonly<{
  classification: ResetClassification;
  currentUsedPercent: number;
  freshCapacityPercent: 100;
  previousUsedPercent: number;
  restoredPercentLowerBound: number;
  windowDurationMins: number;
}>;

export type CodexRateLimitRecorderResult = Readonly<{
  kind: "not-applicable";
}> | Readonly<{
  availableResetCreditCount: number | null;
  bucketCount: number;
  detectedResets: readonly DetectedRateLimitReset[];
  kind: "recorded";
  windowCount: number;
}>;

export type CodexRateLimitReader = (
  environment: NodeJS.ProcessEnv,
  authContext: CodexRateLimitAuthContext,
) => Promise<TimedCodexRateLimitReadResult>;

type CodexRateLimitReaderOptions = Readonly<{
  killGraceMs?: number;
  now?: () => Date;
  terminationGraceMs?: number;
  timeoutMs?: number;
}>;

export class CodexRateLimitRecorderFailure extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 65) {
    super(message);
    this.name = "CodexRateLimitRecorderFailure";
    this.exitCode = exitCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string"
    && /^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/.test(value);
}

function isKeyId(value: unknown): value is string {
  return typeof value === "string"
    && /^sha256:v1:[A-Za-z0-9_-]{43}$/.test(value);
}

function isPlanType(value: unknown): value is CodexPlanType {
  return typeof value === "string" && (planTypes as readonly string[]).includes(value);
}

function isLimitId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isResetCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= MAX_RESET_CREDITS;
}

function isUnixTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseWindow(value: unknown): CodexRateLimitWindow | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactlyKeys(value, [
    "resetsAt",
    "usedPercent",
    "windowDurationMins",
  ]) || typeof value.usedPercent !== "number" || !Number.isInteger(value.usedPercent)
    || value.usedPercent < 0 || value.usedPercent > 100
    || (value.resetsAt !== null && !isUnixTimestamp(value.resetsAt))
    || (value.windowDurationMins !== null
      && (typeof value.windowDurationMins !== "number"
        || !Number.isSafeInteger(value.windowDurationMins)
        || value.windowDurationMins <= 0
        || value.windowDurationMins > MAX_WINDOW_DURATION_MINS))) return undefined;
  return {
    resetsAt: value.resetsAt as number | null,
    usedPercent: value.usedPercent,
    windowDurationMins: value.windowDurationMins as number | null,
  };
}

function parseBucket(
  value: unknown,
  mapLimitId: string | null,
  fallbackLimitId: string | null = null,
): CodexRateLimitBucket | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "credits",
    "individualLimit",
    "limitId",
    "limitName",
    "planType",
    "primary",
    "rateLimitReachedType",
    "secondary",
    "spendControlReached",
  ])) return null;
  const protocolLimitId = value.limitId ?? null;
  if (protocolLimitId !== null && !isLimitId(protocolLimitId)) return null;
  if (mapLimitId !== null && protocolLimitId !== null && protocolLimitId !== mapLimitId) {
    return null;
  }
  const limitId = mapLimitId ?? protocolLimitId ?? fallbackLimitId;
  if (!isLimitId(limitId)) return null;
  const planType = value.planType ?? null;
  if (planType !== null && !isPlanType(planType)) return null;
  if (value.spendControlReached !== undefined && value.spendControlReached !== null
    && typeof value.spendControlReached !== "boolean") return null;
  const primary = parseWindow(value.primary ?? null);
  const secondary = parseWindow(value.secondary ?? null);
  if (primary === undefined || secondary === undefined) return null;
  return { limitId, planType, primary, secondary };
}

/**
 * Reduces the app-server response to the bounded fields retained by AI Charts.
 * Opaque reset-credit IDs and backend display strings are never returned.
 */
export function parseCodexRateLimitResponse(value: unknown): CodexRateLimitReadResult {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "rateLimitResetCredits",
    "rateLimits",
    "rateLimitsByLimitId",
  ]) || !("rateLimits" in value)) {
    throw new CodexRateLimitRecorderFailure(
      "Codex rate-limit response failed its privacy/shape check.",
    );
  }

  let availableResetCreditCount: number | null = null;
  if (value.rateLimitResetCredits !== undefined && value.rateLimitResetCredits !== null) {
    const summary = value.rateLimitResetCredits;
    if (!isRecord(summary) || !hasOnlyKeys(summary, ["availableCount", "credits"])
      || !isResetCount(summary.availableCount)
      || (summary.credits !== undefined && summary.credits !== null
        && (!Array.isArray(summary.credits)
          || summary.credits.length > MAX_RESET_CREDITS))) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit response failed its privacy/shape check.",
      );
    }
    availableResetCreditCount = summary.availableCount;
  }

  const buckets: CodexRateLimitBucket[] = [];
  const byLimitId = value.rateLimitsByLimitId;
  if (byLimitId !== undefined && byLimitId !== null) {
    if (!isRecord(byLimitId) || Object.keys(byLimitId).length > MAX_BUCKETS) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit response failed its privacy/shape check.",
      );
    }
    for (const [limitId, candidate] of Object.entries(byLimitId)) {
      if (!isLimitId(limitId)) {
        throw new CodexRateLimitRecorderFailure(
          "Codex rate-limit response failed its privacy/shape check.",
        );
      }
      const bucket = parseBucket(candidate, limitId);
      if (bucket === null) {
        throw new CodexRateLimitRecorderFailure(
          "Codex rate-limit response failed its privacy/shape check.",
        );
      }
      buckets.push(bucket);
    }
  } else {
    const fallback = parseBucket(
      value.rateLimits,
      null,
      LEGACY_SINGLE_BUCKET_LIMIT_ID,
    );
    if (fallback === null) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit response failed its privacy/shape check.",
      );
    }
    buckets.push(fallback);
  }

  buckets.sort((left, right) => compareCodeUnits(left.limitId, right.limitId));
  if (buckets.length === 0
    || buckets.some((bucket, index) => index > 0
      && bucket.limitId === buckets[index - 1]!.limitId)) {
    throw new CodexRateLimitRecorderFailure(
      "Codex rate-limit response failed its privacy/shape check.",
    );
  }
  return { availableResetCreditCount, buckets };
}

function writeJsonLine(
  child: ReturnType<typeof spawn>,
  value: Readonly<Record<string, unknown>>,
): void {
  const stdin = child.stdin;
  if (stdin === null || stdin.destroyed) {
    throw new CodexRateLimitRecorderFailure("Codex rate-limit reader exited early.", 69);
  }
  stdin.write(`${JSON.stringify(value)}\n`, "utf8");
}

function boundedReaderDelay(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 60_000) {
    throw new CodexRateLimitRecorderFailure(
      "Codex rate-limit reader timing configuration is invalid.",
      64,
    );
  }
  return value;
}

function childHasExited(child: ReturnType<typeof spawn>): boolean {
  return child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildClose(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> {
  if (childHasExited(child)) return true;
  return await new Promise<boolean>(resolve => {
    let completed = false;
    const complete = (closed: boolean): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      child.removeListener("close", onClose);
      resolve(closed);
    };
    const onClose = (): void => complete(true);
    const timeout = setTimeout(() => complete(childHasExited(child)), timeoutMs);
    child.once("close", onClose);
    if (childHasExited(child)) complete(true);
  });
}

async function terminateChild(
  child: ReturnType<typeof spawn>,
  terminationGraceMs: number,
  killGraceMs: number,
): Promise<boolean> {
  child.stdin?.end();
  if (childHasExited(child)) return true;
  try {
    child.kill("SIGTERM");
  } catch {
    // A concurrent exit is confirmed by the bounded close wait below.
  }
  if (await waitForChildClose(child, terminationGraceMs)) return true;
  try {
    child.kill("SIGKILL");
  } catch {
    // A concurrent exit is confirmed by the bounded close wait below.
  }
  return await waitForChildClose(child, killGraceMs);
}

function appServerEnvironment(
  environment: NodeJS.ProcessEnv,
  authContext: CodexRateLimitAuthContext,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    CODEX_HOME: authContext.codexHome,
  };
  for (const key of externalAuthEnvironmentKeys) delete childEnvironment[key];
  return childEnvironment;
}

function requirementsPermitFileAuth(value: unknown): boolean {
  if (!isRecord(value) || !("requirements" in value)) return false;
  if (value.requirements === null) return true;
  if (!isRecord(value.requirements)) return false;
  const configured = value.requirements.cliAuthCredentialsStore;
  // Older supported app servers predate this requirement field. Their managed
  // requirements cannot override the CLI credential-store selection.
  return configured === undefined || configured === null || configured === "file";
}

export async function readCodexRateLimits(
  environment: NodeJS.ProcessEnv = process.env,
  authContext: CodexRateLimitAuthContext = {
    codexHome: path.join(environment.HOME ?? "", ".codex"),
  },
  options: CodexRateLimitReaderOptions = {},
): Promise<TimedCodexRateLimitReadResult> {
  const executable = environment.AICHARTS_CODEX_APP_SERVER_EXECUTABLE;
  if (typeof executable !== "string" || !path.isAbsolute(executable)) {
    throw new CodexRateLimitRecorderFailure(
      "Codex rate-limit reader executable is unavailable.",
      69,
    );
  }
  if (!path.isAbsolute(authContext.codexHome)) {
    throw new CodexRateLimitRecorderFailure(
      "Codex rate-limit auth context is invalid.",
      64,
    );
  }
  const timeoutMs = boundedReaderDelay(options.timeoutMs, APP_SERVER_TIMEOUT_MS);
  const terminationGraceMs = boundedReaderDelay(
    options.terminationGraceMs,
    APP_SERVER_TERMINATION_GRACE_MS,
  );
  const killGraceMs = boundedReaderDelay(options.killGraceMs, APP_SERVER_KILL_GRACE_MS);

  return await new Promise<TimedCodexRateLimitReadResult>((resolve, reject) => {
    const child = spawn(executable, [
      "-c",
      'cli_auth_credentials_store="file"',
      "app-server",
      "--stdio",
    ], {
      env: appServerEnvironment(environment, authContext),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let finishing = false;
    let initialized = false;
    let requirementsChecked = false;
    let buffered = "";
    let receivedBytes = 0;
    let stderrBytes = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      error: CodexRateLimitRecorderFailure | null,
      result?: TimedCodexRateLimitReadResult,
    ): void => {
      if (finishing) return;
      finishing = true;
      if (timeout !== undefined) clearTimeout(timeout);
      void terminateChild(child, terminationGraceMs, killGraceMs).then(
        reaped => {
          if (!reaped) {
            reject(new CodexRateLimitRecorderFailure(
              "Codex rate-limit reader could not terminate its app-server process.",
              69,
            ));
          } else if (error !== null) {
            reject(error);
          } else {
            resolve(result!);
          }
        },
        () => reject(new CodexRateLimitRecorderFailure(
          "Codex rate-limit reader could not terminate its app-server process.",
          69,
        )),
      );
    };

    timeout = setTimeout(() => {
      finish(new CodexRateLimitRecorderFailure("Codex rate-limit reader timed out.", 69));
    }, timeoutMs);

    child.once("error", () => {
      finish(new CodexRateLimitRecorderFailure("Unable to start Codex rate-limit reader.", 69));
    });
    child.once("close", () => {
      if (!finishing) {
        finish(new CodexRateLimitRecorderFailure("Codex rate-limit reader exited early.", 69));
      }
    });
    child.stderr.on("data", chunk => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > APP_SERVER_RESPONSE_MAX_BYTES) {
        finish(new CodexRateLimitRecorderFailure("Codex rate-limit reader exceeded its size limit."));
      }
    });
    child.stdout.on("data", chunk => {
      if (finishing) return;
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > APP_SERVER_RESPONSE_MAX_BYTES) {
        finish(new CodexRateLimitRecorderFailure("Codex rate-limit reader exceeded its size limit."));
        return;
      }
      buffered += chunk.toString("utf8");
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line.length === 0) continue;
        let message: unknown;
        try {
          message = JSON.parse(line) as unknown;
        } catch {
          finish(new CodexRateLimitRecorderFailure(
            "Codex rate-limit response failed its privacy/shape check.",
          ));
          return;
        }
        if (!isRecord(message)) continue;
        if (message.id === 1 && !initialized) {
          if (!("result" in message) || "error" in message) {
            finish(new CodexRateLimitRecorderFailure("Codex rate-limit reader initialization failed.", 69));
            return;
          }
          initialized = true;
          try {
            writeJsonLine(child, { method: "initialized" });
            writeJsonLine(child, { id: 2, method: "configRequirements/read" });
          } catch (error) {
            finish(error instanceof CodexRateLimitRecorderFailure
              ? error
              : new CodexRateLimitRecorderFailure("Codex rate-limit reader exited early.", 69));
          }
          continue;
        }
        if (message.id === 2 && !requirementsChecked) {
          if (!("result" in message) || "error" in message
            || !requirementsPermitFileAuth(message.result)) {
            finish(new CodexRateLimitRecorderFailure(
              "Codex rate-limit auth context could not be attested as file-backed.",
              69,
            ));
            return;
          }
          requirementsChecked = true;
          try {
            writeJsonLine(child, { id: 3, method: "account/rateLimits/read" });
          } catch (error) {
            finish(error instanceof CodexRateLimitRecorderFailure
              ? error
              : new CodexRateLimitRecorderFailure("Codex rate-limit reader exited early.", 69));
          }
          continue;
        }
        if (message.id === 3 && requirementsChecked) {
          if (!("result" in message) || "error" in message) {
            finish(new CodexRateLimitRecorderFailure("Codex rate-limit read failed.", 69));
            return;
          }
          try {
            const snapshot = parseCodexRateLimitResponse(message.result);
            const observedAt = (options.now?.() ?? new Date()).toISOString();
            finish(null, { observedAt, snapshot });
          } catch (error) {
            finish(error instanceof CodexRateLimitRecorderFailure
              ? error
              : new CodexRateLimitRecorderFailure(
                "Codex rate-limit response failed its privacy/shape check.",
              ));
          }
          return;
        }
      }
    });

    try {
      writeJsonLine(child, {
        id: 1,
        method: "initialize",
        params: {
          capabilities: { experimentalApi: true },
          clientInfo: { name: "aicharts-rate-limit-recorder", version: "1.0.0" },
        },
      });
    } catch (error) {
      finish(error instanceof CodexRateLimitRecorderFailure
        ? error
        : new CodexRateLimitRecorderFailure("Codex rate-limit reader exited early.", 69));
    }
  });
}

function parseLedgerBucket(value: unknown): CodexRateLimitBucket | null {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    "limitId",
    "planType",
    "primary",
    "secondary",
  ])) return null;
  return parseBucket(value, null);
}

function parseObservation(value: unknown, createdAt: string, updatedAt: string): RateLimitObservation | null {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    "accountFingerprint",
    "availableResetCreditCount",
    "buckets",
    "lastObservedAt",
    "startedAt",
  ]) || !isFingerprint(value.accountFingerprint)
    || (value.availableResetCreditCount !== null
      && !isResetCount(value.availableResetCreditCount))
    || !Array.isArray(value.buckets) || value.buckets.length === 0
    || value.buckets.length > MAX_BUCKETS || !isIsoTimestamp(value.startedAt)
    || !isIsoTimestamp(value.lastObservedAt) || value.startedAt > value.lastObservedAt
    || value.startedAt < createdAt || value.lastObservedAt > updatedAt) return null;
  const buckets: CodexRateLimitBucket[] = [];
  for (const candidate of value.buckets) {
    const bucket = parseLedgerBucket(candidate);
    if (bucket === null) return null;
    buckets.push(bucket);
  }
  if (buckets.some((bucket, index) => index > 0
    && compareCodeUnits(bucket.limitId, buckets[index - 1]!.limitId) <= 0)) return null;
  return {
    accountFingerprint: value.accountFingerprint,
    availableResetCreditCount: value.availableResetCreditCount as number | null,
    buckets,
    lastObservedAt: value.lastObservedAt,
    startedAt: value.startedAt,
  };
}

function parseReset(value: unknown, createdAt: string, updatedAt: string): RateLimitReset | null {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    "accountFingerprint",
    "availableResetCreditCountAfter",
    "availableResetCreditCountBefore",
    "classification",
    "currentResetAt",
    "currentUsedPercent",
    "detectedAt",
    "freshCapacityPercent",
    "limitId",
    "previousObservedAt",
    "previousResetAt",
    "previousUsedPercent",
    "restoredPercentLowerBound",
    "windowDurationMins",
    "windowKind",
  ]) || !isFingerprint(value.accountFingerprint) || !isLimitId(value.limitId)
    || typeof value.classification !== "string"
    || !(resetClassifications as readonly string[]).includes(value.classification)
    || typeof value.windowKind !== "string"
    || !(windowKinds as readonly string[]).includes(value.windowKind)
    || !isIsoTimestamp(value.detectedAt) || !isIsoTimestamp(value.previousObservedAt)
    || value.detectedAt < createdAt || value.detectedAt > updatedAt
    || value.previousObservedAt > value.detectedAt
    || !isUnixTimestamp(value.previousResetAt) || !isUnixTimestamp(value.currentResetAt)
    || value.currentResetAt <= value.previousResetAt
    || typeof value.windowDurationMins !== "number"
    || !Number.isSafeInteger(value.windowDurationMins) || value.windowDurationMins <= 0
    || value.windowDurationMins > MAX_WINDOW_DURATION_MINS
    || typeof value.previousUsedPercent !== "number"
    || !Number.isInteger(value.previousUsedPercent) || value.previousUsedPercent < 0
    || value.previousUsedPercent > 100 || typeof value.currentUsedPercent !== "number"
    || !Number.isInteger(value.currentUsedPercent) || value.currentUsedPercent < 0
    || value.currentUsedPercent > 100
    || value.restoredPercentLowerBound !== value.previousUsedPercent
    || value.freshCapacityPercent !== 100
    || (value.availableResetCreditCountBefore !== null
      && !isResetCount(value.availableResetCreditCountBefore))
    || (value.availableResetCreditCountAfter !== null
      && !isResetCount(value.availableResetCreditCountAfter))) return null;
  return value as RateLimitReset;
}

function parseLedger(value: unknown): RateLimitLedger | null {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    "createdAt",
    "keyId",
    "observations",
    "resets",
    "updatedAt",
    "version",
  ]) || value.version !== 1 || !isKeyId(value.keyId)
    || !isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)
    || value.createdAt > value.updatedAt || !Array.isArray(value.observations)
    || value.observations.length > MAX_OBSERVATIONS || !Array.isArray(value.resets)
    || value.resets.length > MAX_RESETS) return null;
  const observations: RateLimitObservation[] = [];
  for (const candidate of value.observations) {
    const observation = parseObservation(candidate, value.createdAt, value.updatedAt);
    if (observation === null) return null;
    if (observations.length > 0
      && observation.startedAt < observations.at(-1)!.lastObservedAt) return null;
    observations.push(observation);
  }
  const resets: RateLimitReset[] = [];
  for (const candidate of value.resets) {
    const reset = parseReset(candidate, value.createdAt, value.updatedAt);
    if (reset === null || (resets.length > 0
      && reset.detectedAt < resets.at(-1)!.detectedAt)) return null;
    resets.push(reset);
  }
  return {
    createdAt: value.createdAt,
    keyId: value.keyId,
    observations,
    resets,
    updatedAt: value.updatedAt,
    version: 1,
  };
}

async function readPrivateLedger(ledgerPath: string): Promise<RateLimitLedger | null> {
  let file;
  try {
    file = await open(ledgerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    if (isRecord(error) && error.code === "ELOOP") {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger must not be a symbolic link.",
      );
    }
    throw new CodexRateLimitRecorderFailure(
      "Unable to open Codex rate-limit observation ledger.",
    );
  }
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger must be a regular file.",
      );
    }
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger is not owned by the current user.",
      );
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger permissions are too broad; mode 0600 is required.",
      );
    }
    if (metadata.size > LEDGER_FILE_MAX_BYTES) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger exceeds its safe size limit.",
      );
    }
    const bytes = await file.readFile();
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger is invalid JSON.",
      );
    }
    const ledger = parseLedger(parsed);
    if (ledger === null) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger is invalid.",
      );
    }
    return ledger;
  } finally {
    await file.close();
  }
}

function sameWindow(
  left: CodexRateLimitWindow | null,
  right: CodexRateLimitWindow | null,
): boolean {
  return left === null ? right === null : right !== null
    && left.resetsAt === right.resetsAt
    && left.usedPercent === right.usedPercent
    && left.windowDurationMins === right.windowDurationMins;
}

function sameBuckets(
  left: readonly CodexRateLimitBucket[],
  right: readonly CodexRateLimitBucket[],
): boolean {
  return left.length === right.length && left.every((bucket, index) => {
    const candidate = right[index]!;
    return bucket.limitId === candidate.limitId && bucket.planType === candidate.planType
      && sameWindow(bucket.primary, candidate.primary)
      && sameWindow(bucket.secondary, candidate.secondary);
  });
}

function classifyReset(
  previous: CodexRateLimitWindow,
  current: CodexRateLimitWindow,
  observedAt: string,
  creditCountBefore: number | null,
  creditCountAfter: number | null,
): ResetClassification | null {
  if (previous.resetsAt === null || current.resetsAt === null
    || current.resetsAt <= previous.resetsAt
    || previous.windowDurationMins === null
    || current.windowDurationMins !== previous.windowDurationMins) return null;
  const observedAtSeconds = Math.floor(Date.parse(observedAt) / 1_000);
  if (observedAtSeconds >= previous.resetsAt) return "scheduled";
  const creditCountDropped = creditCountBefore !== null && creditCountAfter !== null
    && creditCountAfter < creditCountBefore;
  if (creditCountDropped) return "reset-credit-correlated";
  if (current.usedPercent < previous.usedPercent) return "provider-unscheduled";
  return null;
}

function detectResets(
  previous: RateLimitObservation | undefined,
  current: RateLimitObservation,
): RateLimitReset[] {
  if (previous === undefined) return [];
  const detected: RateLimitReset[] = [];
  for (const bucket of current.buckets) {
    const priorBucket = previous.buckets.find(candidate => candidate.limitId === bucket.limitId);
    if (priorBucket === undefined || priorBucket.planType !== bucket.planType) continue;
    for (const windowKind of windowKinds) {
      const priorWindow = priorBucket[windowKind];
      const currentWindow = bucket[windowKind];
      if (priorWindow === null || currentWindow === null) continue;
      const classification = classifyReset(
        priorWindow,
        currentWindow,
        current.startedAt,
        previous.availableResetCreditCount,
        current.availableResetCreditCount,
      );
      if (classification === null || priorWindow.resetsAt === null
        || currentWindow.resetsAt === null || priorWindow.windowDurationMins === null) continue;
      detected.push({
        accountFingerprint: current.accountFingerprint,
        availableResetCreditCountAfter: current.availableResetCreditCount,
        availableResetCreditCountBefore: previous.availableResetCreditCount,
        classification,
        currentResetAt: currentWindow.resetsAt,
        currentUsedPercent: currentWindow.usedPercent,
        detectedAt: current.startedAt,
        freshCapacityPercent: 100,
        limitId: bucket.limitId,
        previousObservedAt: previous.lastObservedAt,
        previousResetAt: priorWindow.resetsAt,
        previousUsedPercent: priorWindow.usedPercent,
        restoredPercentLowerBound: priorWindow.usedPercent,
        windowDurationMins: priorWindow.windowDurationMins,
        windowKind,
      });
    }
  }
  return detected;
}

export function updateCodexRateLimitLedger(
  current: RateLimitLedger | null,
  readResult: CodexRateLimitReadResult,
  accountFingerprint: string,
  keyId: string,
  observedAt: string,
): Readonly<{ detectedResets: readonly RateLimitReset[]; ledger: RateLimitLedger }> {
  if (!isFingerprint(accountFingerprint) || !isKeyId(keyId) || !isIsoTimestamp(observedAt)) {
    throw new CodexRateLimitRecorderFailure("Codex rate-limit observation input is invalid.");
  }
  if (current !== null && current.keyId !== keyId) {
    throw new CodexRateLimitRecorderFailure(
      "Account HMAC secret does not match the Codex rate-limit observation ledger.",
    );
  }
  if (current !== null && observedAt < current.updatedAt) {
    throw new CodexRateLimitRecorderFailure(
      "System clock moved behind the Codex rate-limit observation ledger.",
    );
  }
  const observations = current?.observations.map(observation => ({
    ...observation,
    buckets: observation.buckets.map(bucket => ({ ...bucket })),
  })) ?? [];
  const resets = current?.resets.map(reset => ({ ...reset })) ?? [];
  const observation: RateLimitObservation = {
    accountFingerprint,
    availableResetCreditCount: readResult.availableResetCreditCount,
    buckets: readResult.buckets.map(bucket => ({ ...bucket })),
    lastObservedAt: observedAt,
    startedAt: observedAt,
  };
  const previousForAccount = observations.findLast(
    candidate => candidate.accountFingerprint === accountFingerprint,
  );
  const detectedResets = detectResets(previousForAccount, observation);
  if (resets.length + detectedResets.length > MAX_RESETS) {
    throw new CodexRateLimitRecorderFailure(
      "Codex rate-limit observation ledger reached its reset limit.",
    );
  }
  resets.push(...detectedResets);

  const latest = observations.at(-1);
  if (latest !== undefined && latest.accountFingerprint === accountFingerprint
    && latest.availableResetCreditCount === observation.availableResetCreditCount
    && sameBuckets(latest.buckets, observation.buckets)) {
    latest.lastObservedAt = observedAt;
  } else {
    if (observations.length >= MAX_OBSERVATIONS) {
      throw new CodexRateLimitRecorderFailure(
        "Codex rate-limit observation ledger reached its observation limit.",
      );
    }
    observations.push(observation);
  }

  return {
    detectedResets,
    ledger: {
      createdAt: current?.createdAt ?? observedAt,
      keyId,
      observations,
      resets,
      updatedAt: observedAt,
      version: 1,
    },
  };
}

async function atomicWriteLedger(ledgerPath: string, ledger: RateLimitLedger): Promise<void> {
  const directory = path.dirname(ledgerPath);
  const candidatePath = path.join(
    directory,
    `.codex-rate-limit-observations.${process.pid}.${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > LEDGER_FILE_MAX_BYTES) {
    throw new CodexRateLimitRecorderFailure(
      "Codex rate-limit observation ledger reached its serialized size limit.",
    );
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
    throw new CodexRateLimitRecorderFailure(
      "Unable to write Codex rate-limit observation ledger atomically.",
    );
  }
}

function publicReset(reset: RateLimitReset): DetectedRateLimitReset {
  return {
    classification: reset.classification,
    currentUsedPercent: reset.currentUsedPercent,
    freshCapacityPercent: 100,
    previousUsedPercent: reset.previousUsedPercent,
    restoredPercentLowerBound: reset.restoredPercentLowerBound,
    windowDurationMins: reset.windowDurationMins,
  };
}

export async function recordCodexRateLimits(options: Readonly<{
  accountFingerprint: string | null;
  authContext: CodexRateLimitAuthContext;
  environment: NodeJS.ProcessEnv;
  keyId: string;
  ledgerPath: string;
  reader?: CodexRateLimitReader;
}>): Promise<CodexRateLimitRecorderResult> {
  if (options.accountFingerprint === null) return { kind: "not-applicable" };
  const read = await (options.reader ?? readCodexRateLimits)(
    options.environment,
    options.authContext,
  );
  const current = await readPrivateLedger(options.ledgerPath);
  const update = updateCodexRateLimitLedger(
    current,
    read.snapshot,
    options.accountFingerprint,
    options.keyId,
    read.observedAt,
  );
  await atomicWriteLedger(options.ledgerPath, update.ledger);
  return {
    availableResetCreditCount: read.snapshot.availableResetCreditCount,
    bucketCount: read.snapshot.buckets.length,
    detectedResets: update.detectedResets.map(publicReset),
    kind: "recorded",
    windowCount: read.snapshot.buckets.reduce(
      (count, bucket) => count + Number(bucket.primary !== null) + Number(bucket.secondary !== null),
      0,
    ),
  };
}
