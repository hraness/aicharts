import { createHash, randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  VALS_ADMITTED_BENCHMARKS,
  VALS_DATASET_TYPE,
  valsBenchmarkUrl,
  valsSnapshotSchema,
  type ValsAdmittedBenchmark,
  type ValsBenchmarkSnapshot,
  type ValsSnapshot,
} from "../lib/benchmark-atlas-vals-data";
import { z } from "../lib/schema";

const OUTPUT = path.join(import.meta.dir, "..", "data", "benchmark-atlas-vals.json");
const MAX_BYTES = 12_000_000;

/**
 * Vals benchmark pages are server-rendered Astro. Each page inlines its complete board in
 * the `props` attribute of the island whose `component-url` names `BenchmarkView`, using
 * Astro's `[typeTag, value]` client serialization. Reading that attribute is the whole
 * import; there is no second request and no derived value.
 */
const ISLAND = /<astro-island\b[^>]*?component-url="([^"]*)"[^>]*?props="([^"]*)"/gu;

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#34;": "\"", "&apos;": "'", "&#39;": "'",
};

/** Decode the attribute's entity set exactly once; replacement text is never re-scanned. */
export function decodeAttribute(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#34|#39);/gu, entity => HTML_ENTITIES[entity]);
}

/** Undo Astro's `[typeTag, value]` client props encoding. Tag 1 marks an array. */
export function unwrapAstroProps(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number") {
    const [tag, inner] = value as [number, unknown];
    if (tag === 1) return Array.isArray(inner) ? inner.map(unwrapAstroProps) : [];
    return unwrapAstroProps(inner);
  }
  if (Array.isArray(value)) return value.map(unwrapAstroProps);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unwrapAstroProps(entry)]));
  }
  return value;
}

