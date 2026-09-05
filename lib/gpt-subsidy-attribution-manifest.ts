import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const GPT_SUBSIDY_ATTRIBUTION_MANIFEST_URL =
  "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-attribution-measurement.json" as const;
export const GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL = 1e-10;

const implementationFileSchema = z.object({
  path: z.enum([
    "lib/gpt-subsidy-attribution-manifest.ts",
    "lib/gpt-subsidy-data.ts",
    "scripts/enrich-gpt-subsidy-attribution.ts",
    "scripts/publish-gpt-subsidy.ts",
  ]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();

export const gptSubsidyAttributionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("aicharts-gpt-subsidy-account-attribution"),
  revision: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/u),
  frozenAt: z.string().datetime({ offset: true }),
  calendar: z.literal("UTC"),
  accountLedgerVersion: z.literal(1),
  rateLimitLedgerVersion: z.literal(1),
  verifiedPlanType: z.literal("pro"),
  planVerification: z.literal(
    "all-overlapping-observations-have-only-pro-buckets",
  ),
  coverage: z.literal("positive-duration-account-interval-union"),
  coverageQuantization: z.literal(
    "whole-percentage-point-lower-bound",
  ),
  subOnePercentCoverageSentinel: z.literal(
    GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL,
  ),
  maximumPublishedCoverage: z.literal(0.99),
  statusSemantics: z.literal("partial-means-sampled-never-complete"),
  continuity: z.literal(
    "private-key-epoch-and-fixed-window-monotonic-floors",
  ),
  implementation: z.object({
    contract: implementationFileSchema,
    publicContract: implementationFileSchema,
    enricher: implementationFileSchema,
    publisher: implementationFileSchema,
  }).strict(),
}).strict().superRefine((manifest, context) => {
  if (
    manifest.implementation.contract.path
      !== "lib/gpt-subsidy-attribution-manifest.ts"
  ) {
    context.addIssue({
      code: "custom",
      message: "Attribution contract path is not canonical",
      path: ["implementation", "contract", "path"],
    });
  }
  if (
    manifest.implementation.publicContract.path !== "lib/gpt-subsidy-data.ts"
  ) {
    context.addIssue({
      code: "custom",
      message: "Attribution public-contract path is not canonical",
      path: ["implementation", "publicContract", "path"],
    });
  }
  if (
    manifest.implementation.enricher.path
      !== "scripts/enrich-gpt-subsidy-attribution.ts"
  ) {
    context.addIssue({
      code: "custom",
      message: "Attribution enricher path is not canonical",
      path: ["implementation", "enricher", "path"],
    });
  }
  if (
    manifest.implementation.publisher.path !== "scripts/publish-gpt-subsidy.ts"
  ) {
    context.addIssue({
      code: "custom",
      message: "Attribution publisher path is not canonical",
      path: ["implementation", "publisher", "path"],
    });
  }
});

export type GptSubsidyAttributionManifest = z.infer<
  typeof gptSubsidyAttributionManifestSchema
>;

export function parseGptSubsidyAttributionManifest(
  value: unknown,
): GptSubsidyAttributionManifest {
  return gptSubsidyAttributionManifestSchema.parse(value);
}

export function attributionSha256(source: string | Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

export async function assertGptSubsidyAttributionImplementation(
  manifest: GptSubsidyAttributionManifest,
  repositoryRoot: string,
): Promise<void> {
  for (const entry of [
    manifest.implementation.contract,
    manifest.implementation.publicContract,
    manifest.implementation.enricher,
    manifest.implementation.publisher,
  ]) {
    const sourcePath = path.resolve(repositoryRoot, entry.path);
    if (!sourcePath.startsWith(path.resolve(repositoryRoot) + path.sep)) {
      throw new Error(
        `Attribution implementation path escapes the repository: ${entry.path}.`,
      );
    }
    if (attributionSha256(await readFile(sourcePath)) !== entry.sha256) {
      throw new Error(
        `GPT subsidy attribution implementation hash drifted for ${entry.path}.`,
      );
    }
  }
}
