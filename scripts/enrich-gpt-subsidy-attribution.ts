import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  assertGptSubsidyAttributionImplementation,
  attributionSha256,
  GPT_SUBSIDY_ATTRIBUTION_MANIFEST_URL,
  GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL,
  parseGptSubsidyAttributionManifest,
} from "../lib/gpt-subsidy-attribution-manifest";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const defaultDataPath = path.join(repositoryRoot, "data", "gpt-subsidy.json");
const defaultManifestPath = path.join(
  repositoryRoot,
  "data",
  "gpt-subsidy-attribution-measurement.json",
);
const defaultStateRoot = path.join(
  process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  "aicharts",
  "gpt-subsidy",
);
const defaultAccountLedgerPath = path.join(
  defaultStateRoot,
  "account-observations.json",
);
const defaultRateLimitLedgerPath = path.join(
  defaultStateRoot,
  "codex-rate-limit-observations.json",
);
const defaultAttributionContinuityPath = path.join(
  defaultStateRoot,
  "attribution-continuity.json",
);

const PRIVATE_FILE_MAX_BYTES = 32 * 1_048_576;
const MAX_ACCOUNTS = 50_000;
const MAX_INTERVALS = 200_000;
const MAX_BUCKETS = 32;
const MAX_RATE_LIMIT_OBSERVATIONS = 200_000;

const isoSchema = z.string().datetime({ offset: true }).refine(
  value => {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds)
      && new Date(milliseconds).toISOString() === value;
  },
  "Timestamp must be canonical UTC ISO-8601",
);
const fingerprintSchema = z.string().regex(
  /^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/u,
);
const keyIdSchema = z.string().regex(/^sha256:v1:[A-Za-z0-9_-]{43}$/u);
const planTypeSchema = z.enum([
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
]);

const accountEntrySchema = z.object({
  fingerprint: fingerprintSchema,
  firstObservedAt: isoSchema,
  lastObservedAt: isoSchema,
}).strict();

const accountIntervalSchema = z.object({
  accountFingerprint: fingerprintSchema.nullable(),
  authMode: z.enum(["api-key", "chatgpt", "missing", "invalid", "unknown"]),
  planStatus: z.enum([
    "not-applicable",
    "subscription-unverified",
    "unavailable",
  ]),
  startedAt: isoSchema,
  lastObservedAt: isoSchema,
}).strict();

const accountLedgerSchema = z.object({
  version: z.literal(1),
  keyId: keyIdSchema,
  createdAt: isoSchema,
  updatedAt: isoSchema,
  accounts: z.array(accountEntrySchema).max(MAX_ACCOUNTS),
  intervals: z.array(accountIntervalSchema).max(MAX_INTERVALS),
}).strict().superRefine((ledger, context) => {
  if (ledger.createdAt > ledger.updatedAt) {
    context.addIssue({
      code: "custom",
      message: "Account observation ledger chronology is invalid",
      path: ["updatedAt"],
    });
  }
  const fingerprints = new Set<string>();
  ledger.accounts.forEach((account, index) => {
    if (
      account.firstObservedAt > account.lastObservedAt
      || account.firstObservedAt < ledger.createdAt
      || account.lastObservedAt > ledger.updatedAt
      || fingerprints.has(account.fingerprint)
    ) {
      context.addIssue({
        code: "custom",
        message: "Account observation ledger chronology is invalid",
        path: ["accounts", index],
      });
    }
    fingerprints.add(account.fingerprint);
  });
  ledger.intervals.forEach((interval, index) => {
    if (
      interval.startedAt > interval.lastObservedAt
      || interval.startedAt < ledger.createdAt
      || interval.lastObservedAt > ledger.updatedAt
      || (
        interval.accountFingerprint !== null
        && !fingerprints.has(interval.accountFingerprint)
      )
      || (
        index > 0
        && interval.startedAt < ledger.intervals[index - 1]!.lastObservedAt
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Account observation interval chronology is invalid",
        path: ["intervals", index],
      });
    }
  });
});

const rateLimitWindowSchema = z.object({
  resetsAt: z.number().int().nonnegative().nullable(),
  usedPercent: z.number().int().min(0).max(100),
  windowDurationMins: z.number().int().positive().nullable(),
}).strict();

const rateLimitBucketSchema = z.object({
  limitId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  planType: planTypeSchema.nullable(),
  primary: rateLimitWindowSchema.nullable(),
  secondary: rateLimitWindowSchema.nullable(),
}).strict();

