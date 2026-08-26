import { spawn } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  assertGptSubsidyMeasurementImplementation,
  GPT_SUBSIDY_MEASUREMENT_MANIFEST_URL,
  GPT_SUBSIDY_PRICING_MANIFEST_URL,
  GPT_SUBSIDY_ROLLING_DAYS,
  GPT_SUBSIDY_SUMMARY_DAYS,
  parseGptSubsidyMeasurementManifest,
  parseGptSubsidyPricingManifest,
  sha256,
  TOKSCALE_COMMIT,
  TOKSCALE_VERSION,
} from "../lib/gpt-subsidy-manifests";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const defaultDataPath = path.join(repositoryRoot, "data", "gpt-subsidy.json");
const defaultPricingPath = path.join(repositoryRoot, "data", "gpt-subsidy-pricing.json");
const defaultMeasurementPath = path.join(repositoryRoot, "data", "gpt-subsidy-measurement.json");
const defaultLedgerPath = path.join(homedir(), ".local", "bin", "aicharts-gpt-subsidy-ledger");
const PLAN_BASIS_OBSERVED_AT = "2026-08-25T00:00:00Z";
const PLAN_SOURCE_URL = "https://help.openai.com/en/articles/9793128";
const CODEX_LIMITS_SOURCE_URL = "https://learn.chatgpt.com/docs/pricing";
const TOKSCALE_PARSER_SOURCE_URL =
  `https://github.com/junhoyeo/tokscale/blob/${TOKSCALE_COMMIT}/crates/tokscale-core/src/sessions/codex.rs#L98-L214`;
const TOKSCALE_DEDUPLICATION_SOURCE_URL =
  `https://github.com/junhoyeo/tokscale/blob/${TOKSCALE_COMMIT}/crates/tokscale-core/src/sessions/codex.rs#L518-L675`;
const METHODOLOGY_FORMULA =
  "Each observation values every recorded model with its per-model rate from the checked August 25, 2026 AI Charts OpenAI rate manifest and sums seven settled UTC days. The v2 series does not calculate a subscription-adjusted multiple because account identity alone is not subscription-price or billing-period evidence.";
const METHODOLOGY_DISCLAIMER =
  "This is an API-retail-equivalent estimate of one user's available local Codex logs on one machine, not OpenAI's internal serving cost or an audited subsidy, and it is not a platform-wide or representative ChatGPT Pro estimate. Historical Codex logs do not retain durable account attribution, so the published historical series cannot assign usage to distinct subscriptions or calculate a subscription-adjusted multiple. API-key or otherwise API-billed usage, purchased ChatGPT credits, free or reset credits, and temporary promotions cannot be distinguished or excluded. The internal codex-auto-review alias uses the explicit GPT-5.6 Luna proxy rate. Non-token product features and fees absent from the logs are excluded.";
const MAX_SCANNED_DAYS = 366;
const UTC_DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

