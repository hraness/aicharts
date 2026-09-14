import { rename } from "node:fs/promises";
import path from "node:path";

import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "../lib/coding-agent-data";
import {
  DEEP_SWE_EVIDENCE_SOURCE_URL,
  deriveDeepSweEvidenceSnapshot,
  parseDeepSweEvidenceSnapshot,
  parseDeepSweSourceSnapshot,
  validateDeepSweEvidenceReplacement,
  type DeepSweEvidenceSnapshot,
} from "../lib/deep-swe-evidence";
import {
  MODEL_RELEASE_SOURCE_URL,
  parseOpenRouterModelsResponse,
  type OpenRouterModel,
} from "../lib/model-release-data";
import { err, ok, type Result } from "../lib/result";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "deep-swe-evidence.json");
const BENCHMARK_PATH = path.join(import.meta.dir, "..", "data", "coding-agents.json");

async function readBenchmarkSnapshot(): Promise<Result<CodingAgentSnapshot, Error>> {
  try {
    const input: unknown = await Bun.file(BENCHMARK_PATH).json();
    const parsed = parseCodingAgentSnapshot(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${BENCHMARK_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    return err(new Error(`Could not read ${BENCHMARK_PATH}.`, { cause }));
  }
}

async function readCommittedEvidence(): Promise<Result<DeepSweEvidenceSnapshot, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseDeepSweEvidenceSnapshot(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function fetchJson(url: string, sourceName: string): Promise<Result<unknown, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "aicharts-deepswe-evidence/1.0 (+https://aicharts.io)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${sourceName} returned HTTP ${response.status}.`);
      const body: unknown = await response.json();
      return ok(body);
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error(`Could not download ${sourceName} after 3 attempts.`, { cause: lastError }));
}

async function writeCommittedEvidence(snapshot: DeepSweEvidenceSnapshot): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
}

type DeepSweEvidenceRefreshDependencies = Readonly<{
  fetchJson: typeof fetchJson;
  now: () => string;
  readBenchmarkSnapshot: typeof readBenchmarkSnapshot;
  readCommittedEvidence: typeof readCommittedEvidence;
  warn: (message: string) => void;
  writeCommittedEvidence: typeof writeCommittedEvidence;
}>;

const defaultRefreshDependencies: DeepSweEvidenceRefreshDependencies = {
  fetchJson,
  now: () => new Date().toISOString(),
  readBenchmarkSnapshot,
  readCommittedEvidence,
  warn: message => console.warn(message),
  writeCommittedEvidence,
};

export async function validateCommittedDeepSweEvidence(): Promise<Result<DeepSweEvidenceSnapshot, Error>> {
  return readCommittedEvidence();
}

export async function refreshDeepSweEvidence(
  overrides: Partial<DeepSweEvidenceRefreshDependencies> = {},
): Promise<Result<DeepSweEvidenceSnapshot, Error>> {
  const dependencies = { ...defaultRefreshDependencies, ...overrides };
  const previous = await dependencies.readCommittedEvidence();
  if (!previous.ok) return previous;
  const benchmark = await dependencies.readBenchmarkSnapshot();
  if (!benchmark.ok) return benchmark;

  // OpenRouter is the live primary catalog. During an outage or partial response,
  // checked exact identities remain stable and AAI resolves only unseen models.
  const identityAttemptedAt = dependencies.now();
  const openRouterSource = await dependencies.fetchJson(MODEL_RELEASE_SOURCE_URL, "OpenRouter");
  let openRouterModels: readonly OpenRouterModel[] = [];
  let identityRetrievedAt: string | null = null;
  if (openRouterSource.ok) {
    const parsedOpenRouterModels = parseOpenRouterModelsResponse(openRouterSource.value);
    if (parsedOpenRouterModels.ok) {
      openRouterModels = parsedOpenRouterModels.value;
      identityRetrievedAt = dependencies.now();
    } else {
      dependencies.warn(
        `OpenRouter models changed shape; preserving checked identities and using AAI for new models: ${parsedOpenRouterModels.error.message}`,
      );
    }
  } else {
    dependencies.warn(
      `OpenRouter identity lookup failed; preserving checked identities and using AAI for new models: ${openRouterSource.error.message}`,
    );
  }

  const deepSweSource = await dependencies.fetchJson(
    DEEP_SWE_EVIDENCE_SOURCE_URL,
    "DataCurve DeepSWE",
  );
  if (!deepSweSource.ok) return deepSweSource;
  const parsedDeepSweSource = parseDeepSweSourceSnapshot(deepSweSource.value);
  if (!parsedDeepSweSource.ok) {
    return err(new Error(
      `DataCurve DeepSWE changed shape: ${parsedDeepSweSource.error.message}`,
      { cause: parsedDeepSweSource.error },
    ));
  }

  const retrievedAt = dependencies.now();
  const derived = deriveDeepSweEvidenceSnapshot(
    parsedDeepSweSource.value,
    openRouterModels,
    benchmark.value,
    retrievedAt,
    identityRetrievedAt,
    identityAttemptedAt,
    previous.value,
  );
  const validated = parseDeepSweEvidenceSnapshot(derived);
  if (!validated.ok) {
    return err(new Error(
      `Normalized DeepSWE evidence is invalid: ${validated.error.message}`,
      { cause: validated.error },
    ));
  }
  const safeReplacement = validateDeepSweEvidenceReplacement(previous.value, validated.value);
  if (!safeReplacement.ok) return safeReplacement;

  await dependencies.writeCommittedEvidence(validated.value);
  return ok(validated.value);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedDeepSweEvidence()
    : await refreshDeepSweEvidence();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const openRouterCount = result.value.records.filter(
      record => record.identity.source === "openrouter",
    ).length;
    const aaiCount = result.value.records.length - openRouterCount;
    const verb = checkOnly ? "Validated" : "Refreshed";
    console.log(
      `${verb} ${result.value.records.length} direct DeepSWE configurations `
      + `(${openRouterCount} OpenRouter identities, ${aaiCount} AAI fallbacks, `
      + `${result.value.unmatchedModels.length} unmatched models) in data/deep-swe-evidence.json.`,
    );
  }
}
