import { err, ok, type Result } from "../result";
import { METRIC_CATALOG } from "./metric-explorer-catalog";
import type { MetricValue } from "./metric-explorer-values";
import { richFactsFromSessions } from "./rich-fact-adapters";
import { RICH_FACT_MAX_BYTES, RICH_FACT_MAX_WINDOW_MS, type RichFact, type RichFactError, type RichFactReport, type RichSelection } from "./rich-fact-contract";
import { parseRichFactReport } from "./rich-facts";
import { evaluateRichMetricQuery, RICH_SUPPORTED_METRIC_IDS, type RichMetricMeasure, type RichMetricQuantity, type RichMetricReason } from "./rich-metric-explorer";
import { decodeSessionReport } from "./sessions";
import type { SessionProvider } from "./session-contract";
import { statsInteger, statsOwnRecord } from "./stats-contract";

/** Grouping dimensions for local session facts. Calendar dimensions need the
 * document's explicit time zone; a browser or host zone is never substituted. */
export const RICH_METRIC_DIMENSIONS = ["session", "provider", "model", "local-day", "hour-of-day"] as const;
export type RichMetricDimension = typeof RICH_METRIC_DIMENSIONS[number];
export const MAX_RICH_METRIC_DIMENSIONS = 2;
export const MAX_RICH_METRIC_TOP_K = 50;
export const MAX_RICH_HISTOGRAM_BINS = 16;
export const MAX_RICH_DRILLDOWN_ROWS = 50;
export const MAX_RICH_METRIC_GROUPS = 4_096;
export const RICH_DOCUMENT_TIME_ZONE_KEY = "timeZone";
const MAX_TIME = 8_640_000_000_000_000;
const catalog = new Map(METRIC_CATALOG.map(value => [value.id, value]));
const richIds = new Set(RICH_SUPPORTED_METRIC_IDS);

export type RichFactsDocument = Readonly<{
  report: RichFactReport;
  /** IANA zone declared by the document, or null when the producer declared none. */
  timeZone: string | null;
  origin: "rich-facts-v1" | "session-observations-v1";
  /** Stable identity of the admitted facts: source epoch, head count and highest revision. */
  revision: string;
}>;
export type RichExplorerFilters = Readonly<{ provider: "*" | SessionProvider; model: "*" | string; session: "*" | string }>;
export type RichExplorerQuery = Readonly<{
  schemaVersion: 1; metricId: string; quantity: RichMetricQuantity;
  selection: Omit<RichSelection, "executionId">;
  filters: RichExplorerFilters;
  groupBy: readonly RichMetricDimension[]; topK: number; timeZone: string | null;
}>;
export type RichExplorerReason = RichMetricReason | "time-zone-unknown" | "not-a-session-fact-metric" | "no-groups";
export type RichExplorerGroup = Readonly<{ key: string; dimensions: readonly string[]; label: string; measure: RichMetricMeasure; facts: number }>;
export type RichHistogramBin = Readonly<{ lower: bigint; upper: bigint; count: number }>;
export type RichDistributionView = Readonly<{
  measured: number; unmeasured: number; sum: bigint; mean: Readonly<{ numerator: bigint; denominator: bigint }> | null;
  minimum: bigint | null; p50: bigint | null; p90: bigint | null; p95: bigint | null; p99: bigint | null; maximum: bigint | null;
  bins: readonly RichHistogramBin[];
}>;
export type RichSample = Readonly<{ executionId: string; observationId: string; atMs: number; provider: SessionProvider; model: string | null; value: bigint | null; groupKey: string }>;
export type RichExplorerResult = Readonly<{
  schemaVersion: 1; profile: "rich-facts-v1"; revision: string; query: RichExplorerQuery;
  measure: RichMetricMeasure; reason: RichExplorerReason | null;
  groups: readonly RichExplorerGroup[]; totalGroups: number; omittedGroups: number;
  /** Present for distribution metrics only; count and rate metrics have no sample population. */
  distribution: RichDistributionView | null;
  samples: readonly RichSample[]; sampledFacts: number;
  facets: Readonly<{ providers: readonly SessionProvider[]; models: readonly string[]; sessions: readonly Readonly<{ executionId: string; provider: SessionProvider }>[] }>;
}>;
export const RICH_EXPLORER_REASON_TEXT: Readonly<Record<RichExplorerReason, string>> = Object.freeze({
  "not-implemented-in-profile": "This local profile does not retain the facts needed for this metric.",
  "unsupported-source-kind": "The loaded facts do not provide this kind of observation.",
  "different-grain": "Choose the observation grain used by this metric.",
  "no-measured-observations": "No exact observations are available in this selection.",
  "unclassified-request-outcomes": "Some request outcomes are unresolved, so this denominator is incomplete.",
  "zero-denominator": "The measured denominator is zero; no ratio is established.",
  "unknown_token_scope": "The source does not establish direct versus inclusive token scope.",
  "overlapping_executions": "Inclusive totals would overlap executions and are refused.",
  "incomplete_lineage": "The retained execution lineage is incomplete for this group.",
  "time-zone-unknown": "The loaded facts declare no time zone, so local-calendar and hour-of-day grouping is refused rather than guessed.",
  "not-a-session-fact-metric": "This metric is not evaluated from local session facts.",
  "no-groups": "No facts fall inside the selected filters.",
});