const isoSchema = z.string().datetime({ offset: true });
const countSchema = z.number().int().nonnegative().refine(Number.isSafeInteger, "unsafe integer");
const moneySchema = z.number().finite().nonnegative();
const modelIdSchema = z.string().min(1).max(256);
const tokensSchema = z.object({
  uncachedInput: countSchema,
  cachedInput: countSchema,
  output: countSchema,
  total: countSchema,
}).strict().superRefine((tokens, context) => {
  if (tokens.uncachedInput + tokens.cachedInput + tokens.output !== tokens.total) {
    context.addIssue({ code: "custom", message: "token buckets do not sum" });
  }
});
const pricedTokensSchema = z.object({
  tokens: tokensSchema,
  apiEquivalentUsd: moneySchema,
}).strict().superRefine((value, context) => {
  if (value.tokens.total > 0 && value.apiEquivalentUsd <= 0) {
    context.addIssue({ code: "custom", message: "nonzero usage must have a positive manifest price" });
  }
});
const ledgerSchema = z.object({
  schemaVersion: z.literal(1),
  parser: z.object({
    name: z.literal("tokscale"),
    version: z.literal(TOKSCALE_VERSION),
    commit: z.literal(TOKSCALE_COMMIT),
  }).strict(),
  deduplication: z.literal("tokscale-global-event-identity"),
  measurementBasis: z.object({
    kind: z.literal("aicharts-gpt-subsidy-measurement"),
    revision: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    frozenAt: isoSchema,
  }).strict(),
  range: z.object({ startInclusive: isoSchema, endExclusive: isoSchema }).strict(),
  pricingCoverage: z.object({
    status: z.literal("complete"),
    basis: z.object({
      kind: z.literal("aicharts-openai-rate-manifest"),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      frozenAt: isoSchema,
    }).strict(),
    modelIds: z.array(modelIdSchema).max(128).superRefine((models, context) => {
      if (JSON.stringify(models) !== JSON.stringify([...new Set(models)].toSorted())) {
        context.addIssue({ code: "custom", message: "priced model IDs must be unique and sorted" });
      }
    }),
    proxyModelIds: z.array(modelIdSchema).max(128).superRefine((models, context) => {
      if (JSON.stringify(models) !== JSON.stringify([...new Set(models)].toSorted())) {
        context.addIssue({ code: "custom", message: "proxy model IDs must be unique and sorted" });
      }
    }),
    unpricedModelIds: z.tuple([]),
  }).strict().superRefine((coverage, context) => {
    coverage.proxyModelIds.forEach((model, index) => {
      if (!coverage.modelIds.includes(model)) {
        context.addIssue({ code: "custom", message: "proxy coverage must be a subset of priced models", path: ["proxyModelIds", index] });
      }
    });
  }),
  days: z.array(z.object({
    date: z.string().date(),
    complete: z.boolean(),
  }).extend(pricedTokensSchema.shape).strict()).min(1).max(366),
}).strict().superRefine((ledger, context) => {
  ledger.days.forEach((day, index) => {
    if (day.tokens.total > 0 && day.apiEquivalentUsd <= 0) {
      context.addIssue({
        code: "custom",
        message: "nonzero usage must have a positive manifest price",
        path: ["days", index, "apiEquivalentUsd"],
      });
    }
  });
});
const observationFields = {
  id: z.string().min(1),
  observedAt: isoSchema,
  periodStartedAt: isoSchema,
  periodEndsAt: isoSchema,
  tokens: tokensSchema,
  trailingSevenDayApiEquivalentUsd: moneySchema,
  accountAttribution: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("unavailable"),
      distinctObservedAccounts: z.null(),
      coverage: z.literal(0),
    }).strict(),
    z.object({
      status: z.literal("partial"),
      distinctObservedAccounts: z.number().int().positive(),
      coverage: z.number().finite().gt(0).lt(1),
    }).strict(),
    z.object({
      status: z.literal("complete"),
      distinctObservedAccounts: z.number().int().positive(),
      coverage: z.literal(1),
    }).strict(),
  ]),
  subscriptionAdjustedMultiple: z.null(),
} as const;
const existingObservationSchema = z.object({
  ...observationFields,
  status: z.enum(["settled", "live"]),
}).strict();
const settledObservationSchema = z.object({
  ...observationFields,
  status: z.literal("settled"),
}).strict();
const existingPricingSchema = z.object({
  basis: z.literal("per-model-api-retail"),
  manifest: z.object({
    name: z.literal("AI Charts OpenAI rate manifest"),
    schemaVersion: z.literal(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    frozenAt: isoSchema,
    sourceUrl: z.literal(GPT_SUBSIDY_PRICING_MANIFEST_URL),
  }).strict(),
  proxyModelIds: z.array(modelIdSchema).superRefine((models, context) => {
    if (JSON.stringify(models) !== JSON.stringify([...new Set(models)].toSorted())) {
      context.addIssue({ code: "custom", message: "historical proxy model IDs must be unique and sorted" });
    }
  }),
}).passthrough();
const existingMeasurementSchema = z.object({
  name: z.literal("AI Charts GPT subsidy measurement manifest"),
  schemaVersion: z.literal(1),
  kind: z.literal("aicharts-gpt-subsidy-measurement"),
  revision: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  frozenAt: isoSchema,
  sourceUrl: z.literal(GPT_SUBSIDY_MEASUREMENT_MANIFEST_URL),
}).strict();

type Tokens = z.infer<typeof tokensSchema>;
export type SubsidyLedger = z.infer<typeof ledgerSchema>;
type PublicData = Record<string, unknown> & {
  generatedAt: string;
  methodology: Record<string, unknown> & {
    measurement: z.infer<typeof existingMeasurementSchema>;
  };
  observations: z.infer<typeof existingObservationSchema>[];
  plan: {
    advertisedUsageMultiplier: 20;
    monthlyPriceUsd: 200;
    name: "ChatGPT Pro";
  } & Record<string, unknown>;
  pricing: z.infer<typeof existingPricingSchema>;
};
export type CollectorOutcome = Readonly<{ kind: "unchanged" | "updated"; observationCount: number }>;
type Options = Readonly<{
  dataPath?: string;
  ledger?: SubsidyLedger;
  measurementPath?: string;
  now?: () => Date;
  pricingPath?: string;
}>;
type PricingBasis = Readonly<{
  frozenAt: string;
  kind: "aicharts-openai-rate-manifest";
  modelIds: ReadonlySet<string>;
  proxyModelIds: ReadonlySet<string>;
  sourceUrls: readonly string[];
  referenceModel: Readonly<{
    cachedInputPerMillionUsd: number;
    name: "GPT-5.6 Sol";
    outputPerMillionUsd: number;
    sourceUrl: string;
    uncachedInputPerMillionUsd: number;
  }>;
  sha256: string;
}>;
type MeasurementBasis = Readonly<{
  frozenAt: string;
  kind: "aicharts-gpt-subsidy-measurement";
  revision: string;
  sha256: string;
}>;

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (cause) {
    throw new Error(`${label} is not valid JSON.`, { cause });
  }
}