const rateLimitObservationSchema = z.object({
  accountFingerprint: fingerprintSchema,
  availableResetCreditCount: z.number().int().nonnegative().nullable(),
  buckets: z.array(rateLimitBucketSchema).min(1).max(MAX_BUCKETS),
  startedAt: isoSchema,
  lastObservedAt: isoSchema,
}).strict().superRefine((observation, context) => {
  observation.buckets.forEach((bucket, index) => {
    if (
      index > 0
      && bucket.limitId <= observation.buckets[index - 1]!.limitId
    ) {
      context.addIssue({
        code: "custom",
        message: "Rate-limit buckets must have unique canonical order",
        path: ["buckets", index, "limitId"],
      });
    }
  });
});

const rateLimitLedgerSchema = z.object({
  version: z.literal(1),
  keyId: keyIdSchema,
  createdAt: isoSchema,
  updatedAt: isoSchema,
  observations: z.array(rateLimitObservationSchema)
    .max(MAX_RATE_LIMIT_OBSERVATIONS),
  resets: z.array(z.unknown()).max(MAX_RATE_LIMIT_OBSERVATIONS),
}).strict().superRefine((ledger, context) => {
  if (ledger.createdAt > ledger.updatedAt) {
    context.addIssue({
      code: "custom",
      message: "Rate-limit observation ledger chronology is invalid",
      path: ["updatedAt"],
    });
  }
  ledger.observations.forEach((observation, index) => {
    if (
      observation.startedAt > observation.lastObservedAt
      || observation.startedAt < ledger.createdAt
      || observation.lastObservedAt > ledger.updatedAt
      || (
        index > 0
        && observation.startedAt
          < ledger.observations[index - 1]!.lastObservedAt
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Rate-limit observation chronology is invalid",
        path: ["observations", index],
      });
    }
  });
});

const privateContinuitySchema = z.object({
  version: z.literal(1),
  keyId: keyIdSchema,
  establishedAt: isoSchema,
  accountLedgerCreatedAt: isoSchema,
  rateLimitLedgerCreatedAt: isoSchema.nullable(),
  minimumAccountCount: z.number().int().nonnegative(),
  minimumAccountIntervalCount: z.number().int().nonnegative(),
  minimumRateLimitObservationCount: z.number().int().nonnegative().nullable(),
}).strict().superRefine((continuity, context) => {
  if (
    (continuity.rateLimitLedgerCreatedAt === null)
      !== (continuity.minimumRateLimitObservationCount === null)
  ) {
    context.addIssue({
      code: "custom",
      message: "Rate-limit continuity fields must become available together",
      path: ["rateLimitLedgerCreatedAt"],
    });
  }
});

const accountAttributionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unavailable"),
    distinctObservedAccounts: z.null(),
    coverage: z.literal(0),
  }).strict(),
  z.object({
    status: z.literal("partial"),
    distinctObservedAccounts: z.number().int().positive(),
    coverage: z.union([
      z.literal(GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL),
      z.number().finite().min(0.01).max(0.99).refine(
        value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
      ),
    ]),
  }).strict(),
]);

const observedProPlanComparisonSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unavailable"),
    distinctVerifiedProAccountsLowerBound: z.null(),
    normalizedPlanValueUsd: z.null(),
    apiEquivalentMultipleUpperBound: z.null(),
  }).strict(),
  z.object({
    status: z.literal("sampled"),
    distinctVerifiedProAccountsLowerBound: z.number().int().positive(),
    normalizedPlanValueUsd: z.number().finite().positive(),
    apiEquivalentMultipleUpperBound: z.number().finite().nonnegative(),
  }).strict(),
]);

const priorComparisonSchema = z.object({
  firstSampledAt: isoSchema.nullable(),
  accountAttribution: accountAttributionSchema,
  observedProPlanComparison: observedProPlanComparisonSchema,
}).passthrough();

const publicObservationSchema = z.object({
  id: z.string().min(1),
  periodStartedAt: isoSchema,
  periodEndsAt: isoSchema,
  accountAttribution: accountAttributionSchema,
  subscriptionAdjustedMultiple: z.null(),
}).passthrough();

const publicDataSchema = z.object({
  generatedAt: isoSchema,
  plan: z.object({
    monthlyPriceUsd: z.number().finite().positive(),
  }).passthrough(),
  periodSummary: z.object({
    startedAt: isoSchema,
    endedAt: isoSchema,
    apiEquivalentUsd: z.number().finite().nonnegative(),
  }).passthrough(),
  observations: z.array(publicObservationSchema),
  accountPlanComparison: priorComparisonSchema.optional(),
  methodology: z.object({
    sourceUrls: z.array(z.string().url()),
  }).passthrough(),
}).passthrough().superRefine((data, context) => {
  if (
    data.accountPlanComparison !== undefined
    && data.accountPlanComparison.firstSampledAt !== null
    && data.accountPlanComparison.accountAttribution.status === "unavailable"
    && data.observations.every(
      observation => observation.accountAttribution.status === "unavailable",
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "A sampled-attribution history marker requires retained sampled evidence",
      path: ["accountPlanComparison", "firstSampledAt"],
    });
  }
});

