import { rename } from "node:fs/promises";
import path from "node:path";
import type { CodingAgentSnapshot } from "../lib/coding-agent-data";
import { parseCodingAgentSnapshot } from "../lib/coding-agent-data";
import {
  MODEL_RELEASE_LIMIT,
  MODEL_RELEASE_SOURCE_URL,
  MODEL_RELEASE_WINDOW_DAYS,
  modelReleaseProviderIds,
  modelReleaseSemanticKey,
  parseModelReleaseRadar,
  parseOpenRouterModelsResponse,
  type ModelRelease,
  type ModelReleaseListing,
  type ModelReleaseProviderId,
  type ModelReleaseRadar,
  type ModelReleaseStatus,
  type OpenRouterModel,
} from "../lib/model-release-data";
import { err, ok, type Result } from "../lib/result";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "model-release-radar.json");
const BENCHMARK_PATH = path.join(import.meta.dir, "..", "data", "coding-agents.json");
const millisecondsPerDay = 24 * 60 * 60 * 1_000;

type ProviderPolicy = Readonly<{
  providerId: ModelReleaseProviderId;
  providerName: string;
}>;

const providerByOpenRouterAuthor: Readonly<Record<string, ProviderPolicy>> = {
  anthropic: { providerId: "anthropic", providerName: "Anthropic" },
  deepseek: { providerId: "deepseek", providerName: "DeepSeek" },
  google: { providerId: "google", providerName: "Google" },
  meta: { providerId: "meta", providerName: "Meta" },
  "meta-llama": { providerId: "meta", providerName: "Meta" },
  moonshotai: { providerId: "moonshot_ai", providerName: "Moonshot AI" },
  openai: { providerId: "openai", providerName: "OpenAI" },
  qwen: { providerId: "alibaba_cloud", providerName: "Alibaba Cloud" },
  "x-ai": { providerId: "xai", providerName: "xAI" },
  "z-ai": { providerId: "z_ai", providerName: "Z.ai" },
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort(compareText);
}

function openRouterAuthor(id: string): string | null {
  if (id.startsWith("~") || id.includes(":")) return null;
  const separator = id.indexOf("/");
  if (separator <= 0 || separator === id.length - 1 || id.indexOf("/", separator + 1) !== -1) return null;
  return id.slice(0, separator);
}

function displayModelName(name: string): string {
  const separator = name.indexOf(":");
  return (separator === -1 ? name : name.slice(separator + 1)).trim();
}

function benchmarkedModelKeys(snapshot: CodingAgentSnapshot): Set<string> {
  const providerIds = new Set<string>(modelReleaseProviderIds);
  return new Set(snapshot.records.flatMap((record) => (
    providerIds.has(record.providerId)
      ? [modelReleaseSemanticKey(record.providerId as ModelReleaseProviderId, record.model)]
      : []
  )));
}

function releaseStatus(
  providerId: ModelReleaseProviderId,
  model: string,
  benchmarked: ReadonlySet<string>,
): ModelReleaseStatus {
  return benchmarked.has(modelReleaseSemanticKey(providerId, model))
    ? "benchmarked"
    : "awaiting-benchmark";
}

function candidateRelease(
  source: OpenRouterModel,
  benchmarked: ReadonlySet<string>,
  earliestCreated: number,
  retrievedAt: number,
): ModelRelease | null {
  const author = openRouterAuthor(source.id);
  if (author === null) return null;
  const provider = providerByOpenRouterAuthor[author];
  if (provider === undefined || source.canonicalSlug === null) return null;
  if (source.canonicalSlug.startsWith("~") || source.canonicalSlug.includes(":")) return null;
  if (!source.architecture.outputModalities.includes("text")) return null;
  if (!source.supportedParameters.includes("tools")) return null;

  const sourceAddedAtMilliseconds = source.created * 1_000;
  if (sourceAddedAtMilliseconds < earliestCreated || sourceAddedAtMilliseconds > retrievedAt) return null;
  const model = displayModelName(source.name);
  if (model === "") return null;

  return {
    capabilities: {
      inputModalities: uniqueSorted(source.architecture.inputModalities),
      outputModalities: uniqueSorted(source.architecture.outputModalities),
      supportsTools: true,
    },
    canonicalSlug: source.canonicalSlug,
    id: source.id,
    model,
    modelUrl: `https://openrouter.ai/${source.id}`,
    providerId: provider.providerId,
    providerName: provider.providerName,
    sourceAddedAt: new Date(sourceAddedAtMilliseconds).toISOString(),
    status: releaseStatus(provider.providerId, model, benchmarked),
  };
}