function iso(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new TypeError("Collector clock returned an invalid date.");
  return date.toISOString();
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function rounded(value: number): number {
  return Number(value.toFixed(12));
}

export function sumTokenBuckets(values: readonly Tokens[]): Tokens {
  const aggregate = values.reduce((sum, value) => ({
    uncachedInput: sum.uncachedInput + BigInt(value.uncachedInput),
    cachedInput: sum.cachedInput + BigInt(value.cachedInput),
    output: sum.output + BigInt(value.output),
    total: sum.total + BigInt(value.total),
  }), { uncachedInput: 0n, cachedInput: 0n, output: 0n, total: 0n });
  for (const value of Object.values(aggregate)) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Aggregate token count exceeds JSON's exact integer range.");
    }
  }
  return tokensSchema.parse(Object.fromEntries(
    Object.entries(aggregate).map(([key, value]) => [key, Number(value)]),
  ));
}

function sumMoney(values: readonly number[]): number {
  return rounded(values.reduce((sum, value) => sum + value, 0));
}

function parsePublicData(value: unknown): PublicData {
  return z.object({
    schemaVersion: z.literal(2),
    generatedAt: isoSchema,
    observations: z.array(existingObservationSchema),
    plan: z.object({
      name: z.literal("ChatGPT Pro"),
      monthlyPriceUsd: z.literal(200),
      advertisedUsageMultiplier: z.literal(20),
    }).passthrough(),
    pricing: existingPricingSchema,
    methodology: z.object({
      measurement: existingMeasurementSchema,
    }).passthrough(),
  }).passthrough().superRefine((data, context) => {
    const ids = new Set<string>();
    let previous = Number.NEGATIVE_INFINITY;
    data.observations.forEach((observation, index) => {
      if (ids.has(observation.id)) {
        context.addIssue({ code: "custom", message: "duplicate existing observation ID", path: ["observations", index, "id"] });
      }
      ids.add(observation.id);
      const observedAt = Date.parse(observation.observedAt);
      if (observedAt <= previous) {
        context.addIssue({ code: "custom", message: "existing observations are not strictly chronological", path: ["observations", index, "observedAt"] });
      }
      previous = observedAt;
    });
  }).parse(value) as PublicData;
}

