import { createHash, randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "../lib/schema";
import { reasoningSnapshotSchema, type ReasoningSnapshot } from "../lib/benchmark-atlas-reasoning-data";

const OUTPUT = path.join(import.meta.dir, "..", "data", "benchmark-atlas-reasoning.json");
const ARC2 = "https://arcprize.org/media/data/leaderboard/v2.json";
const ARC3 = "https://arcprize.org/media/data/leaderboard/v3.json";
const RESEARCH = "https://agentresearchlab.com/benchmarks/deepresearch-bench-ii/index.html";
const MEMORY = "https://xiaowu0162.github.io/longmemeval-v2/";
const MAX_BYTES = 2_000_000;

// Bounded editorial selections, not an automatic mirror of a provider's complete board.
const ARC2_GROUPS = ["openai-gpt-6-astra", "openai-gpt-5-6-sol", "anthropic-claude-opus-5", "anthropic-claude-fable-5-1", "google-gemini-3-7-flash", "deepseek-v4-pro-0813", "moonshot-kimi-k3"] as const;
const ARC3_GROUPS = ["openai-gpt-6-astra", "openai-gpt-5-6-sol", "anthropic-claude-opus-5"] as const;
const DR_MODELS = ["AI21-DeepResearch", "Dalpha DeepResearch", "iFlow-Researcher", "Xiaoyi DeepResearch 6.0", "nvidia-aiq (Nemotron 3, Opus 4.6)", "OpenAI-GPT-o3 Deep Research", "Gemini-3-Pro Deep Research", "Perplexity Research", "Tongyi Deep Research"] as const;
const MEMORY_MODELS = ["No retrieval", "RAG: query to slice", "RAG: query to slice + notes", "AgentRunbook-R", "Codex", "AgentRunbook-C"] as const;

const arcPayloadSchema = z.object({
  version: z.enum(["v2", "v3"]), generatedAt: z.iso.datetime(),
  evaluations: z.array(z.unknown()).min(1).max(1000),
});
const arcRowSchema = z.object({
    datasetId: z.string(), modelId: z.string().min(1), modelDisplayName: z.string().min(1),
    modelGroup: z.string().min(1), modelType: z.string(), providerDisplayName: z.string().min(1),
    score: z.number().finite().min(0).max(1), cost: z.number().finite().nonnegative().nullish(),
    resultsUrl: z.string(), display: z.boolean(),
});

export function extractArcRows(input: unknown, version: "v2" | "v3", adapter = false): ReasoningSnapshot["arc2"]["rows"] {
  const payload = arcPayloadSchema.parse(input);
  if (payload.version !== version) throw new Error("ARC benchmark version changed.");
  const groups: readonly string[] = version === "v2" ? ARC2_GROUPS : adapter ? ["openai-gpt-6-astra-provider-adapter"] : ARC3_GROUPS;
  const selected = payload.evaluations.flatMap(input => {
    const candidate = z.object({ modelGroup: z.string().nullable() }).safeParse(input);
    if (!candidate.success || candidate.data.modelGroup === null || !groups.includes(candidate.data.modelGroup)) return [];
    return [arcRowSchema.parse(input)];
  });
  for (const group of groups) if (!selected.some(row => row.modelGroup === group)) throw new Error(`Missing selected ARC group: ${group}.`);
  return selected.map(row => {
    if (row.datasetId !== `${version}_Semi_Private` || !row.display || row.modelType !== "CoT") throw new Error(`Changed ARC evaluation contract: ${row.modelId}.`);
    const effort = row.modelDisplayName.match(/\((Max|XHigh|High|Medium|Low|None)\)$/u)?.[1];
    if (!effort || !/^\/results\/[a-z0-9-]+$/u.test(row.resultsUrl)) throw new Error(`Missing ARC configuration provenance: ${row.modelId}.`);
    if (version === "v2" && row.cost != null) throw new Error("Selected ARC-AGI-2 cohort now publishes cost; review its basis before admission.");
    return {
      id: row.modelId, label: row.modelDisplayName,
      model: row.modelDisplayName.replace(/ - Provider Adapter/u, "").replace(/ \([^)]+\)$/u, ""),
      provider: row.providerDisplayName, effort, score: row.score * 100,
      costUsd: row.cost ?? null, sourceUrl: `https://arcprize.org${row.resultsUrl}`,
    };
  }).sort((a, b) => a.id.localeCompare(b.id, "en"));
}

function textOnly(value: string): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/&amp;/gu, "&").replace(/&nbsp;/gu, " ").replace(/\s+/gu, " ").trim();
}

function tableHeaders(table: string): string[] {
  const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/u)?.[1] ?? "";
  return [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map(cell => textOnly(cell[1]));
}

function requireOrderedHeaders(table: string, expected: readonly string[], benchmark: string): void {
  const actual = tableHeaders(table);
  if (actual.length !== expected.length || actual.some((header, index) => header !== expected[index])) {
    throw new Error(`${benchmark} table headers changed; review metric names and column order.`);
  }
}