export function extractBenchmarkViewProps(html: string): unknown {
  const matches = [...html.matchAll(ISLAND)].filter(match => /\bBenchmarkView\b/u.test(decodeAttribute(match[1])));
  if (matches.length !== 1) throw new Error(`Expected exactly one BenchmarkView island; found ${matches.length}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeAttribute(matches[0][2]));
  } catch (cause) {
    throw new Error("BenchmarkView island props are not JSON.", { cause });
  }
  return unwrapAstroProps(parsed);
}

const tokenTotalsSchema = z.object({
  input_tokens: z.number().finite().nonnegative().nullish(),
  output_tokens: z.number().finite().nonnegative().nullish(),
  reasoning_tokens: z.number().finite().nonnegative().nullish(),
  cache_read_tokens: z.number().finite().nonnegative().nullish(),
  cache_write_tokens: z.number().finite().nonnegative().nullish(),
});

const resultSchema = z.object({
  accuracy: z.number().finite().min(0).max(100),
  stderr: z.number().finite().nonnegative().max(100),
  latency: z.number().finite().nonnegative().nullish(),
  cost_per_test: z.number().finite().nonnegative().nullish(),
  provider: z.string().trim().min(1),
  harness: z.string().trim().min(1).nullish(),
  reasoning_effort: z.string().trim().min(1).nullish(),
  compute_effort: z.string().trim().min(1).nullish(),
  token_totals: tokenTotalsSchema.nullish(),
});

const metadataSchema = z.object({
  benchmark: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  description: z.string().trim().min(1),
  family: z.string().trim().min(1),
  version: z.union([z.string().trim().min(1), z.number()]).transform(String),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  dataset_type: z.string(),
  industry: z.string().trim().min(1),
  mode: z.enum(["agentic", "one-shot"]),
  runner: z.string().trim().min(1),
  use_cost_per_test: z.boolean(),
  archived: z.boolean(),
  total_models: z.number().int().positive(),
  tasks: z.record(z.string(), z.string().trim().min(1)),
});

const viewSchema = z.object({
  metadata: metadataSchema,
  tasks: z.record(z.string(), z.record(z.string(), resultSchema)),
});

const propsSchema = z.object({
  benchmarkView: z.object({ default: viewSchema }).or(viewSchema.transform(view => ({ default: view }))),
});

/** A model id is an opaque publisher identifier; only its shape is checked. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/u;

function observationId(modelId: string): string {
  const id = modelId.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (id === "") throw new Error(`Model id has no usable characters: ${modelId}.`);
  return id;
}

/**
 * Task ids containing `__` are a breakdown of another headline metric, so they would double
 * count against the per-domain components. Only the top-level named tasks are retained.
 */
export function componentTaskIds(tasks: Readonly<Record<string, string>>): string[] {
  return Object.keys(tasks).filter(id => id !== "overall" && !id.includes("__"));
}

export function extractBenchmark(
  html: string,
  admitted: ValsAdmittedBenchmark,
  source: ValsBenchmarkSnapshot["source"],
): ValsBenchmarkSnapshot {
  const view = propsSchema.parse(extractBenchmarkViewProps(html)).benchmarkView.default;
  const { metadata, tasks } = view;
  if (metadata.slug !== admitted.slug) throw new Error(`Page ${admitted.slug} now identifies as ${metadata.slug}.`);
  if (metadata.archived) throw new Error(`Vals archived ${admitted.slug}; withdraw it rather than refreshing it.`);
  if (metadata.dataset_type !== VALS_DATASET_TYPE) {
    throw new Error(`Vals ${admitted.slug} is now a ${metadata.dataset_type} board. A Vals re-run of someone else's benchmark is a different system from that benchmark owner's leaderboard and is not admitted here.`);
  }
  const overall = tasks.overall;
  if (overall === undefined) throw new Error(`Vals ${admitted.slug} no longer publishes an overall score.`);

  const componentIds = componentTaskIds(metadata.tasks);
  const costBasis = metadata.use_cost_per_test ? "cost-per-test" : "unavailable";
  const rows = Object.entries(overall).map(([modelId, result]) => {
    if (!MODEL_ID.test(modelId)) throw new Error(`Unexpected model identifier shape: ${modelId}.`);
    const components = componentIds.flatMap(taskId => {
      const score = tasks[taskId]?.[modelId]?.accuracy;
      return score === undefined ? [] : [{ id: taskId, label: metadata.tasks[taskId], score }];
    });
    return {
      id: observationId(modelId),
      modelId,
      provider: result.provider,
      effort: result.reasoning_effort ?? result.compute_effort ?? null,
      harness: result.harness ?? null,
      score: result.accuracy,
      standardError: result.stderr,
      costUsdPerTest: costBasis === "cost-per-test" ? result.cost_per_test ?? null : null,
      latencySeconds: result.latency ?? null,
      components,
    };
  }).sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (rows.length !== metadata.total_models) {
    throw new Error(`Vals ${admitted.slug} reports ${metadata.total_models} models but published ${rows.length} overall rows.`);
  }

  return {
    slug: admitted.slug,
    benchmarkId: admitted.benchmarkId,
    name: metadata.benchmark,
    description: metadata.description,
    family: metadata.family,
    version: metadata.version,
    industry: metadata.industry,
    datasetType: VALS_DATASET_TYPE,
    mode: metadata.mode,
    runner: metadata.runner,
    costBasis,
    totalModels: metadata.total_models,
    source: { ...source, observedAt: new Date(`${metadata.updated}T00:00:00.000Z`).toISOString() },
    rows,
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "AICharts/1.0 (+https://aicharts.io)" },
  });
  if (!response.ok || !response.body) throw new Error(`Source failed with HTTP ${response.status}: ${url}.`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Source exceeded byte limit.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) throw new Error("Source exceeded byte limit.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || !["--check", "--refresh"].includes(args[0])) {
    throw new Error("Use --check (offline validation) or --refresh (reviewed source refresh).");
  }
  if (args[0] === "--check") {
    const checked = valsSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    const rows = checked.benchmarks.reduce((sum, benchmark) => sum + benchmark.rows.length, 0);
    console.log(`Vals atlas: ${rows} checked observations across ${checked.benchmarks.length} private boards.`);
    return;
  }

  const retrievedAt = new Date().toISOString();
  const benchmarks: ValsBenchmarkSnapshot[] = [];
  for (const admitted of VALS_ADMITTED_BENCHMARKS) {
    const url = valsBenchmarkUrl(admitted.slug);
    const html = await fetchText(url);
    benchmarks.push(extractBenchmark(html, admitted, {
      url,
      retrievedAt,
      sha256: createHash("sha256").update(html).digest("hex"),
      observedAt: null,
      revision: `${admitted.family} v${admitted.version}`,
    }));
  }
  const next = valsSnapshotSchema.parse({ schemaVersion: 1, benchmarks });

  if (await Bun.file(OUTPUT).exists()) {
    const previous = valsSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    for (const before of previous.benchmarks) {
      const after = next.benchmarks.find(benchmark => benchmark.slug === before.slug);
      if (after === undefined) throw new Error(`Refusing to drop admitted board ${before.slug}.`);
      const missing = before.rows.filter(row => !after.rows.some(candidate => candidate.id === row.id));
      if (missing.length > 0) throw new Error(`Refusing disappearing ${before.slug} observations: ${missing.map(row => row.id).join(", ")}.`);
      if (before.source.observedAt && after.source.observedAt && after.source.observedAt < before.source.observedAt) {
        throw new Error(`Refusing ${before.slug} publication-date regression.`);
      }
    }
    // A successful unchanged read is not a new observation and must not churn the snapshot.
    const rowsOf = (snapshot: ValsSnapshot) => JSON.stringify(snapshot.benchmarks.map(benchmark => [benchmark.slug, benchmark.rows]));
    if (rowsOf(next) === rowsOf(previous)) { console.log("Vals atlas unchanged."); return; }
  }

  const temporary = `${OUTPUT}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temporary, OUTPUT);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log("Updated Vals atlas observations; review the diff before publishing.");
}

if (import.meta.main) await main(process.argv.slice(2));