function assertExistingSeriesBasis(
  data: PublicData,
  pricing: PricingBasis,
  measurement: MeasurementBasis,
): void {
  if (
    data.pricing.manifest.sha256 !== pricing.sha256
    || data.pricing.manifest.frozenAt !== pricing.frozenAt
  ) {
    throw new TypeError(
      "Existing GPT subsidy history uses a different checked pricing basis. "
      + "Recompute the complete retained series through a deliberate migration before publication.",
    );
  }
  if (
    data.methodology.measurement.sha256 !== measurement.sha256
    || data.methodology.measurement.frozenAt !== measurement.frozenAt
    || data.methodology.measurement.revision !== measurement.revision
  ) {
    throw new TypeError(
      "Existing GPT subsidy history uses a different checked measurement basis. "
      + "Recompute the complete retained series through a deliberate migration before publication.",
    );
  }
}

async function readPricingBasis(pricingPath: string): Promise<PricingBasis> {
  const source = await readFile(pricingPath);
  const manifest = parseGptSubsidyPricingManifest(
    parseJson(source.toString("utf8"), "GPT subsidy pricing manifest"),
  );
  const referenceModel = manifest.models.find(({ modelId }) => modelId === "gpt-5.6-sol");
  if (referenceModel === undefined || referenceModel.pricingType !== "official") {
    throw new TypeError("GPT-5.6 Sol must have official rates in the checked pricing manifest.");
  }
  return {
    frozenAt: manifest.frozenAt,
    kind: manifest.kind,
    modelIds: new Set(manifest.models.map(({ modelId }) => modelId)),
    proxyModelIds: new Set(manifest.models
      .filter((model) => model.pricingType === "proxy")
      .map(({ modelId }) => modelId)),
    referenceModel: {
      cachedInputPerMillionUsd: referenceModel.rates.cachedInput,
      name: "GPT-5.6 Sol",
      outputPerMillionUsd: referenceModel.rates.output,
      sourceUrl: referenceModel.sourceUrl,
      uncachedInputPerMillionUsd: referenceModel.rates.input,
    },
    sourceUrls: [...new Set(manifest.models.map(({ sourceUrl }) => sourceUrl))].toSorted(),
    sha256: sha256(source),
  };
}

async function readMeasurementBasis(measurementPath: string): Promise<MeasurementBasis> {
  const source = await readFile(measurementPath);
  const manifest = parseGptSubsidyMeasurementManifest(
    parseJson(source.toString("utf8"), "GPT subsidy measurement manifest"),
  );
  await assertGptSubsidyMeasurementImplementation(manifest, repositoryRoot);
  return {
    frozenAt: manifest.frozenAt,
    kind: manifest.kind,
    revision: manifest.revision,
    sha256: sha256(source),
  };
}

function expectedDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor < new Date(end); cursor = addUtcDays(cursor, 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function settledDayEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function observationDate(observation: z.infer<typeof existingObservationSchema>): string {
  return observation.observedAt.slice(0, 10);
}

function assertCanonicalSettledObservation(
  observation: z.infer<typeof existingObservationSchema>,
): asserts observation is z.infer<typeof settledObservationSchema> {
  if (observation.status !== "settled") {
    throw new TypeError("Published observation history may contain only settled UTC days.");
  }
  const date = observationDate(observation);
  const start = addUtcDays(
    new Date(`${date}T00:00:00.000Z`),
    -(GPT_SUBSIDY_ROLLING_DAYS - 1),
  ).toISOString();
  const end = settledDayEnd(date);
  if (
    observation.id !== `trailing-7d-${date}`
    || observation.observedAt !== end
    || observation.periodEndsAt !== end
    || observation.periodStartedAt !== start
  ) {
    throw new TypeError("Published observations must identify exact trailing-seven-calendar-day UTC windows.");
  }
}

function assertAdjacentSettledHistory(
  observations: readonly z.infer<typeof existingObservationSchema>[],
): asserts observations is readonly z.infer<typeof settledObservationSchema>[] {
  let previousDate: Date | undefined;
  for (const observation of observations) {
    assertCanonicalSettledObservation(observation);
    const currentDate = new Date(`${observationDate(observation)}T00:00:00.000Z`);
    if (previousDate !== undefined && currentDate.getTime() - previousDate.getTime() !== UTC_DAY_MILLISECONDS) {
      throw new TypeError("Published observation history must contain every adjacent UTC day.");
    }
    previousDate = currentDate;
  }
}

function scanRangeForHistory(
  observations: readonly z.infer<typeof existingObservationSchema>[],
  closedEnd: Date,
): Readonly<{ start: string; end: string }> {
  const settled = observations.filter((observation) => observation.status === "settled");
  for (const observation of settled) {
    assertCanonicalSettledObservation(observation);
    if (new Date(observation.observedAt) >= closedEnd) {
      throw new TypeError("Existing settled history extends into an open or future UTC day.");
    }
  }

  const dates = new Set(settled.map(observationDate));
  let earliestMissing: Date | undefined;
  const first = settled[0];
  if (first !== undefined) {
    for (
      let cursor = new Date(`${observationDate(first)}T00:00:00.000Z`);
      cursor < closedEnd;
      cursor = addUtcDays(cursor, 1)
    ) {
      if (!dates.has(utcDate(cursor))) {
        earliestMissing = cursor;
        break;
      }
    }
  }

  const recentOutputStart = addUtcDays(closedEnd, -GPT_SUBSIDY_SUMMARY_DAYS);
  const outputStart = earliestMissing !== undefined && earliestMissing < recentOutputStart
    ? earliestMissing
    : recentOutputStart;
  const start = addUtcDays(outputStart, -(GPT_SUBSIDY_ROLLING_DAYS - 1));
  const scannedDays = (closedEnd.getTime() - start.getTime()) / UTC_DAY_MILLISECONDS;
  if (!Number.isInteger(scannedDays) || scannedDays < GPT_SUBSIDY_ROLLING_DAYS) {
    throw new TypeError("Computed ledger range is not a whole number of UTC days.");
  }
  if (scannedDays > MAX_SCANNED_DAYS) {
    throw new RangeError(
      `Observation gap requires ${String(scannedDays)} ledger days, exceeding the ${String(MAX_SCANNED_DAYS)}-day safe scan bound.`,
    );
  }
  return { start: start.toISOString(), end: closedEnd.toISOString() };
}

export function validateSubsidyLedger(
  value: unknown,
  expected: Readonly<{ start: string; end: string }>,
  pricing: PricingBasis,
  measurement: MeasurementBasis,
): SubsidyLedger {
  const ledger = ledgerSchema.parse(value);
  if (ledger.range.startInclusive !== expected.start || ledger.range.endExclusive !== expected.end) {
    throw new TypeError("Pinned ledger returned a range different from the request.");
  }
  if (
    utcDayStart(new Date(expected.start)).toISOString() !== expected.start
    || utcDayStart(new Date(expected.end)).toISOString() !== expected.end
  ) {
    throw new TypeError("Pinned ledger range must use UTC day boundaries.");
  }
  if (
    ledger.measurementBasis.kind !== measurement.kind
    || ledger.measurementBasis.sha256 !== measurement.sha256
    || ledger.measurementBasis.frozenAt !== measurement.frozenAt
    || ledger.measurementBasis.revision !== measurement.revision
  ) {
    throw new TypeError("Pinned ledger measurement provenance differs from the checked measurement manifest.");
  }
  if (
    ledger.pricingCoverage.basis.kind !== pricing.kind
    || ledger.pricingCoverage.basis.sha256 !== pricing.sha256
    || ledger.pricingCoverage.basis.frozenAt !== pricing.frozenAt
  ) {
    throw new TypeError("Pinned ledger pricing provenance differs from the checked rate manifest.");
  }
  const unknownModel = ledger.pricingCoverage.modelIds.find((model) => !pricing.modelIds.has(model));
  if (unknownModel !== undefined) {
    throw new TypeError(`Pinned ledger used a model absent from the checked rate manifest: ${unknownModel}.`);
  }
  const expectedProxyModels = ledger.pricingCoverage.modelIds
    .filter((model) => pricing.proxyModelIds.has(model));
  if (JSON.stringify(ledger.pricingCoverage.proxyModelIds) !== JSON.stringify(expectedProxyModels)) {
    throw new TypeError("Pinned ledger proxy disclosure differs from the checked rate manifest.");
  }
  const dates = expectedDates(expected.start, expected.end);
  if (
    dates.length < GPT_SUBSIDY_ROLLING_DAYS
    || dates.length > MAX_SCANNED_DAYS
    || ledger.days.length !== dates.length
  ) {
    throw new TypeError(
      `Pinned ledger must return between ${String(GPT_SUBSIDY_ROLLING_DAYS)} and ${String(MAX_SCANNED_DAYS)} contiguous UTC days.`,
    );
  }
  ledger.days.forEach((day, index) => {
    if (day.date !== dates[index]) {
      throw new TypeError("Pinned ledger days are missing, duplicated, or out of order.");
    }
    if (!day.complete) {
      throw new TypeError("Pinned ledger may publish only complete UTC days.");
    }
  });
  return ledger;
}

function ledgerCommand(): readonly string[] {
  const configured = process.env.GPT_SUBSIDY_LEDGER_COMMAND?.trim();
  if (!configured) return [defaultLedgerPath];
  return z.array(z.string().min(1)).min(1).max(16).parse(
    parseJson(configured, "GPT_SUBSIDY_LEDGER_COMMAND"),
  );
}

async function boundedProcess(command: string, args: readonly string[]): Promise<string> {
  const child = spawn(command, [...args], {
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutLimit = 8 * 1_024 * 1_024;
  const stderrLimit = 256 * 1_024;
  const diagnosticLimit = 4 * 1_024;
  let stdout = "";
  let stdoutBytes = 0;
  let stderr = "";
  let stderrBytes = 0;
  return await new Promise<string>((resolve, reject) => {
    let terminalError: Error | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const diagnostics = () => {
      const detail = stderr.trim();
      return detail.length === 0 ? "" : ` Stderr: ${detail}`;
    };
    const terminate = (error: Error) => {
      if (terminalError !== undefined) return;
      terminalError = error;
      child.stdout.pause();
      child.stderr.pause();
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    };
    const timer = setTimeout(() => {
      terminate(new Error("Pinned Tokscale ledger adapter timed out."));
    }, 15 * 60_000);
    child.once("error", () => {
      terminalError = new Error("Could not start the pinned Tokscale ledger adapter.");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > stdoutLimit) {
        terminate(new Error("Pinned ledger output exceeded its safety bound."));
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderr.length < diagnosticLimit) {
        stderr += chunk.toString("utf8").slice(0, diagnosticLimit - stderr.length);
      }
      if (stderrBytes > stderrLimit) {
        terminate(new Error("Pinned ledger stderr exceeded its safety bound."));
      }
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (terminalError !== undefined) {
        reject(new Error(`${terminalError.message}${diagnostics()}`, { cause: terminalError }));
      } else if (code !== 0) {
        reject(new Error(`Pinned ledger adapter exited unsuccessfully (code ${String(code)}).${diagnostics()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function readLedger(
  expected: Readonly<{ start: string; end: string }>,
  pricing: PricingBasis,
  measurement: MeasurementBasis,
): Promise<SubsidyLedger> {
  const [command, ...baseArgs] = ledgerCommand();
  if (!command) throw new TypeError("Pinned ledger command is empty.");
  const output = await boundedProcess(command, [...baseArgs, expected.start, expected.end]);
  return validateSubsidyLedger(
    parseJson(output, "pinned Tokscale ledger output"),
    expected,
    pricing,
    measurement,
  );
}

async function atomicWrite(target: string, source: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await rename(temporary, target);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw cause;
  }
}

function mergeObservationHistory(
  existing: readonly z.infer<typeof existingObservationSchema>[],
  derived: readonly z.infer<typeof settledObservationSchema>[],
): z.infer<typeof settledObservationSchema>[] {
  const firstDerived = derived[0];
  const lastDerived = derived.at(-1);
  if (!firstDerived || !lastDerived) throw new TypeError("Derived observation window is empty.");
  const firstDate = firstDerived.observedAt.slice(0, 10);
  const lastDate = lastDerived.observedAt.slice(0, 10);
  const derivedDates = new Set(derived.map(({ observedAt }) => observedAt.slice(0, 10)));
  const preserved: z.infer<typeof settledObservationSchema>[] = [];
  for (const observation of existing) {
    if (observation.status === "live") continue;
    const date = observation.observedAt.slice(0, 10);
    if (derivedDates.has(date)) continue;
    if (date < firstDate) {
      assertCanonicalSettledObservation(observation);
      preserved.push(observation);
      continue;
    }
    if (date > lastDate) {
      throw new TypeError("Existing observation history is newer than the pinned ledger range.");
    }
    throw new TypeError("An overlapping observation date was not represented by the pinned ledger.");
  }
  const combined: z.infer<typeof settledObservationSchema>[] = [...preserved, ...derived].toSorted((left, right) => (
    left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id)
  ));
  const ids = new Set<string>();
  let previous = Number.NEGATIVE_INFINITY;
  for (const observation of combined) {
    if (ids.has(observation.id)) throw new TypeError(`Duplicate merged observation ID: ${observation.id}.`);
    ids.add(observation.id);
    const observedAt = Date.parse(observation.observedAt);
    if (observedAt <= previous) throw new TypeError("Merged observations are not strictly chronological.");
    previous = observedAt;
  }
  assertAdjacentSettledHistory(combined);
  return combined;
}

function derivePublicData(
  data: PublicData,
  ledger: SubsidyLedger,
  generatedAt: string,
  pricing: PricingBasis,
  measurement: MeasurementBasis,
): PublicData {
  const derivedObservations = ledger.days.slice(GPT_SUBSIDY_ROLLING_DAYS - 1).map((day, derivedIndex) => {
    const index = derivedIndex + GPT_SUBSIDY_ROLLING_DAYS - 1;
    const window = ledger.days.slice(index - GPT_SUBSIDY_ROLLING_DAYS + 1, index + 1);
    if (window.length !== GPT_SUBSIDY_ROLLING_DAYS) {
      throw new TypeError("Ledger lacks a complete trailing window.");
    }
    const weekly = sumMoney(window.map(({ apiEquivalentUsd }) => apiEquivalentUsd));
    const endsAt = settledDayEnd(day.date);
    return settledObservationSchema.parse({
      id: `trailing-7d-${day.date}`,
      observedAt: endsAt,
      periodStartedAt: `${window[0]?.date}T00:00:00.000Z`,
      periodEndsAt: endsAt,
      status: "settled",
      tokens: sumTokenBuckets(window.map(({ tokens }) => tokens)),
      trailingSevenDayApiEquivalentUsd: weekly,
      accountAttribution: {
        status: "unavailable",
        distinctObservedAccounts: null,
        coverage: 0,
      },
      subscriptionAdjustedMultiple: null,
    });
  });
  const observations = mergeObservationHistory(data.observations, derivedObservations);
  const days = ledger.days.slice(-GPT_SUBSIDY_SUMMARY_DAYS);
  if (days.length !== GPT_SUBSIDY_SUMMARY_DAYS) {
    throw new TypeError(
      `Ledger lacks the latest ${String(GPT_SUBSIDY_SUMMARY_DAYS)} complete UTC days.`,
    );
  }
  const periodTokens = sumTokenBuckets(days.map(({ tokens }) => tokens));
  const periodValue = sumMoney(days.map(({ apiEquivalentUsd }) => apiEquivalentUsd));
  const lastDay = days.at(-1);
  if (lastDay === undefined) throw new TypeError("Ledger summary window is empty.");
  const retainedProxyModelIds = [
    ...new Set([
      ...data.pricing.proxyModelIds,
      ...ledger.pricingCoverage.proxyModelIds,
    ]),
  ].toSorted();
  const withoutLegacyAllowance = { ...data };
  delete withoutLegacyAllowance.currentAllowanceEstimate;
  return {
    ...withoutLegacyAllowance,
    generatedAt,
    plan: {
      name: "ChatGPT Pro",
      monthlyPriceUsd: 200,
      advertisedUsageMultiplier: 20,
      observedAt: PLAN_BASIS_OBSERVED_AT,
      sourceUrl: PLAN_SOURCE_URL,
    },
    pricing: {
      basis: "per-model-api-retail",
      manifest: {
        name: "AI Charts OpenAI rate manifest",
        schemaVersion: 1,
        sha256: pricing.sha256,
        frozenAt: pricing.frozenAt,
        sourceUrl: GPT_SUBSIDY_PRICING_MANIFEST_URL,
      },
      proxyModelIds: retainedProxyModelIds,
      referenceModel: pricing.referenceModel,
    },
    methodology: {
      deduplication: "tokscale-global-event-identity",
      measurement: {
        name: "AI Charts GPT subsidy measurement manifest",
        schemaVersion: 1,
        kind: measurement.kind,
        revision: measurement.revision,
        sha256: measurement.sha256,
        frozenAt: measurement.frozenAt,
        sourceUrl: GPT_SUBSIDY_MEASUREMENT_MANIFEST_URL,
      },
      formula: METHODOLOGY_FORMULA,
      disclaimer: METHODOLOGY_DISCLAIMER,
      sourceUrls: [
        PLAN_SOURCE_URL,
        CODEX_LIMITS_SOURCE_URL,
        GPT_SUBSIDY_MEASUREMENT_MANIFEST_URL,
        ...pricing.sourceUrls,
        TOKSCALE_PARSER_SOURCE_URL,
        TOKSCALE_DEDUPLICATION_SOURCE_URL,
      ],
    },
    observations,
    periodSummary: {
      startedAt: `${days[0]?.date}T00:00:00.000Z`,
      endedAt: settledDayEnd(lastDay.date),
      days: GPT_SUBSIDY_SUMMARY_DAYS,
      tokens: periodTokens,
      apiEquivalentUsd: periodValue,
    },
  };
}

function sameContent(left: PublicData, right: PublicData): boolean {
  return isDeepStrictEqual(
    { ...left, generatedAt: "" },
    { ...right, generatedAt: "" },
  );
}

export async function updateGptSubsidy(options: Options = {}): Promise<CollectorOutcome> {
  const now = options.now ?? (() => new Date());
  const generatedAtDate = now();
  const generatedAt = iso(generatedAtDate);
  const dataPath = options.dataPath ?? defaultDataPath;
  const current = parsePublicData(parseJson(await readFile(dataPath, "utf8"), "GPT subsidy data"));
  const expected = scanRangeForHistory(current.observations, utcDayStart(generatedAtDate));
  const [pricing, measurement] = await Promise.all([
    readPricingBasis(options.pricingPath ?? defaultPricingPath),
    readMeasurementBasis(options.measurementPath ?? defaultMeasurementPath),
  ]);
  assertExistingSeriesBasis(current, pricing, measurement);
  const ledger = options.ledger
    ? validateSubsidyLedger(options.ledger, expected, pricing, measurement)
    : await readLedger(expected, pricing, measurement);
  const next = derivePublicData(current, ledger, generatedAt, pricing, measurement);
  const changed = !sameContent(current, next);
  if (changed) await atomicWrite(dataPath, `${JSON.stringify(next, null, 2)}\n`);
  return {
    kind: changed ? "updated" : "unchanged",
    observationCount: (next.observations as unknown[]).length,
  };
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(await updateGptSubsidy())}\n`);
}
