import { rename } from "node:fs/promises";
import path from "node:path";
import { err, isRecord, ok, type Result } from "../lib/result";
import { parseResult, z } from "../lib/schema";
import {
  codingAgentRecordKey,
  parseCodingAgentSnapshot,
  type CodingAgentRecord,
  type CodingAgentSnapshot,
} from "../lib/coding-agent-data";

const SOURCE_URL = "https://artificialanalysis.ai/agents/coding-agents/";
const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "coding-agents.json");
const FLIGHT_PREFIX = "self.__next_f.push(";
const minimumRetentionRatio = 0.8;
const guardedMetrics = [
  "aaIndex",
  "deepSwe",
  "terminalBench",
  "sweAtlas",
  "costUsd",
  "durationSeconds",
  "totalTokens",
] as const;

const sourceMetricSchema = z.number().finite().nonnegative().nullable().optional();
const sourceRowSchema = z.object({
  id: z.string().min(1),
  agentName: z.string().min(1),
  provider: z.string().min(1),
  hostModelSlug: z.string().min(1),
  display: z.object({
    agent: z.string().min(1),
    model: z.string().min(1),
    creator: z.object({
      agent: z.string().min(1),
      model: z.string().min(1),
    }),
  }),
  displayLabel: z.string().min(1),
  indexComponentCount: z.number().int().nonnegative(),
  evalCount: z.number().int().nonnegative(),
  indexScore: sourceMetricSchema,
  evals: z.array(z.object({
    datasetIndexName: z.string().min(1),
    mean: z.object({ reward: sourceMetricSchema }),
  })),
  mean: z.object({
    costUsd: sourceMetricSchema,
    agentWallTimeSec: sourceMetricSchema,
    totalTokens: sourceMetricSchema,
  }),
});

type SourceRow = z.infer<typeof sourceRowSchema>;

const effortRank: Record<string, number> = {
  default: 0,
  none: 1,
  light: 2,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  "extra high": 5,
  max: 6,
  ultra: 7,
};

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseJson(value: string, context: string): Result<unknown, Error> {
  try {
    const parsed: unknown = JSON.parse(value);
    return ok(parsed);
  } catch (cause) {
    return err(new Error(`Could not parse ${context}.`, { cause }));
  }
}

function extractJsonArray(source: string, marker: string): Result<unknown[], Error> {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return err(new Error(`Source payload did not contain ${marker}.`));
  const start = markerIndex + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === undefined) break;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        const parsed = parseJson(source.slice(start, index + 1), marker);
        if (!parsed.ok) return parsed;
        return Array.isArray(parsed.value) ? ok(parsed.value) : err(new Error(`${marker} was not an array.`));
      }
    }
  }
  return err(new Error(`Source payload ended before ${marker} was complete.`));
}

function flightPayloads(html: string): Result<string[], Error> {
  const payloads: string[] = [];
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu;
  for (const match of html.matchAll(scriptPattern)) {
    const rawScript = match[1];
    if (rawScript === undefined) continue;
    const script = decodeHtmlEntities(rawScript.trim());
    if (!script.startsWith(FLIGHT_PREFIX) || !script.endsWith(")")) continue;
    const parsed = parseJson(script.slice(FLIGHT_PREFIX.length, -1), "Next.js Flight script");
    if (!parsed.ok) return parsed;
    if (!Array.isArray(parsed.value) || typeof parsed.value[1] !== "string") continue;
    payloads.push(parsed.value[1]);
  }
  return payloads.length > 0 ? ok(payloads) : err(new Error("No Next.js Flight payloads were found in the source page."));
}

function parseFlightRecord(payload: string): Result<{ id: string; value: unknown } | null, Error> {
  const separator = payload.indexOf(":");
  if (separator <= 0) return ok(null);
  const id = payload.slice(0, separator);
  const body = payload.slice(separator + 1);
  if (!(body.startsWith("[") || body.startsWith("{"))) return ok(null);
  const parsed = parseJson(body, `Flight record ${id}`);
  return parsed.ok ? ok({ id, value: parsed.value }) : ok(null);
}