type AccountLedger = z.infer<typeof accountLedgerSchema>;
type RateLimitLedger = z.infer<typeof rateLimitLedgerSchema>;
type PublicData = z.infer<typeof publicDataSchema> & Record<string, unknown>;

export type PublicAccountAttribution =
  | Readonly<{
    status: "unavailable";
    distinctObservedAccounts: null;
    coverage: 0;
  }>
  | Readonly<{
    status: "partial";
    distinctObservedAccounts: number;
    coverage: number;
  }>;

export type PublicAccountPlanComparison = Readonly<{
  periodStartedAt: string;
  periodEndedAt: string;
  accountAttribution: PublicAccountAttribution;
  observedProPlanComparison:
    | Readonly<{
      status: "unavailable";
      distinctVerifiedProAccountsLowerBound: null;
      normalizedPlanValueUsd: null;
      apiEquivalentMultipleUpperBound: null;
    }>
    | Readonly<{
      status: "sampled";
      distinctVerifiedProAccountsLowerBound: number;
      normalizedPlanValueUsd: number;
      apiEquivalentMultipleUpperBound: number;
    }>;
  firstSampledAt: string | null;
  measurement: Readonly<{
    name: "AI Charts GPT subsidy account-attribution manifest";
    schemaVersion: 1;
    kind: "aicharts-gpt-subsidy-account-attribution";
    revision: string;
    sha256: string;
    frozenAt: string;
    sourceUrl: typeof GPT_SUBSIDY_ATTRIBUTION_MANIFEST_URL;
  }>;
}>;

type EnrichmentOptions = Readonly<{
  accountLedgerPath?: string;
  attributionManifestPath?: string;
  continuityPath?: string;
  dataPath?: string;
  rateLimitLedgerPath?: string;
  repositoryRoot?: string;
}>;

export type EnrichmentOutcome = Readonly<{
  kind: "unchanged" | "updated";
  attributionStatus: "unavailable" | "partial";
}>;

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function rounded(value: number): number {
  return Number(value.toFixed(12));
}

function quantizeCoverageLowerBound(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError("Sampled coverage ratio must be in the interval (0, 1].");
  }
  if (value < 0.01) {
    return GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL;
  }
  return Math.min(99, Math.floor(value * 100 + 1e-9)) / 100;
}

function endExclusive(endedAt: string): number {
  const value = Date.parse(endedAt) + 1;
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("GPT subsidy period end is outside the supported range.");
  }
  return value;
}

function positiveOverlap(
  startedAt: string,
  endedAt: string,
  rangeStart: number,
  rangeEnd: number,
): Readonly<{ start: number; end: number }> | null {
  const start = Math.max(Date.parse(startedAt), rangeStart);
  const end = Math.min(Date.parse(endedAt), rangeEnd);
  return end > start ? { start, end } : null;
}

