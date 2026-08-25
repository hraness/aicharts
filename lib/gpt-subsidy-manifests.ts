import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const GPT_SUBSIDY_MEASUREMENT_MANIFEST_URL =
  "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-measurement.json" as const;
export const GPT_SUBSIDY_PRICING_MANIFEST_URL =
  "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-pricing.json" as const;
export const TOKSCALE_VERSION = "4.13.0" as const;
export const TOKSCALE_COMMIT =
  "0149a44329fb89865837dde40adb8cd9bc06bead" as const;
export const GPT_SUBSIDY_ROLLING_DAYS = 7 as const;
export const GPT_SUBSIDY_SUMMARY_DAYS = 31 as const;
export const GPT_SUBSIDY_WEEKS_PER_MONTH = 4.348125 as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const modelIdSchema = z.string().min(1).max(256).refine(
  value => value.trim() === value,
  "Model IDs cannot have surrounding whitespace",
);
const positiveMoneySchema = z.number().finite().positive();
const officialSourceSchema = z.string().url().refine(
  value => value.startsWith("https://developers.openai.com/"),
  "Model rates must cite an official OpenAI developer URL",
);

const rateSchema = z.object({
  input: positiveMoneySchema,
  cachedInput: positiveMoneySchema,
  cacheWrite: positiveMoneySchema.nullable(),
  output: positiveMoneySchema,
}).strict();

const longContextSchema = z.object({
  thresholdInputTokens: z.literal(272_000),
  billingScope: z.literal("full-request"),
  inputMultiplier: z.literal(2),
  cachedInputMultiplier: z.literal(2),
  cacheWriteMultiplier: z.literal(2),
  outputMultiplier: z.literal(1.5),
}).strict().nullable();

const modelFields = {
  modelId: modelIdSchema,
  sourceUrl: officialSourceSchema,
  rates: rateSchema,
  longContext: longContextSchema,
} as const;

export const gptSubsidyPricingManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("aicharts-openai-rate-manifest"),
  currency: z.literal("USD"),
  unit: z.literal("per-million-tokens"),
  frozenAt: z.string().datetime({ offset: true }),
  normalizationPolicy: z.string().trim().min(1),
  models: z.array(z.discriminatedUnion("pricingType", [
    z.object({
      ...modelFields,
      pricingType: z.literal("official"),
    }).strict(),
    z.object({
      ...modelFields,
      pricingType: z.literal("proxy"),
      proxyModelId: modelIdSchema,
      proxyRationale: z.string().trim().min(1),
    }).strict(),
  ])).min(1).max(128),
}).strict().superRefine((manifest, context) => {
  const modelIds = manifest.models.map(({ modelId }) => modelId);
  if (JSON.stringify(modelIds) !== JSON.stringify([...new Set(modelIds)].toSorted())) {
    context.addIssue({
      code: "custom",
      message: "Pricing manifest model IDs must be unique and sorted",
      path: ["models"],
    });
  }

  const modelsById = new Map(manifest.models.map(model => [model.modelId, model]));
  manifest.models.forEach((model, index) => {
    if (model.pricingType !== "proxy") return;
    const target = modelsById.get(model.proxyModelId);
    if (
      target === undefined
      || target.pricingType !== "official"
      || target.modelId === model.modelId
      || target.sourceUrl !== model.sourceUrl
      || JSON.stringify(target.rates) !== JSON.stringify(model.rates)
      || JSON.stringify(target.longContext) !== JSON.stringify(model.longContext)
    ) {
      context.addIssue({
        code: "custom",
        message: "Proxy source, rates, and long-context rules must exactly match an official target",
        path: ["models", index],
      });
    }
  });
});

const implementationFileSchema = z.object({
  path: z.enum([
    "lib/gpt-subsidy-manifests.ts",
    "scripts/aicharts_gpt_subsidy_ledger.rs",
    "scripts/update-gpt-subsidy.ts",
  ]),
  sha256: sha256Schema,
}).strict();

export const gptSubsidyMeasurementManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("aicharts-gpt-subsidy-measurement"),
  revision: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/u),
  frozenAt: z.string().datetime({ offset: true }),
  parser: z.object({
    name: z.literal("tokscale"),
    version: z.literal(TOKSCALE_VERSION),
    commit: z.literal(TOKSCALE_COMMIT),
  }).strict(),
  deduplication: z.literal("tokscale-global-event-identity"),
  calendar: z.literal("UTC"),
  rollingDays: z.literal(GPT_SUBSIDY_ROLLING_DAYS),
  periodSummaryDays: z.literal(GPT_SUBSIDY_SUMMARY_DAYS),
  weeksPerMonth: z.literal(GPT_SUBSIDY_WEEKS_PER_MONTH),
  planPriceUsd: z.literal(200),
  implementation: z.object({
    ledgerAdapter: implementationFileSchema,
    publicUpdater: implementationFileSchema,
    sharedContract: implementationFileSchema,
  }).strict(),
}).strict().superRefine((manifest, context) => {
  if (manifest.implementation.ledgerAdapter.path !== "scripts/aicharts_gpt_subsidy_ledger.rs") {
    context.addIssue({
      code: "custom",
      message: "Measurement manifest ledger adapter path is not canonical",
      path: ["implementation", "ledgerAdapter", "path"],
    });
  }
  if (manifest.implementation.publicUpdater.path !== "scripts/update-gpt-subsidy.ts") {
    context.addIssue({
      code: "custom",
      message: "Measurement manifest updater path is not canonical",
      path: ["implementation", "publicUpdater", "path"],
    });
  }
  if (manifest.implementation.sharedContract.path !== "lib/gpt-subsidy-manifests.ts") {
    context.addIssue({
      code: "custom",
      message: "Measurement manifest shared-contract path is not canonical",
      path: ["implementation", "sharedContract", "path"],
    });
  }
});

export type GptSubsidyPricingManifest = z.infer<typeof gptSubsidyPricingManifestSchema>;
export type GptSubsidyMeasurementManifest = z.infer<typeof gptSubsidyMeasurementManifestSchema>;

export function parseGptSubsidyPricingManifest(value: unknown): GptSubsidyPricingManifest {
  return gptSubsidyPricingManifestSchema.parse(value);
}

export function parseGptSubsidyMeasurementManifest(value: unknown): GptSubsidyMeasurementManifest {
  return gptSubsidyMeasurementManifestSchema.parse(value);
}

export function sha256(source: string | Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

export async function assertGptSubsidyMeasurementImplementation(
  manifest: GptSubsidyMeasurementManifest,
  repositoryRoot: string,
): Promise<void> {
  const entries = [
    manifest.implementation.ledgerAdapter,
    manifest.implementation.publicUpdater,
    manifest.implementation.sharedContract,
  ] as const;
  for (const entry of entries) {
    const sourcePath = path.resolve(repositoryRoot, entry.path);
    if (!sourcePath.startsWith(path.resolve(repositoryRoot) + path.sep)) {
      throw new Error(`Measurement implementation path escapes the repository: ${entry.path}.`);
    }
    const actual = sha256(await readFile(sourcePath));
    if (actual !== entry.sha256) {
      throw new Error(
        `Measurement implementation hash drifted for ${entry.path}. `
        + "Recompute the complete retained series through a deliberate measurement migration.",
      );
    }
  }
}