function resolveFlightReference(reference: string, records: ReadonlyMap<string, unknown>): Result<unknown, Error> {
  const [recordId, ...segments] = reference.slice(1).split(":");
  if (recordId === undefined) return err(new Error(`Invalid Flight reference ${reference}.`));
  let current: unknown = records.get(recordId);
  if (current === undefined) return err(new Error(`Flight reference ${reference} targets a missing record.`));

  for (const segment of segments) {
    if (segment === "props" && Array.isArray(current)) {
      current = current[3];
    } else if (/^\d+$/u.test(segment) && Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return err(new Error(`Flight reference ${reference} could not resolve segment ${segment}.`));
    }
    if (current === undefined) return err(new Error(`Flight reference ${reference} resolved to undefined.`));
  }
  return ok(current);
}

export function extractSourceRows(html: string): Result<SourceRow[], Error> {
  const payloadResult = flightPayloads(html);
  if (!payloadResult.ok) return payloadResult;
  const payloads = payloadResult.value;
  const rowPayload = payloads.find((payload) => payload.includes('"benchmarkRows":['));
  if (rowPayload === undefined) return err(new Error("The source page did not expose benchmarkRows."));
  const rawRowsResult = extractJsonArray(rowPayload, '"benchmarkRows":');
  if (!rawRowsResult.ok) return rawRowsResult;

  const records = new Map<string, unknown>();
  for (const payload of payloads) {
    const parsedRecord = parseFlightRecord(payload);
    if (parsedRecord.ok && parsedRecord.value !== null) records.set(parsedRecord.value.id, parsedRecord.value.value);
  }

  const resolvedRows: unknown[] = [];
  for (const row of rawRowsResult.value) {
    if (typeof row === "string" && row.startsWith("$")) {
      const resolved = resolveFlightReference(row, records);
      if (!resolved.ok) return resolved;
      resolvedRows.push(resolved.value);
    } else {
      resolvedRows.push(row);
    }
  }

  const result = parseResult(z.array(sourceRowSchema).min(10), resolvedRows);
  return result.ok ? ok(result.value) : err(new Error(`Source rows changed shape: ${result.error.message}`, { cause: result.error }));
}

function valueOrNull(value: number | null | undefined): number | null {
  return value ?? null;
}

function benchmarkScore(row: SourceRow, dataset: string): number | null {
  const evaluation = row.evals.find((item) => item.datasetIndexName === dataset);
  const reward = evaluation?.mean.reward;
  return reward === undefined || reward === null ? null : reward * 100;
}

function providerId(providerName: string): string {
  return providerName.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_|_$/gu, "");
}