function releaseListing(release: ModelRelease): ModelReleaseListing {
  return {
    id: release.id,
    model: release.model,
    providerId: release.providerId,
    sourceAddedAt: release.sourceAddedAt,
  };
}

function compareReleaseListings(
  left: ModelReleaseListing,
  right: ModelReleaseListing,
): number {
  return Date.parse(right.sourceAddedAt) - Date.parse(left.sourceAddedAt)
    || compareText(left.id, right.id);
}

/**
 * Builds a bounded current radar while retaining every previously observed listing.
 * It never supplies chart scores or publishes model cards.
 */
export function deriveModelReleaseRadar(
  sourceModels: readonly OpenRouterModel[],
  benchmarkSnapshot: CodingAgentSnapshot,
  retrievedAt: string,
  previousListings: readonly ModelReleaseListing[] = [],
): ModelReleaseRadar {
  const retrievedAtMilliseconds = Date.parse(retrievedAt);
  if (!Number.isFinite(retrievedAtMilliseconds)) {
    throw new Error(`Invalid release-radar retrieval timestamp ${retrievedAt}.`);
  }
  const earliestCreated = retrievedAtMilliseconds - MODEL_RELEASE_WINDOW_DAYS * millisecondsPerDay;
  const benchmarked = benchmarkedModelKeys(benchmarkSnapshot);
  const releasesById = new Map<string, ModelRelease>();

  for (const sourceModel of sourceModels) {
    const release = candidateRelease(
      sourceModel,
      benchmarked,
      earliestCreated,
      retrievedAtMilliseconds,
    );
    if (release === null) continue;
    const existing = releasesById.get(release.id);
    if (existing === undefined || compareText(release.canonicalSlug, existing.canonicalSlug) < 0) {
      releasesById.set(release.id, release);
    }
  }

  const currentCandidates = Array.from(releasesById.values()).sort((left, right) => (
    Date.parse(right.sourceAddedAt) - Date.parse(left.sourceAddedAt)
    || compareText(left.id, right.id)
  ));
  const observedListingsById = new Map(
    previousListings.map(listing => [listing.id, listing]),
  );
  for (const release of currentCandidates) {
    observedListingsById.set(release.id, releaseListing(release));
  }
  const observedListings = [...observedListingsById.values()]
    .sort(compareReleaseListings);
  const releases = currentCandidates.slice(0, MODEL_RELEASE_LIMIT);

  return {
    schemaVersion: 2,
    source: {
      method: "models-api",
      name: "OpenRouter",
      retrievedAt: new Date(retrievedAtMilliseconds).toISOString(),
      timestampMeaning: "source-added-at",
      url: MODEL_RELEASE_SOURCE_URL,
    },
    policy: {
      limit: MODEL_RELEASE_LIMIT,
      providers: [...modelReleaseProviderIds],
      publication: "discovery-only",
      requires: ["text-output", "tools"],
      windowDays: MODEL_RELEASE_WINDOW_DAYS,
    },
    observedListings,
    releases,
  };
}

export function validateModelReleaseRadarStatuses(
  radar: ModelReleaseRadar,
  benchmarkSnapshot: CodingAgentSnapshot,
): Result<void, Error> {
  const benchmarked = benchmarkedModelKeys(benchmarkSnapshot);
  for (const release of radar.releases) {
    const expected = releaseStatus(release.providerId, release.model, benchmarked);
    if (release.status !== expected) {
      return err(new Error(
        `Release ${release.id} is marked ${release.status}, but the checked benchmark snapshot requires ${expected}.`,
      ));
    }
  }
  return ok(undefined);
}

export function reconcileModelReleaseRadarStatuses(
  radar: ModelReleaseRadar,
  benchmarkSnapshot: CodingAgentSnapshot,
): ModelReleaseRadar {
  const benchmarked = benchmarkedModelKeys(benchmarkSnapshot);
  return {
    ...radar,
    releases: radar.releases.map(release => ({
      ...release,
      status: releaseStatus(release.providerId, release.model, benchmarked),
    })),
  };
}

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