function unionDuration(
  intervals: readonly Readonly<{ start: number; end: number }>[],
): number {
  const sorted = [...intervals].toSorted((left, right) => (
    left.start - right.start || left.end - right.end
  ));
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  for (const interval of sorted) {
    if (currentStart === null || currentEnd === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  return currentStart === null || currentEnd === null
    ? total
    : total + currentEnd - currentStart;
}

function unavailableAccountAttribution(): PublicAccountAttribution {
  return {
    status: "unavailable",
    distinctObservedAccounts: null,
    coverage: 0,
  };
}

type DerivedAccountAttribution = Readonly<{
  publicValue: PublicAccountAttribution;
  observedFingerprints: ReadonlySet<string>;
}>;

function deriveAccountAttributionForPeriod(
  accountLedger: AccountLedger,
  periodStartedAt: string,
  periodEndedAt: string,
): DerivedAccountAttribution {
  const rangeStart = Date.parse(periodStartedAt);
  const rangeEnd = endExclusive(periodEndedAt);
  if (!Number.isFinite(rangeStart) || rangeEnd <= rangeStart) {
    throw new TypeError("GPT subsidy attribution period is invalid.");
  }

  const observedFingerprints = new Set<string>();
  const coveredIntervals: Array<Readonly<{ start: number; end: number }>> = [];
  for (const interval of accountLedger.intervals) {
    if (interval.accountFingerprint === null || interval.authMode !== "chatgpt") {
      continue;
    }
    const overlap = positiveOverlap(
      interval.startedAt,
      interval.lastObservedAt,
      rangeStart,
      rangeEnd,
    );
    if (overlap === null) continue;
    coveredIntervals.push(overlap);
    observedFingerprints.add(interval.accountFingerprint);
  }

  const coveredMilliseconds = unionDuration(coveredIntervals);
  if (coveredMilliseconds <= 0 || observedFingerprints.size === 0) {
    return {
      publicValue: unavailableAccountAttribution(),
      observedFingerprints,
    };
  }
  const coverage = quantizeCoverageLowerBound(
    Math.min(1, coveredMilliseconds / (rangeEnd - rangeStart)),
  );
  return {
    publicValue: {
      status: "partial",
      distinctObservedAccounts: observedFingerprints.size,
      coverage,
    },
    observedFingerprints,
  };
}

type PrivateAttributionState = Readonly<{
  accountLedger: AccountLedger;
  rateLimitLedger: RateLimitLedger;
}>;

type OptionalRateLimitAttributionState = Readonly<{
  accountLedger: AccountLedger;
  rateLimitLedger: RateLimitLedger | null;
}>;

function parseAccountLedger(input: unknown): AccountLedger {
  return accountLedgerSchema.parse(input);
}

function parseRateLimitLedger(
  input: unknown,
  accountLedger: AccountLedger,
): RateLimitLedger {
  const rateLimitLedger = rateLimitLedgerSchema.parse(input);
  if (accountLedger.keyId !== rateLimitLedger.keyId) {
    throw new TypeError("Private account ledgers use different HMAC keys.");
  }
  const accountFingerprints = new Set(
    accountLedger.accounts.map(({ fingerprint }) => fingerprint),
  );
  if (rateLimitLedger.observations.some(
    ({ accountFingerprint }) => !accountFingerprints.has(accountFingerprint),
  )) {
    throw new TypeError("Rate-limit observations reference an unknown private account.");
  }
  return rateLimitLedger;
}

function parsePrivateAttributionState(
  accountLedgerInput: unknown,
  rateLimitLedgerInput: unknown,
): PrivateAttributionState {
  const accountLedger = parseAccountLedger(accountLedgerInput);
  const rateLimitLedger = parseRateLimitLedger(
    rateLimitLedgerInput,
    accountLedger,
  );
  return { accountLedger, rateLimitLedger };
}

function assertAccountAttributionFloor(
  prior: PublicAccountAttribution,
  next: PublicAccountAttribution,
  label: string,
): void {
  if (prior.status === "unavailable") return;
  if (
    next.status === "unavailable"
    || next.coverage < prior.coverage
    || next.distinctObservedAccounts < prior.distinctObservedAccounts
  ) {
    throw new Error(`${label} regressed below its published attribution floor.`);
  }
}

function assertObservedProComparisonFloor(
  prior: PublicAccountPlanComparison["observedProPlanComparison"],
  next: PublicAccountPlanComparison["observedProPlanComparison"],
): void {
  if (prior.status === "unavailable") return;
  if (
    next.status === "unavailable"
    || next.distinctVerifiedProAccountsLowerBound
      < prior.distinctVerifiedProAccountsLowerBound
  ) {
    throw new Error(
      "Current observed-Pro comparison regressed below its published floor.",
    );
  }
}

function assertAttributionContinuity(input: Readonly<{
  baseline: PublicData;
  comparison: PublicAccountPlanComparison;
  currentObservations: PublicData["observations"];
  observationAttributions: readonly PublicAccountAttribution[];
}>): void {
  const currentById = new Map(input.currentObservations.map(
    (observation, index) => [observation.id, {
      observation,
      attribution: input.observationAttributions[index]!,
    }],
  ));
  if (currentById.size !== input.currentObservations.length) {
    throw new Error("Current public attribution history has duplicate IDs.");
  }
  for (const prior of input.baseline.observations) {
    if (prior.accountAttribution.status === "unavailable") continue;
    const current = currentById.get(prior.id);
    if (
      current === undefined
      || current.observation.periodStartedAt !== prior.periodStartedAt
      || current.observation.periodEndsAt !== prior.periodEndsAt
    ) {
      throw new Error(
        "A fixed public observation disappeared or changed its window.",
      );
    }
    assertAccountAttributionFloor(
      prior.accountAttribution,
      current.attribution,
      `Fixed observation ${prior.id}`,
    );
  }

  const baselineComparison = input.baseline.accountPlanComparison;
  if (baselineComparison === undefined) return;
  if (
    baselineComparison.firstSampledAt !== null
    && input.comparison.firstSampledAt !== baselineComparison.firstSampledAt
  ) {
    throw new Error("Published attribution history marker changed.");
  }
  if (baselineComparison.accountAttribution.status === "unavailable") return;
  if (input.comparison.accountAttribution.status === "unavailable") {
    throw new Error("Current account-attribution history disappeared.");
  }
  if (
    input.comparison.periodStartedAt === baselineComparison.periodStartedAt
    && input.comparison.periodEndedAt === baselineComparison.periodEndedAt
  ) {
    assertAccountAttributionFloor(
      baselineComparison.accountAttribution,
      input.comparison.accountAttribution,
      "Current account-plan comparison",
    );
    assertObservedProComparisonFloor(
      baselineComparison.observedProPlanComparison,
      input.comparison.observedProPlanComparison,
    );
  }
}

function unavailableComparison(input: Readonly<{
  firstSampledAt: string | null;
  frozenAt: string;
  manifestSha256: string;
  periodEndedAt: string;
  periodStartedAt: string;
  revision: string;
}>): PublicAccountPlanComparison {
  return {
    periodStartedAt: input.periodStartedAt,
    periodEndedAt: input.periodEndedAt,
    accountAttribution: {
      status: "unavailable",
      distinctObservedAccounts: null,
      coverage: 0,
    },
    observedProPlanComparison: {
      status: "unavailable",
      distinctVerifiedProAccountsLowerBound: null,
      normalizedPlanValueUsd: null,
      apiEquivalentMultipleUpperBound: null,
    },
    firstSampledAt: input.firstSampledAt,
    measurement: {
      name: "AI Charts GPT subsidy account-attribution manifest",
      schemaVersion: 1,
      kind: "aicharts-gpt-subsidy-account-attribution",
      revision: input.revision,
      sha256: input.manifestSha256,
      frozenAt: input.frozenAt,
      sourceUrl: GPT_SUBSIDY_ATTRIBUTION_MANIFEST_URL,
    },
  };
}

function deriveAccountPlanComparisonFromState(input: Readonly<{
  accountLedger: AccountLedger;
  apiEquivalentUsd: number;
  firstSampledAt: string | null;
  generatedAt: string;
  manifest: Readonly<{
    frozenAt: string;
    revision: string;
    sha256: string;
  }>;
  periodEndedAt: string;
  periodStartedAt: string;
  planPriceUsd: number;
  rateLimitLedger: RateLimitLedger | null;
}>): PublicAccountPlanComparison {
  const rangeStart = Date.parse(input.periodStartedAt);
  const rangeEnd = endExclusive(input.periodEndedAt);
  if (!Number.isFinite(rangeStart) || rangeEnd <= rangeStart) {
    throw new TypeError("GPT subsidy comparison period is invalid.");
  }
  if (!Number.isFinite(input.apiEquivalentUsd) || input.apiEquivalentUsd < 0) {
    throw new RangeError("API-equivalent value must be finite and nonnegative.");
  }
  if (!Number.isFinite(input.planPriceUsd) || input.planPriceUsd <= 0) {
    throw new RangeError("Plan price must be finite and positive.");
  }

  const derivedAccountAttribution = deriveAccountAttributionForPeriod(
    input.accountLedger,
    input.periodStartedAt,
    input.periodEndedAt,
  );
  if (derivedAccountAttribution.publicValue.status === "unavailable") {
    return unavailableComparison({
      firstSampledAt: input.firstSampledAt,
      frozenAt: input.manifest.frozenAt,
      manifestSha256: input.manifest.sha256,
      periodEndedAt: input.periodEndedAt,
      periodStartedAt: input.periodStartedAt,
      revision: input.manifest.revision,
    });
  }
  const accountAttribution = derivedAccountAttribution.publicValue;
  const base = unavailableComparison({
    firstSampledAt: input.firstSampledAt ?? input.generatedAt,
    frozenAt: input.manifest.frozenAt,
    manifestSha256: input.manifest.sha256,
    periodEndedAt: input.periodEndedAt,
    periodStartedAt: input.periodStartedAt,
    revision: input.manifest.revision,
  });
  if (input.rateLimitLedger === null) {
    return { ...base, accountAttribution };
  }
  const allOverlappingBucketsArePro = new Map<string, boolean>();
  for (const observation of input.rateLimitLedger.observations) {
    if (!derivedAccountAttribution.observedFingerprints.has(
      observation.accountFingerprint,
    )) continue;
    const overlapsPeriod = Date.parse(observation.startedAt) < rangeEnd
      && Date.parse(observation.lastObservedAt) >= rangeStart;
    if (!overlapsPeriod) continue;
    const observationOnlyReportsPro = observation.buckets.length > 0
      && observation.buckets.every(({ planType }) => planType === "pro");
    allOverlappingBucketsArePro.set(
      observation.accountFingerprint,
      (allOverlappingBucketsArePro.get(observation.accountFingerprint) ?? true)
        && observationOnlyReportsPro,
    );
  }
  const verifiedProAccountCount = [...allOverlappingBucketsArePro.values()]
    .filter(Boolean).length;
  if (verifiedProAccountCount === 0) {
    return { ...base, accountAttribution };
  }
  const normalizedPlanValueUsd = verifiedProAccountCount
    * input.planPriceUsd;
  return {
    ...base,
    accountAttribution,
    observedProPlanComparison: {
      status: "sampled",
      distinctVerifiedProAccountsLowerBound: verifiedProAccountCount,
      normalizedPlanValueUsd,
      apiEquivalentMultipleUpperBound: rounded(
        input.apiEquivalentUsd / normalizedPlanValueUsd,
      ),
    },
  };
}

export function deriveAccountPlanComparison(input: Readonly<{
  accountLedger: unknown;
  apiEquivalentUsd: number;
  firstSampledAt: string | null;
  generatedAt: string;
  manifest: Readonly<{
    frozenAt: string;
    revision: string;
    sha256: string;
  }>;
  periodEndedAt: string;
  periodStartedAt: string;
  planPriceUsd: number;
  rateLimitLedger: unknown;
}>): PublicAccountPlanComparison {
  return deriveAccountPlanComparisonFromState({
    ...input,
    ...parsePrivateAttributionState(
      input.accountLedger,
      input.rateLimitLedger,
    ),
  });
}

async function assertPrivateParent(filePath: string): Promise<void> {
  const metadata = await lstat(path.dirname(filePath));
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("GPT subsidy private state directory is unsafe.");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("GPT subsidy private state directory has an unexpected owner.");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("GPT subsidy private state directory must be private.");
  }
}

async function readPrivateBytes(
  filePath: string,
  label: string,
): Promise<Buffer | null> {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if ((error as { code?: unknown }).code === "ENOENT") return null;
      if ((error as { code?: unknown }).code === "ELOOP") {
        throw new Error(`${label} must not be a symbolic link.`);
      }
    }
    throw new Error(`Unable to open ${label.toLowerCase()}.`);
  }
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file.`);
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      throw new Error(`${label} has an unexpected owner.`);
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`${label} permissions are too broad.`);
    }
    if (metadata.size > PRIVATE_FILE_MAX_BYTES) {
      throw new Error(`${label} exceeds its safe size bound.`);
    }
    const bytes = await file.readFile();
    if (bytes.length > PRIVATE_FILE_MAX_BYTES) {
      throw new Error(`${label} exceeds its safe size bound.`);
    }
    return bytes;
  } finally {
    await file.close();
  }
}

async function readPrivateContinuity(
  continuityPath: string,
): Promise<z.infer<typeof privateContinuitySchema> | null> {
  await assertPrivateParent(continuityPath);
  const [first, second] = await Promise.all([
    readPrivateBytes(continuityPath, "Attribution continuity state"),
    readPrivateBytes(continuityPath, "Attribution continuity state"),
  ]);
  if (
    (first === null) !== (second === null)
    || (first !== null && !first.equals(second!))
  ) {
    throw new Error("Private attribution continuity state changed while reading.");
  }
  if (first === null) return null;
  try {
    return privateContinuitySchema.parse(JSON.parse(first.toString("utf8")));
  } catch {
    throw new Error("Private attribution continuity state is invalid.");
  }
}

async function readStablePrivateLedgers(
  accountLedgerPath: string,
  rateLimitLedgerPath: string,
): Promise<Readonly<{
  accountLedger: unknown | null;
  rateLimitLedger: unknown | null;
}>> {
  const accountParentExists = await lstat(path.dirname(accountLedgerPath))
    .then(() => true)
    .catch((error: unknown) => {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: unknown }).code === "ENOENT"
      ) return false;
      throw error;
    });
  if (!accountParentExists) {
    return { accountLedger: null, rateLimitLedger: null };
  }
  await Promise.all([
    assertPrivateParent(accountLedgerPath),
    assertPrivateParent(rateLimitLedgerPath),
  ]);
  const [firstAccount, firstRateLimit] = await Promise.all([
    readPrivateBytes(accountLedgerPath, "Account observation ledger"),
    readPrivateBytes(rateLimitLedgerPath, "Rate-limit observation ledger"),
  ]);
  const [secondAccount, secondRateLimit] = await Promise.all([
    readPrivateBytes(accountLedgerPath, "Account observation ledger"),
    readPrivateBytes(rateLimitLedgerPath, "Rate-limit observation ledger"),
  ]);
  if (
    (firstAccount === null) !== (secondAccount === null)
    || (firstRateLimit === null) !== (secondRateLimit === null)
    || (firstAccount !== null && !firstAccount.equals(secondAccount!))
    || (firstRateLimit !== null && !firstRateLimit.equals(secondRateLimit!))
  ) {
    throw new Error("Private GPT subsidy ledgers changed during aggregation.");
  }
  const safeParse = (bytes: Buffer | null, label: string): unknown | null => {
    if (bytes === null) return null;
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new Error(`${label} is invalid.`);
    }
  };
  return {
    accountLedger: safeParse(firstAccount, "Account observation ledger"),
    rateLimitLedger: safeParse(firstRateLimit, "Rate-limit observation ledger"),
  };
}

async function atomicWrite(
  target: string,
  source: string,
  mode = 0o644,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    await open(temporary, "wx", mode).then(async file => {
      try {
        await file.writeFile(source, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
    });
    await rename(temporary, target);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw cause;
  }
}

function readCheckedHeadBaseline(
  root: string,
  dataPath: string,
): PublicData {
  const canonicalDataPath = path.join(path.resolve(root), "data", "gpt-subsidy.json");
  if (path.resolve(dataPath) !== canonicalDataPath) {
    throw new Error(
      "A retained attribution baseline is required for a noncanonical data path.",
    );
  }
  const result = spawnSync(
    "git",
    ["show", "HEAD:data/gpt-subsidy.json"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: PRIVATE_FILE_MAX_BYTES,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("Unable to read the checked pre-update attribution baseline.");
  }
  return publicDataSchema.parse(parseJson(
    result.stdout,
    "Checked pre-update GPT subsidy attribution baseline",
  )) as PublicData;
}

export async function enrichGptSubsidyAttribution(
  options: EnrichmentOptions = {},
): Promise<EnrichmentOutcome> {
  const root = options.repositoryRoot ?? repositoryRoot;
  const dataPath = options.dataPath ?? defaultDataPath;
  const manifestPath = options.attributionManifestPath ?? defaultManifestPath;
  const manifestSource = await readFile(manifestPath);
  const manifest = parseGptSubsidyAttributionManifest(parseJson(
    manifestSource.toString("utf8"),
    "GPT subsidy attribution manifest",
  ));
  await assertGptSubsidyAttributionImplementation(manifest, root);
  const current = publicDataSchema.parse(parseJson(
    await readFile(dataPath, "utf8"),
    "GPT subsidy data",
  )) as PublicData;
  const currentFirstSampledAt = current.accountPlanComparison
    ?.firstSampledAt ?? null;
  const canonicalDataPath = path.join(path.resolve(root), "data", "gpt-subsidy.json");
  const baselineOrigin = path.resolve(dataPath) === canonicalDataPath
    ? "checked-head"
    : "current-unsampled-fixture";
  if (
    currentFirstSampledAt !== null
    && baselineOrigin === "current-unsampled-fixture"
  ) {
    throw new Error(
      "A pre-update public baseline is required after sampled attribution was published.",
    );
  }
  const baseline = baselineOrigin === "checked-head"
    ? readCheckedHeadBaseline(root, dataPath)
    : current;
  const privateLedgers = await readStablePrivateLedgers(
    options.accountLedgerPath ?? defaultAccountLedgerPath,
    options.rateLimitLedgerPath ?? defaultRateLimitLedgerPath,
  );
  const baselineFirstSampledAt = baseline.accountPlanComparison
    ?.firstSampledAt ?? null;
  if (
    baselineFirstSampledAt !== null
    && currentFirstSampledAt !== baselineFirstSampledAt
  ) {
    throw new Error("Token update changed the sampled-attribution history marker.");
  }
  const priorFirstSampledAt = baselineFirstSampledAt
    ?? currentFirstSampledAt;
  let comparison: PublicAccountPlanComparison;
  let continuityToWrite: Readonly<{
    path: string;
    value: z.infer<typeof privateContinuitySchema>;
  }> | null = null;
  let observationAttributions = current.observations.map(
    () => unavailableAccountAttribution(),
  );
  if (privateLedgers.accountLedger === null) {
    if (privateLedgers.rateLimitLedger !== null) {
      throw new Error("Private GPT subsidy attribution state is invalid.");
    }
    if (priorFirstSampledAt !== null) {
      throw new Error(
        "Private account state is missing after sampled attribution was published.",
      );
    }
    comparison = unavailableComparison({
      firstSampledAt: null,
      frozenAt: manifest.frozenAt,
      manifestSha256: attributionSha256(manifestSource),
      periodEndedAt: current.periodSummary.endedAt,
      periodStartedAt: current.periodSummary.startedAt,
      revision: manifest.revision,
    });
  } else {
    try {
      const accountLedger = parseAccountLedger(privateLedgers.accountLedger);
      const privateState: OptionalRateLimitAttributionState = {
        accountLedger,
        rateLimitLedger: privateLedgers.rateLimitLedger === null
          ? null
          : parseRateLimitLedger(privateLedgers.rateLimitLedger, accountLedger),
      };
      const continuityPath = options.continuityPath
        ?? defaultAttributionContinuityPath;
      const privateContinuity = await readPrivateContinuity(continuityPath);
      if (
        privateContinuity !== null
        && baselineOrigin === "current-unsampled-fixture"
      ) {
        throw new Error(
          "A pre-update public baseline is required after attribution continuity was established.",
        );
      }
      if (
        privateContinuity !== null
        && privateContinuity.keyId !== privateState.accountLedger.keyId
      ) {
        throw new Error("Private attribution continuity key changed.");
      }
      if (
        privateContinuity !== null
        && privateContinuity.accountLedgerCreatedAt
          !== privateState.accountLedger.createdAt
      ) {
        throw new Error("Private attribution ledger epoch changed.");
      }
      if (
        privateContinuity !== null
        && privateContinuity.rateLimitLedgerCreatedAt !== null
        && (
          privateState.rateLimitLedger === null
          || privateContinuity.rateLimitLedgerCreatedAt
            !== privateState.rateLimitLedger.createdAt
        )
      ) {
        throw new Error("Private attribution ledger epoch changed.");
      }
      if (
        privateContinuity !== null
        && (
          privateState.accountLedger.accounts.length
            < privateContinuity.minimumAccountCount
          || privateState.accountLedger.intervals.length
            < privateContinuity.minimumAccountIntervalCount
        )
      ) {
        throw new Error("Private attribution ledger history shrank.");
      }
      if (
        privateContinuity !== null
        && privateContinuity.minimumRateLimitObservationCount !== null
        && (
          privateState.rateLimitLedger === null
          || privateState.rateLimitLedger.observations.length
            < privateContinuity.minimumRateLimitObservationCount
        )
      ) {
        throw new Error("Private attribution ledger history shrank.");
      }
      if (privateContinuity === null && priorFirstSampledAt !== null) {
        throw new Error(
          "Private attribution continuity state is missing after sampling.",
        );
      }
      observationAttributions = current.observations.map(observation => (
        deriveAccountAttributionForPeriod(
          privateState.accountLedger,
          observation.periodStartedAt,
          observation.periodEndsAt,
        ).publicValue
      ));
      const summaryAttribution = deriveAccountAttributionForPeriod(
        privateState.accountLedger,
        current.periodSummary.startedAt,
        current.periodSummary.endedAt,
      ).publicValue;
      const hasSampledAttribution = summaryAttribution.status !== "unavailable"
        || observationAttributions.some(({ status }) => status !== "unavailable");
      comparison = deriveAccountPlanComparisonFromState({
        accountLedger: privateState.accountLedger,
        apiEquivalentUsd: current.periodSummary.apiEquivalentUsd,
        firstSampledAt: priorFirstSampledAt
          ?? (hasSampledAttribution ? current.generatedAt : null),
        generatedAt: current.generatedAt,
        manifest: {
          frozenAt: manifest.frozenAt,
          revision: manifest.revision,
          sha256: attributionSha256(manifestSource),
        },
        periodEndedAt: current.periodSummary.endedAt,
        periodStartedAt: current.periodSummary.startedAt,
        planPriceUsd: current.plan.monthlyPriceUsd,
        rateLimitLedger: privateState.rateLimitLedger,
      });
      if (hasSampledAttribution) {
        continuityToWrite = {
          path: continuityPath,
          value: {
            version: 1,
            keyId: privateState.accountLedger.keyId,
            establishedAt: privateContinuity?.establishedAt
              ?? current.generatedAt,
            accountLedgerCreatedAt: privateState.accountLedger.createdAt,
            rateLimitLedgerCreatedAt:
              privateState.rateLimitLedger?.createdAt ?? null,
            minimumAccountCount: privateState.accountLedger.accounts.length,
            minimumAccountIntervalCount:
              privateState.accountLedger.intervals.length,
            minimumRateLimitObservationCount:
              privateState.rateLimitLedger?.observations.length ?? null,
          },
        };
      }
    } catch {
      throw new Error("Private GPT subsidy attribution state is invalid.");
    }
  }
  assertAttributionContinuity({
    baseline,
    comparison,
    currentObservations: current.observations,
    observationAttributions,
  });
  if (continuityToWrite !== null) {
    await atomicWrite(
      continuityToWrite.path,
      `${JSON.stringify(continuityToWrite.value, null, 2)}\n`,
      0o600,
    );
  }
  const next: PublicData = {
    ...current,
    observations: current.observations.map((observation, index) => ({
      ...observation,
      accountAttribution: observationAttributions[index]!,
      subscriptionAdjustedMultiple: null,
    })),
    accountPlanComparison: comparison,
    methodology: {
      ...current.methodology,
      sourceUrls: [
        ...new Set([
          ...current.methodology.sourceUrls,
          GPT_SUBSIDY_ATTRIBUTION_MANIFEST_URL,
        ]),
      ],
    },
  };
  const changed = !isDeepStrictEqual(current, next);
  if (changed) {
    await atomicWrite(dataPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return {
    kind: changed ? "updated" : "unchanged",
    attributionStatus: comparison.accountAttribution.status,
  };
}

export function attributionEnricherCliOptions(
  arguments_: readonly string[],
): EnrichmentOptions {
  if (arguments_.length === 0) return {};
  throw new Error(
    "Usage: enrich-gpt-subsidy-attribution.ts",
  );
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(await enrichGptSubsidyAttribution(
    attributionEnricherCliOptions(process.argv.slice(2)),
  ))}\n`);
}