function extractSetting(modelLabel: string): { model: string; setting: string; settingRank: number } {
  const matches = Array.from(modelLabel.matchAll(/\(([^()]+)\)/gu));
  const effortMatch = matches
    .map((match) => match[1]?.trim().toLowerCase())
    .findLast((value) => value !== undefined && effortRank[value] !== undefined);
  const setting = effortMatch ?? "default";
  const suffix = effortMatch === undefined ? "" : `(${effortMatch})`;
  const model = suffix === ""
    ? modelLabel
    : modelLabel.replace(new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"), "").replace(/\s{2,}/gu, " ").trim();
  return { model, setting, settingRank: effortRank[setting] ?? 0 };
}

export function normalizeSourceRows(rows: readonly SourceRow[], retrievedAt: string): CodingAgentSnapshot {
  const records: CodingAgentRecord[] = rows.map((row) => {
    const setting = extractSetting(row.display.model);
    return {
      id: row.id,
      agent: row.display.agent,
      model: setting.model,
      modelLabel: row.display.model,
      providerId: providerId(row.display.creator.model),
      providerName: row.display.creator.model,
      seriesId: `${row.agentName}:${row.hostModelSlug}`,
      seriesLabel: `${row.display.agent} · ${setting.model}`,
      setting: setting.setting,
      settingRank: setting.settingRank,
      completeIndex: row.indexComponentCount === 3 && row.evalCount === 3,
      benchmarks: {
        aaIndex: row.indexScore === undefined || row.indexScore === null ? null : row.indexScore * 100,
        deepSwe: benchmarkScore(row, "deep-swe"),
        terminalBench: benchmarkScore(row, "terminal-bench-v2"),
        sweAtlas: benchmarkScore(row, "swe-atlas-qna"),
      },
      economics: {
        costUsd: valueOrNull(row.mean.costUsd),
        durationSeconds: valueOrNull(row.mean.agentWallTimeSec),
      },
      usage: { totalTokens: valueOrNull(row.mean.totalTokens) },
    };
  });

  records.sort((left, right) => left.seriesLabel.localeCompare(right.seriesLabel) || left.settingRank - right.settingRank || left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    source: {
      name: "Artificial Analysis",
      url: SOURCE_URL,
      retrievedAt,
      method: "next-flight",
    },
    records,
  };
}

function metricValue(record: CodingAgentRecord, metric: (typeof guardedMetrics)[number]): number | null {
  if (metric === "aaIndex") return record.benchmarks.aaIndex;
  if (metric === "deepSwe") return record.benchmarks.deepSwe;
  if (metric === "terminalBench") return record.benchmarks.terminalBench;
  if (metric === "sweAtlas") return record.benchmarks.sweAtlas;
  if (metric === "costUsd") return record.economics.costUsd;
  if (metric === "durationSeconds") return record.economics.durationSeconds;
  return record.usage.totalTokens;
}

function minimumRetained(previousCount: number): number {
  return Math.ceil(previousCount * minimumRetentionRatio);
}

export function validateSnapshotUpdate(
  previous: CodingAgentSnapshot,
  candidate: CodingAgentSnapshot,
): Result<void, Error> {
  const seenIds = new Set<string>();
  const seenStableKeys = new Set<string>();
  for (const record of candidate.records) {
    if (seenIds.has(record.id)) return err(new Error(`Refreshed snapshot contains duplicate row id ${record.id}.`));
    seenIds.add(record.id);

    const stableKey = codingAgentRecordKey(record);
    if (seenStableKeys.has(stableKey)) {
      return err(new Error(`Refreshed snapshot contains duplicate series/setting ${record.seriesId} / ${record.setting}.`));
    }
    seenStableKeys.add(stableKey);
  }

  const minimumRecordCount = minimumRetained(previous.records.length);
  if (candidate.records.length < minimumRecordCount) {
    return err(new Error(
      `Refreshed snapshot dropped from ${previous.records.length} to ${candidate.records.length} rows; minimum safe count is ${minimumRecordCount}.`,
    ));
  }

  const previousStableKeys = new Set(previous.records.map(codingAgentRecordKey));
  const retainedStableKeys = candidate.records.filter((record) => previousStableKeys.has(codingAgentRecordKey(record))).length;
  const minimumStableKeyCount = minimumRetained(previousStableKeys.size);
  if (retainedStableKeys < minimumStableKeyCount) {
    return err(new Error(
      `Refreshed snapshot retained ${retainedStableKeys} of ${previousStableKeys.size} stable series/setting keys; minimum safe overlap is ${minimumStableKeyCount}.`,
    ));
  }

  for (const metric of guardedMetrics) {
    const previousCoverage = previous.records.filter((record) => metricValue(record, metric) !== null).length;
    const candidateCoverage = candidate.records.filter((record) => metricValue(record, metric) !== null).length;
    const minimumCoverage = minimumRetained(previousCoverage);
    if (candidateCoverage < minimumCoverage) {
      return err(new Error(
        `Refreshed snapshot reduced ${metric} coverage from ${previousCoverage} to ${candidateCoverage}; minimum safe coverage is ${minimumCoverage}.`,
      ));
    }
  }

  return ok(undefined);
}

async function fetchSource(): Promise<Result<string, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(SOURCE_URL, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "codingchart-data-refresh/1.0 (+https://codingchart.com)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
      return ok(await response.text());
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error("Could not download Artificial Analysis after 3 attempts.", { cause: lastError }));
}

async function validateCommittedSnapshot(): Promise<Result<CodingAgentSnapshot, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseCodingAgentSnapshot(input);
    return parsed.ok ? ok(parsed.value) : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function refresh(): Promise<Result<CodingAgentSnapshot, Error>> {
  const previous = await validateCommittedSnapshot();
  if (!previous.ok) return previous;
  const source = await fetchSource();
  if (!source.ok) return source;
  const rows = extractSourceRows(source.value);
  if (!rows.ok) return rows;
  const snapshot = normalizeSourceRows(rows.value, new Date().toISOString());
  const validated = parseCodingAgentSnapshot(snapshot);
  if (!validated.ok) return err(new Error(`Normalized snapshot is invalid: ${validated.error.message}`, { cause: validated.error }));
  const safeUpdate = validateSnapshotUpdate(previous.value, validated.value);
  if (!safeUpdate.ok) return safeUpdate;

  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(validated.value, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
  return ok(validated.value);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly ? await validateCommittedSnapshot() : await refresh();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const verb = checkOnly ? "Validated" : "Refreshed";
    console.log(`${verb} ${result.value.records.length} coding-agent variants in data/coding-agents.json.`);
  }
}
