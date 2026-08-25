import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseGptSubsidySnapshot } from "../lib/gpt-subsidy-data";
import {
  assertGptSubsidyMeasurementImplementation,
  parseGptSubsidyMeasurementManifest,
  parseGptSubsidyPricingManifest,
  sha256,
} from "../lib/gpt-subsidy-manifests";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const defaultDataPath = path.join(repositoryRoot, "data", "gpt-subsidy.json");
const defaultPricingPath = path.join(repositoryRoot, "data", "gpt-subsidy-pricing.json");
const defaultMeasurementPath = path.join(
  repositoryRoot,
  "data",
  "gpt-subsidy-measurement.json",
);

type CheckOptions = Readonly<{
  dataPath?: string;
  measurementPath?: string;
  pricingPath?: string;
  repositoryRoot?: string;
}>;

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (cause) {
    throw new Error(`${label} is not valid JSON.`, { cause });
  }
}

export async function checkGptSubsidyData(
  options: CheckOptions = {},
): Promise<Readonly<{
  measurementSha256: string;
  observationCount: number;
  pricingSha256: string;
}>> {
  const dataPath = options.dataPath ?? defaultDataPath;
  const pricingPath = options.pricingPath ?? defaultPricingPath;
  const measurementPath = options.measurementPath ?? defaultMeasurementPath;
  const [dataSource, pricingSource, measurementSource] = await Promise.all([
    readFile(dataPath, "utf8"),
    readFile(pricingPath),
    readFile(measurementPath),
  ]);

  const parsedSnapshot = parseGptSubsidySnapshot(
    parseJson(dataSource, "GPT subsidy data"),
  );
  if (!parsedSnapshot.ok) {
    throw new Error(`GPT subsidy data is invalid: ${parsedSnapshot.error.message}`, {
      cause: parsedSnapshot.error,
    });
  }

  const pricingManifest = parseGptSubsidyPricingManifest(
    parseJson(pricingSource.toString("utf8"), "GPT subsidy pricing manifest"),
  );
  const measurementManifest = parseGptSubsidyMeasurementManifest(
    parseJson(measurementSource.toString("utf8"), "GPT subsidy measurement manifest"),
  );
  await assertGptSubsidyMeasurementImplementation(
    measurementManifest,
    options.repositoryRoot ?? repositoryRoot,
  );

  const pricingSha256 = sha256(pricingSource);
  const measurementSha256 = sha256(measurementSource);
  if (parsedSnapshot.value.pricing.manifest.sha256 !== pricingSha256) {
    throw new Error(
      "GPT subsidy data claims a pricing-manifest hash that differs from the checked manifest bytes.",
    );
  }
  if (parsedSnapshot.value.pricing.manifest.frozenAt !== pricingManifest.frozenAt) {
    throw new Error(
      "GPT subsidy data claims a pricing-manifest freeze time that differs from the checked manifest.",
    );
  }
  const publishedMeasurement = parsedSnapshot.value.methodology.measurement;
  if (
    publishedMeasurement.sha256 !== measurementSha256
    || publishedMeasurement.frozenAt !== measurementManifest.frozenAt
    || publishedMeasurement.revision !== measurementManifest.revision
  ) {
    throw new Error(
      "GPT subsidy data claims a measurement basis that differs from the checked measurement manifest.",
    );
  }
  if (
    parsedSnapshot.value.methodology.weeksPerMonth !== measurementManifest.weeksPerMonth
    || parsedSnapshot.value.plan.monthlyPriceUsd !== measurementManifest.planPriceUsd
  ) {
    throw new Error("GPT subsidy public math differs from the checked measurement manifest.");
  }

  const referenceModel = pricingManifest.models.find(
    model => model.modelId === "gpt-5.6-sol" && model.pricingType === "official",
  );
  if (
    referenceModel === undefined
    || referenceModel.rates.input !== parsedSnapshot.value.pricing.referenceModel.uncachedInputPerMillionUsd
    || referenceModel.rates.cachedInput !== parsedSnapshot.value.pricing.referenceModel.cachedInputPerMillionUsd
    || referenceModel.rates.output !== parsedSnapshot.value.pricing.referenceModel.outputPerMillionUsd
    || referenceModel.sourceUrl !== parsedSnapshot.value.pricing.referenceModel.sourceUrl
  ) {
    throw new Error("GPT subsidy reference-model rates differ from the checked pricing manifest.");
  }
  const manifestProxyIds = new Set(pricingManifest.models
    .filter(model => model.pricingType === "proxy")
    .map(model => model.modelId));
  const unknownProxy = parsedSnapshot.value.pricing.proxyModelIds.find(
    modelId => !manifestProxyIds.has(modelId),
  );
  if (unknownProxy !== undefined) {
    throw new Error(`GPT subsidy data discloses an unknown proxy-priced model: ${unknownProxy}.`);
  }

  return {
    measurementSha256,
    observationCount: parsedSnapshot.value.observations.length,
    pricingSha256,
  };
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(await checkGptSubsidyData())}\n`);
}