export function isRichTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/u.test(value)) return false;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone.toLowerCase() === value.toLowerCase(); } catch { return false; }
}
function revisionOf(report: RichFactReport): string {
  let highest = 0;
  for (const fact of report.facts) highest = Math.max(highest, fact.revision);
  return `${report.provenance.sourceId}:${report.facts.length}:${highest}`;
}
/** Admits a rich-facts-v1 document, optionally carrying a top-level explicit
 * `timeZone`, or a session-observations-v1 report adapted with an ephemeral
 * key. The adapted window is the sessions' union; longer spans are refused. */
export async function openRichFactsDocument(text: string): Promise<Result<RichFactsDocument, RichFactError | "session_window_limit">> {
  if (text.length > RICH_FACT_MAX_BYTES) return err("body_limit");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return err("invalid_rich_facts"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return err("invalid_rich_facts");
  const profile = Object.getOwnPropertyDescriptor(parsed, "profile")?.value;
  if (profile === "session-observations-v1") {
    const sessions = decodeSessionReport(text);
    if (sessions === null || sessions.sessions.length === 0) return err("invalid_rich_facts");
    let startMs = MAX_TIME, endMs = 0;
    for (const session of sessions.sessions) { startMs = Math.min(startMs, session.window.startMs); endMs = Math.max(endMs, session.window.endMs + 1); }
    if (endMs - startMs > RICH_FACT_MAX_WINDOW_MS) return err("session_window_limit");
    const adapted = await richFactsFromSessions(sessions, { key: crypto.getRandomValues(new Uint8Array(32)), sourceEpoch: "rich-explorer-v1", window: { startMs, endMs } });
    if (!adapted.ok) return adapted;
    return ok(Object.freeze({ report: adapted.value, timeZone: null, origin: "session-observations-v1", revision: revisionOf(adapted.value) }));
  }
  const zone = Object.getOwnPropertyDescriptor(parsed, RICH_DOCUMENT_TIME_ZONE_KEY);
  let timeZone: string | null = null;
  let body: unknown = parsed;
  if (zone !== undefined) {
    if (!("value" in zone) || !isRichTimeZone(zone.value)) return err("invalid_rich_facts");
    timeZone = zone.value;
    const rest: Record<string, unknown> = {};
    for (const key of Object.keys(parsed)) if (key !== RICH_DOCUMENT_TIME_ZONE_KEY) rest[key] = (parsed as Record<string, unknown>)[key];
    body = rest;
  }
  const report = parseRichFactReport(body);
  if (!report.ok) return report;
  return ok(Object.freeze({ report: report.value, timeZone, origin: "rich-facts-v1", revision: revisionOf(report.value) }));
}

export function parseRichExplorerQuery(input: unknown): RichExplorerQuery | null {
  try {
    const raw = statsOwnRecord(input, ["schemaVersion", "metricId", "quantity", "selection", "filters", "groupBy", "topK", "timeZone"]);
    const selection = raw && statsOwnRecord(raw.selection, ["window", "grain", "tokenScope", "lineage"]);
    const window = selection && statsOwnRecord(selection.window, ["startMs", "endMs"]);
    const filters = raw && statsOwnRecord(raw.filters, ["provider", "model", "session"]);
    if (!raw || !selection || !window || !filters || raw.schemaVersion !== 1 || typeof raw.metricId !== "string" || !catalog.has(raw.metricId)
      || typeof raw.quantity !== "string" || !["input", "output", "total", "reasoning", "cacheWriteUnknown"].includes(raw.quantity)
      || !statsInteger(window.startMs, 0, MAX_TIME) || !statsInteger(window.endMs, window.startMs + 1, Math.min(MAX_TIME, window.startMs + RICH_FACT_MAX_WINDOW_MS))
      || typeof selection.grain !== "string" || !["usage_observation", "request", "response", "turn", "session"].includes(selection.grain)
      || typeof selection.tokenScope !== "string" || !["direct", "inclusive", "unknown"].includes(selection.tokenScope)
      || typeof selection.lineage !== "string" || !["root", "child", "unknown", "all"].includes(selection.lineage)
      || (filters.provider !== "*" && !["codex", "claude_code", "devin"].includes(String(filters.provider)))
      || typeof filters.model !== "string" || filters.model.length === 0 || filters.model.length > 64
      || (filters.session !== "*" && (typeof filters.session !== "string" || !/^[0-9a-f]{32}$/u.test(filters.session)))
      || !Array.isArray(raw.groupBy) || raw.groupBy.length > MAX_RICH_METRIC_DIMENSIONS || new Set(raw.groupBy).size !== raw.groupBy.length
      || raw.groupBy.some(value => !RICH_METRIC_DIMENSIONS.includes(value as RichMetricDimension))
      || !statsInteger(raw.topK, 1, MAX_RICH_METRIC_TOP_K) || (raw.timeZone !== null && !isRichTimeZone(raw.timeZone))) return null;
    return Object.freeze({ schemaVersion: 1, metricId: raw.metricId, quantity: raw.quantity as RichMetricQuantity,
      selection: Object.freeze({ window: Object.freeze({ startMs: window.startMs, endMs: window.endMs }), grain: selection.grain as RichSelection["grain"],
        tokenScope: selection.tokenScope as RichSelection["tokenScope"], lineage: selection.lineage as RichSelection["lineage"] }),
      filters: Object.freeze({ provider: filters.provider as RichExplorerFilters["provider"], model: filters.model, session: filters.session as RichExplorerFilters["session"] }),
      groupBy: Object.freeze([...raw.groupBy] as RichMetricDimension[]), topK: raw.topK, timeZone: raw.timeZone as string | null });
  } catch { return null; }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneParts(timeZone: string, atMs: number): { day: string; hour: string } {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(atMs).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: `${(parts.hour === "24" ? "00" : parts.hour).padStart(2, "0")}:00` };
}
function heads(facts: readonly RichFact[]): RichFact[] {
  const latest = new Map<string, RichFact>();
  for (const fact of facts) { const previous = latest.get(fact.id); if (previous === undefined || fact.revision > previous.revision) latest.set(fact.id, fact); }
  return [...latest.values()];
}
const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;
const providerName = (provider: SessionProvider) => provider === "codex" ? "Codex" : provider === "devin" ? "Devin" : "Claude Code";
function dimensionValue(dimension: RichMetricDimension, fact: RichFact, timeZone: string | null): string {
  if (dimension === "session") return fact.owner.executionId;
  if (dimension === "provider") return fact.owner.provider;
  if (dimension === "model") return fact.value?.kind === "usage" ? fact.value.model ?? "unknown-model" : "not-a-usage-fact";
  if (timeZone === null) throw new Error("time-zone-unknown");
  const parts = zoneParts(timeZone, fact.atMs);
  return dimension === "local-day" ? parts.day : parts.hour;
}
function dimensionLabel(dimension: RichMetricDimension, value: string, provider: SessionProvider): string {
  if (dimension === "session") return `${providerName(provider)} · ${shortId(value)}`;
  if (dimension === "provider") return providerName(value as SessionProvider);
  if (dimension === "model") return value === "unknown-model" ? "Unknown model" : value === "not-a-usage-fact" ? "No model attribution" : value;
  return value;
}
function usageModel(fact: RichFact): string | null { return fact.value?.kind === "usage" ? fact.value.model : null; }
function matchesFilters(fact: RichFact, filters: RichExplorerFilters): boolean {
  if (filters.provider !== "*" && fact.owner.provider !== filters.provider) return false;
  if (filters.session !== "*" && fact.owner.executionId !== filters.session) return false;
  /* Model attribution exists on usage facts only, so a model filter admits nothing else. */
  if (filters.model !== "*" && usageModel(fact) !== filters.model) return false;
  return true;
}
type Sampler = (fact: RichFact, query: RichExplorerQuery) => bigint | null | undefined;
/** Mirrors the usage cohort of lib/usage/rich-facts.ts: one entry per execution and
 * observation at the selected grain; a request or turn without a usage fact at
 * that grain stays in the cohort as an unmeasured entry. */
function usageCohort(active: readonly RichFact[], query: RichExplorerQuery): readonly Readonly<{ fact: RichFact; usage: RichFact | null }>[] {
  const cohort = new Map<string, { fact: RichFact; usage: RichFact | null }>();
  const grain = query.selection.grain;
  for (const fact of active) {
    const v = fact.value!;
    const identity = `${fact.owner.executionId}:${v.kind === "usage" && v.grain === "session" ? fact.owner.executionId : v.observationId}`;
    if (v.kind === "usage" && v.grain === grain) {
      const entry = cohort.get(identity) ?? { fact, usage: null };
      if (v.tokenScope === query.selection.tokenScope) entry.usage = fact;
      cohort.set(identity, entry);
    } else if ((grain === "turn" && v.kind === "turn") || (grain === "request" && v.kind === "request")) {
      if (!cohort.has(identity)) cohort.set(identity, { fact, usage: null });
    }
  }
  return [...cohort.values()];
}
const tokenSum = (tokens: Extract<NonNullable<RichFact["value"]>, { kind: "usage" }>["tokens"], quantity: RichMetricQuantity): bigint | null => {
  const input = BigInt(tokens.inputUncached) + BigInt(tokens.cacheRead) + BigInt(tokens.cacheWrite5m) + BigInt(tokens.cacheWrite1h) + BigInt(tokens.cacheWriteUnknown);
  if (quantity === "input") return input;
  if (quantity === "output") return BigInt(tokens.output);
  if (quantity === "total") return input + BigInt(tokens.output);
  if (quantity === "reasoning") return tokens.reasoning === null ? null : BigInt(tokens.reasoning);
  return BigInt(tokens.cacheWriteUnknown);
};
const duration = (start: number | null, end: number | null, uncertain: number | null) => start !== null && end !== null && uncertain === 0 ? BigInt(end - start) : null;
/** Samples mirror the distribution cohorts of lib/usage/rich-metric-explorer.ts; the
 * equivalence test pins nearest-rank quantiles of these samples to its measures. */
function sampler(id: string): { sample: Sampler; quantity: "query" | RichMetricQuantity | null; grain: RichSelection["grain"] | null } | null {
  const usage = (grain: RichSelection["grain"] | null, quantity: "query" | RichMetricQuantity): ReturnType<typeof sampler> => ({ grain, quantity, sample: (fact, query) => {
    const value = fact.value;
    if (value?.kind !== "usage") return null;
    return tokenSum(value.tokens, quantity === "query" ? query.quantity : quantity);
  } });
  const match = /^mean-(input|output|total)-tokens-per-(request|response|turn|session)$/u.exec(id);
  if (match) return usage(match[2] as RichSelection["grain"], match[1] as RichMetricQuantity);
  if (id.startsWith("token-size-")) return usage(null, "query");
  if (id === "tokens-per-measured-turn") return usage("turn", "total");
  if (id.startsWith("request-latency-")) return { grain: null, quantity: null, sample: fact => fact.value?.kind === "request" ? duration(fact.value.dispatchedAtMs, fact.value.terminalAtMs, fact.value.clockUncertaintyMs) : undefined };
  if (id === "time-to-first-token") return { grain: null, quantity: null, sample: fact => fact.value?.kind === "request" ? duration(fact.value.dispatchedAtMs, fact.value.firstTokenAtMs, fact.value.clockUncertaintyMs) : undefined };
  if (id.startsWith("context-occupancy-") || id === "maximum-context-occupancy") return { grain: null, quantity: null, sample: fact => fact.value?.kind === "context" ? BigInt(fact.value.tokens) : undefined };
  if (id === "runtime-per-measured-turn") return { grain: null, quantity: null, sample: fact => fact.value?.kind === "turn" && fact.value.outcome === "completed" ? duration(fact.value.startedAtMs, fact.value.endedAtMs, fact.value.clockUncertaintyMs) : undefined };
  if (id === "observed-turn-duration") return { grain: null, quantity: null, sample: fact => fact.value?.kind === "turn" ? duration(fact.value.startedAtMs, fact.value.endedAtMs, fact.value.clockUncertaintyMs) : undefined };
  if (id === "compaction-duration") return { grain: null, quantity: null, sample: fact => fact.value?.kind === "compaction" && fact.value.outcome === "applied" ? BigInt(fact.value.durationMs) : undefined };
  if (id === "pre-compaction-context") return { grain: null, quantity: null, sample: fact => fact.value?.kind === "compaction" && fact.value.outcome === "applied" ? BigInt(fact.value.beforeTokens) : undefined };
  if (id === "post-compaction-context") return { grain: null, quantity: null, sample: fact => fact.value?.kind === "compaction" && fact.value.outcome === "applied" ? BigInt(fact.value.afterTokens) : undefined };
  return null;
}
export function richDistribution(values: readonly (bigint | null)[]): RichDistributionView {
  const measured = values.filter((value): value is bigint => value !== null).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const sum = measured.reduce((a, b) => a + b, 0n);
  const percentile = (n: number) => measured[Math.ceil(measured.length * n / 100) - 1] ?? null;
  const bins: RichHistogramBin[] = [];
  if (measured.length > 0) {
    const minimum = measured[0]!, maximum = measured.at(-1)!, span = maximum - minimum + 1n;
    const width = span <= BigInt(MAX_RICH_HISTOGRAM_BINS) ? 1n : (span + BigInt(MAX_RICH_HISTOGRAM_BINS) - 1n) / BigInt(MAX_RICH_HISTOGRAM_BINS);
    const count = Number((span + width - 1n) / width);
    for (let index = 0; index < count; index++) bins.push({ lower: minimum + width * BigInt(index), upper: minimum + width * BigInt(index + 1) - 1n, count: 0 });
    for (const value of measured) { const index = Number((value - minimum) / width); bins[index] = { ...bins[index]!, count: bins[index]!.count + 1 }; }
  }
  return Object.freeze({ measured: measured.length, unmeasured: values.length - measured.length, sum,
    mean: measured.length === 0 ? null : Object.freeze({ numerator: sum, denominator: BigInt(measured.length) }),
    minimum: measured[0] ?? null, p50: percentile(50), p90: percentile(90), p95: percentile(95), p99: percentile(99), maximum: measured.at(-1) ?? null,
    bins: Object.freeze(bins) });
}
function measureQuery(query: RichExplorerQuery, executionId: string | null) {
  return { schemaVersion: 1, quantity: query.quantity, metricIds: [query.metricId], selection: { ...query.selection, executionId } };
}
function unavailable(query: RichExplorerQuery, reason: RichExplorerReason): RichMetricMeasure {
  const definition = catalog.get(query.metricId)!;
  return Object.freeze({ id: query.metricId, version: 1, unit: definition.unit, value: null, status: "unavailable", reason: reason === "time-zone-unknown" || reason === "not-a-session-fact-metric" || reason === "no-groups" ? null : reason,
    cohort: "no evaluated cohort", aggregation: "count", measured: 0, unmeasured: 0, sourceKind: "usage", sourceCoverage: "unsupported" });
}
function rank(value: MetricValue | null): [bigint, bigint] { return value === null ? [-1n, 1n] : value.kind === "integer" ? [value.amount, 1n] : [value.numerator, value.denominator]; }
function compareValues(a: MetricValue | null, b: MetricValue | null): number {
  const [an, ad] = rank(a), [bn, bd] = rank(b), left = an * bd, right = bn * ad;
  return left < right ? 1 : left > right ? -1 : 0;
}

/** Evaluates one session-fact metric with bounded grouping, an exact sample
 * distribution and a drilldown population. Each group is re-admitted through
 * the profile parser on its own facts, so lineage evidence does not cross
 * group boundaries: an inclusive total whose parent execution falls in another
 * group is refused as incomplete lineage rather than assumed. */
export function evaluateRichExplorerQuery(document: RichFactsDocument, input: unknown): Result<RichExplorerResult, "invalid_rich_explorer_query" | RichFactError | "invalid_rich_metric_query"> {
  const query = parseRichExplorerQuery(input);
  if (query === null) return err("invalid_rich_explorer_query");
  const report = document.report;
  const base = { schemaVersion: 1 as const, profile: "rich-facts-v1" as const, revision: document.revision, query };
  const all = heads(report.facts);
  const providers = [...new Set(all.map(fact => fact.owner.provider))].sort();
  const models = [...new Set(all.map(usageModel).filter((model): model is string => model !== null))].sort();
  const sessions = [...new Map(all.map(fact => [fact.owner.executionId, fact.owner.provider])).entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([executionId, provider]) => Object.freeze({ executionId, provider }));
  const facets = Object.freeze({ providers: Object.freeze(providers), models: Object.freeze(models), sessions: Object.freeze(sessions) });
  const empty = (reason: RichExplorerReason) => ok(Object.freeze({ ...base, measure: unavailable(query, reason), reason, groups: Object.freeze([]), totalGroups: 0, omittedGroups: 0, distribution: null, samples: Object.freeze([]), sampledFacts: 0, facets }));
  if (!richIds.has(query.metricId)) return empty("not-a-session-fact-metric");
  if (query.groupBy.some(dimension => dimension === "local-day" || dimension === "hour-of-day") && query.timeZone === null) return empty("time-zone-unknown");
  const inWindow = all.filter(fact => fact.atMs >= query.selection.window.startMs && fact.atMs < query.selection.window.endMs && matchesFilters(fact, query.filters));
  if (inWindow.length === 0) return empty("no-groups");
  const selected = inWindow;
  const subReport = (facts: readonly RichFact[]) => ({ ...report, window: query.selection.window, facts });
  const evaluate = (facts: readonly RichFact[]) => {
    const scoped = facts.filter(fact => fact.atMs >= query.selection.window.startMs && fact.atMs < query.selection.window.endMs);
    return evaluateRichMetricQuery(subReport(scoped), measureQuery(query, null));
  };
  const overall = evaluate(selected);
  if (!overall.ok) return overall;
  const measure = overall.value.measures[0]!;
  const partitions = new Map<string, { dimensions: string[]; label: string; facts: RichFact[] }>();
  for (const fact of selected) {
    const values = query.groupBy.map(dimension => dimensionValue(dimension, fact, query.timeZone));
    const key = JSON.stringify(values);
    let group = partitions.get(key);
    if (group === undefined) {
      if (partitions.size >= MAX_RICH_METRIC_GROUPS) return err("record_limit");
      group = { dimensions: values, label: values.map((value, index) => dimensionLabel(query.groupBy[index]!, value, fact.owner.provider)).join(" × ") || "All selected facts", facts: [] };
      partitions.set(key, group);
    }
    group.facts.push(fact);
  }
  const groups: RichExplorerGroup[] = [];
  for (const [key, group] of partitions) {
    const result = evaluate(group.facts);
    if (!result.ok) return result;
    groups.push(Object.freeze({ key, dimensions: Object.freeze(group.dimensions), label: group.label, measure: result.value.measures[0]!, facts: group.facts.length }));
  }
  groups.sort((a, b) => compareValues(a.measure.value, b.measure.value) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const kept = groups.slice(0, query.topK);
  const recipe = sampler(query.metricId);
  let distribution: RichDistributionView | null = null;
  const samples: RichSample[] = [];
  let sampledFacts = 0;
  if (recipe !== null && (recipe.grain === null || recipe.grain === query.selection.grain) && measure.value !== null) {
    const candidates: RichSample[] = [];
    const lineage = query.selection.lineage;
    for (const [key, group] of partitions) {
      const active = group.facts.filter(fact => fact.value !== null && (lineage === "all" || fact.owner.lineage === lineage));
      const population = recipe.quantity === null ? active.map(fact => ({ fact, usage: fact })) : usageCohort(active, query);
      for (const { fact, usage } of population) {
        const value = usage === null ? null : recipe.sample(usage, query);
        if (value === undefined) continue;
        candidates.push(Object.freeze({ executionId: fact.owner.executionId, observationId: fact.value!.observationId, atMs: fact.atMs, provider: fact.owner.provider, model: usageModel(usage ?? fact), value, groupKey: key }));
      }
    }
    sampledFacts = candidates.length;
    distribution = richDistribution(candidates.map(sample => sample.value));
    candidates.sort((a, b) => a.value === null ? (b.value === null ? 0 : 1) : b.value === null ? -1 : a.value < b.value ? 1 : a.value > b.value ? -1 : a.atMs - b.atMs);
    samples.push(...candidates.slice(0, MAX_RICH_DRILLDOWN_ROWS));
  }
  return ok(Object.freeze({ ...base, measure, reason: measure.reason, groups: Object.freeze(kept), totalGroups: groups.length, omittedGroups: groups.length - kept.length,
    distribution, samples: Object.freeze(samples), sampledFacts, facets }));
}

/** Exact JSON for the evaluated selection: values keep decimal strings. */
export function richExplorerResultJson(result: RichExplorerResult): string {
  return JSON.stringify(result, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value, 2);
}
export function richMetricIds(): readonly string[] { return RICH_SUPPORTED_METRIC_IDS; }