/** Reads the prior ledger without comparing its snapshot-relative statuses. */
async function readCommittedModelReleaseRadar(): Promise<Result<ModelReleaseRadar, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseModelReleaseRadar(input);
    if (!parsed.ok) {
      return err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
    }
    return ok(parsed.value);
  } catch (cause) {
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

export async function validateCommittedModelReleaseRadar(): Promise<Result<ModelReleaseRadar, Error>> {
  const radar = await readCommittedModelReleaseRadar();
  if (!radar.ok) return radar;
  try {
    const benchmark = await readBenchmarkSnapshot();
    if (!benchmark.ok) return benchmark;
    const statuses = validateModelReleaseRadarStatuses(radar.value, benchmark.value);
    return statuses.ok ? radar : statuses;
  } catch (cause) {
    return err(new Error(`Could not validate ${OUTPUT_PATH}.`, { cause }));
  }
}

async function reconcileCommittedModelReleaseRadar(): Promise<Result<ModelReleaseRadar, Error>> {
  const radar = await readCommittedModelReleaseRadar();
  if (!radar.ok) return radar;
  try {
    const benchmark = await readBenchmarkSnapshot();
    if (!benchmark.ok) return benchmark;
    const reconciled = reconcileModelReleaseRadarStatuses(radar.value, benchmark.value);
    const validated = parseModelReleaseRadar(reconciled);
    if (!validated.ok) {
      return err(new Error(`Reconciled release radar is invalid: ${validated.error.message}`, { cause: validated.error }));
    }

    const temporaryPath = `${OUTPUT_PATH}.tmp`;
    await Bun.write(temporaryPath, `${JSON.stringify(validated.value, null, 2)}\n`);
    await rename(temporaryPath, OUTPUT_PATH);
    return ok(validated.value);
  } catch (cause) {
    return err(new Error(`Could not reconcile ${OUTPUT_PATH}.`, { cause }));
  }
}

async function fetchSource(): Promise<Result<unknown, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(MODEL_RELEASE_SOURCE_URL, {
        headers: {
          accept: "application/json",
          "user-agent": "aicharts-release-radar/1.0 (+https://aicharts.io)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
      const body: unknown = await response.json();
      return ok(body);
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error("Could not download OpenRouter after 3 attempts.", { cause: lastError }));
}

async function refresh(): Promise<Result<ModelReleaseRadar, Error>> {
  const previous = await readCommittedModelReleaseRadar();
  if (!previous.ok) return previous;
  const benchmark = await readBenchmarkSnapshot();
  if (!benchmark.ok) return benchmark;
  const source = await fetchSource();
  if (!source.ok) return source;
  const parsedSource = parseOpenRouterModelsResponse(source.value);
  if (!parsedSource.ok) {
    return err(new Error(`OpenRouter models changed shape: ${parsedSource.error.message}`, { cause: parsedSource.error }));
  }
  const radar = deriveModelReleaseRadar(
    parsedSource.value,
    benchmark.value,
    new Date().toISOString(),
    previous.value.observedListings,
  );
  const validated = parseModelReleaseRadar(radar);
  if (!validated.ok) {
    return err(new Error(`Normalized release radar is invalid: ${validated.error.message}`, { cause: validated.error }));
  }
  const statuses = validateModelReleaseRadarStatuses(validated.value, benchmark.value);
  if (!statuses.ok) return statuses;

  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(validated.value, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
  return ok(validated.value);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const reconcileOnly = Bun.argv.includes("--reconcile");
  if (checkOnly && reconcileOnly) throw new Error("Choose only one release-radar mode.");
  const result = checkOnly
    ? await validateCommittedModelReleaseRadar()
    : reconcileOnly ? await reconcileCommittedModelReleaseRadar() : await refresh();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const awaiting = result.value.releases.filter(({ status }) => status === "awaiting-benchmark").length;
    const verb = checkOnly ? "Validated" : reconcileOnly ? "Reconciled" : "Refreshed";
    console.log(
      `${verb} ${result.value.releases.length} tracked model releases (${awaiting} awaiting comparable benchmark data) in data/model-release-radar.json.`,
    );
  }
}