export function extractResearchRows(html: string): ReasoningSnapshot["deepResearch"]["rows"] {
  if (!html.includes("9,430") || !html.includes("132") || !html.includes("InfoRecall") || !html.includes("TotalScore")) throw new Error("DeepResearch Bench II protocol changed.");
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gu)].map(match => match[1]).filter(table => tableHeaders(table).some(header => header === "InfoRecall" || header === "TotalScore"));
  if (tables.length !== 1) throw new Error("DeepResearch Bench II table headers changed or became ambiguous.");
  const table = tables[0];
  requireOrderedHeaders(table, ["#", "Model", "InfoRecall", "Analysis", "Presentation", "TotalScore"], "DeepResearch Bench II");
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gu)].flatMap(match => {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gu)].map(cell => cell[1]);
    if (cells.length !== 6) return [];
    const names = [...cells[1].matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gu)].map(cell => textOnly(cell[1]));
    const label = names[0];
    if (!label || !(DR_MODELS as readonly string[]).includes(label)) return [];
    const scores = cells.slice(2).map(textOnly);
    if (scores.some(score => !/^\d+(?:\.\d+)?$/u.test(score))) throw new Error(`Malformed research score: ${label}.`);
    const [recall, analysis, presentation, total] = scores.map(Number);
    const provider = names[1]?.split(" · ")[0].replace(/,\s*20\d{2}$/u, "").trim() || "Not specified";
    return [{ id: label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/-$/u, ""), label, provider, recall, analysis, presentation, total }];
  });
  if (rows.length !== DR_MODELS.length || DR_MODELS.some(model => !rows.some(row => row.label === model))) throw new Error("Selected research systems changed or disappeared.");
  return rows.sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export function extractMemoryRows(html: string): ReasoningSnapshot["memory"]["rows"] {
  const tables = [...html.matchAll(/<table\b[^>]*class="[^"]*results-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gu)].map(match => match[1]);
  if (tables.length !== 1 || !html.includes("451") || !html.includes("115M")) throw new Error("LongMemEval-V2 results contract changed.");
  const table = tables[0];
  requireOrderedHeaders(table, ["Method", "Family", "Small Overall", "Small Latency", "Medium Overall", "Medium Latency"], "LongMemEval-V2");
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gu)].flatMap(match => {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gu)].map(cell => textOnly(cell[1]));
    if (cells.length !== 6) return [];
    const [label, family, sa, sl, ma, ml] = cells;
    if (!(MEMORY_MODELS as readonly string[]).includes(label)) throw new Error(`Unreviewed memory baseline: ${label}.`);
    if (![sa, ma].every(value => /^\d+(?:\.\d+)?%$/u.test(value)) || ![sl, ml].every(value => /^\d+(?:\.\d+)?s$/u.test(value))) throw new Error(`Memory units changed: ${label}.`);
    return [{ id: label.toLowerCase().replace(/[^a-z0-9]+/gu, "-"), label, family, smallAccuracy: Number(sa.slice(0, -1)), smallLatencySeconds: Number(sl.slice(0, -1)), mediumAccuracy: Number(ma.slice(0, -1)), mediumLatencySeconds: Number(ml.slice(0, -1)) }];
  });
  if (rows.length !== MEMORY_MODELS.length) throw new Error("Memory baseline count changed.");
  return rows.sort((a, b) => a.id.localeCompare(b.id, "en"));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "AICharts/1.0 (+https://aicharts.io)" } });
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
  if (args.length !== 1 || !["--check", "--refresh"].includes(args[0])) throw new Error("Use --check (offline validation) or --refresh (reviewed source refresh).");
  if (args[0] === "--check") {
    const checked = reasoningSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    console.log(`Reasoning atlas: ${[checked.arc2, checked.arc3Standard, checked.arc3Adapter, checked.deepResearch, checked.memory].reduce((sum, section) => sum + section.rows.length, 0)} checked source observations.`);
    return;
  }
  const [arc2Text, arc3Text, researchText, memoryText] = await Promise.all([ARC2, ARC3, RESEARCH, MEMORY].map(fetchText));
  const arc2 = arcPayloadSchema.parse(JSON.parse(arc2Text));
  const arc3 = arcPayloadSchema.parse(JSON.parse(arc3Text));
  const retrievedAt = new Date().toISOString();
  const source = (url: string, text: string, observedAt: string | null, revision: string | null = null) => ({ url, retrievedAt, observedAt, revision, sha256: createHash("sha256").update(text).digest("hex") });
  const next = reasoningSnapshotSchema.parse({
    schemaVersion: 1,
    arc2: { source: source(ARC2, arc2Text, arc2.generatedAt), rows: extractArcRows(arc2, "v2") },
    arc3Standard: { source: source(ARC3, arc3Text, arc3.generatedAt), rows: extractArcRows(arc3, "v3") },
    arc3Adapter: { source: source(ARC3, arc3Text, arc3.generatedAt), rows: extractArcRows(arc3, "v3", true) },
    deepResearch: { source: source(RESEARCH, researchText, null), rows: extractResearchRows(researchText) },
    memory: { source: source(MEMORY, memoryText, null, "Paper baselines; evaluation code 2cc8c540bdb87fe6761629b585e727e1c4704520"), rows: extractMemoryRows(memoryText) },
  });
  if (await Bun.file(OUTPUT).exists()) {
    const previous = reasoningSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    for (const key of ["arc2", "arc3Standard", "arc3Adapter", "deepResearch", "memory"] as const) {
      const before = previous[key];
      const after = next[key];
      if (before.rows.some(row => !after.rows.some(candidate => candidate.id === row.id))) throw new Error(`Refusing disappearing ${key} observations.`);
      if (before.source.observedAt && after.source.observedAt && after.source.observedAt < before.source.observedAt) throw new Error(`Refusing ${key} timestamp regression.`);
    }
    // A successful unchanged read is not a new data observation or SEO modification.
    const unchanged = Object.entries(next).every(([key, value]) => {
      if (key === "schemaVersion") return true;
      const prev = previous[key as keyof Omit<ReasoningSnapshot, "schemaVersion">];
      return JSON.stringify((value as typeof prev).rows) === JSON.stringify(prev.rows);
    });
    if (unchanged) { console.log("Reasoning atlas unchanged."); return; }
  }
  const temporary = `${OUTPUT}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temporary, OUTPUT);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log("Updated bounded reasoning atlas observations; review the diff before publishing.");
}

if (import.meta.main) await main(process.argv.slice(2));
