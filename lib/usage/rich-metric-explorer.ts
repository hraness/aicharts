import { err, ok, type Result } from "../result";
import { METRIC_CATALOG } from "./metric-explorer-catalog";
import type { MetricValue } from "./metric-explorer-values";
import { statsInteger, statsOwnRecord } from "./stats-contract";
import { summarizeRichFacts } from "./rich-facts";
import { RICH_FACT_MAX_WINDOW_MS, type RichDistribution, type RichFactError, type RichFactKind,
  type RichGrain, type RichProvenance, type RichSelection, type RichTokenAggregation } from "./rich-fact-contract";

export const RICH_METRIC_MAX_QUERY_IDS = 32;
export type RichMetricQuantity = "input" | "output" | "total" | "reasoning" | "cacheWriteUnknown";
export type RichMetricQuery = Readonly<{ schemaVersion: 1; selection: RichSelection; quantity: RichMetricQuantity; metricIds: readonly string[] }>;
export type RichMetricReason = "not-implemented-in-profile" | "unsupported-source-kind" | "different-grain"
  | "no-measured-observations" | "unclassified-request-outcomes" | "zero-denominator"
  | Exclude<RichTokenAggregation["reason"], null>;
export type RichMetricMeasure = Readonly<{
  id: string; version: 1; unit: string; value: MetricValue | null; status: "available" | "partial" | "unavailable";
  reason: RichMetricReason | null; cohort: string; aggregation: "count" | "mean" | "nearest-rank" | "minimum" | "maximum" | "ratio";
  measured: number; unmeasured: number; sourceKind: RichFactKind;
  sourceCoverage: "unsupported" | "partial" | "complete";
}>;
export type RichMetricResult = Readonly<{
  schemaVersion: 1; profile: "rich-facts-v1"; provenance: RichProvenance; query: RichMetricQuery; observedOnly: true;
  tokenAggregation: RichTokenAggregation; excludedUnknownLineage: number; retractedFacts: number;
  requestOutcomes: Readonly<{ success: number; error: number; refusal: number; cancel: number; timeout: number; unknown: number }>;
  measures: readonly RichMetricMeasure[];
}>;
type Summary = Extract<ReturnType<typeof summarizeRichFacts>, { ok: true }>["value"];
type Statistic = "observedMean" | "minimum" | "median" | "p90" | "p95" | "p99" | "maximum";
type Recipe = Readonly<{ source: RichFactKind; cohort: string; grain?: RichGrain; token?: boolean;
  distribution?: (summary: Summary, query: RichMetricQuery) => RichDistribution | null; statistic?: Statistic;
  count?: (summary: Summary) => number; population?: (summary: Summary) => number;
  missing?: (summary: Summary) => number; outcomeRate?: "error" | "refusal" | "cancel" | "timeout";
  classifiedRequests?: boolean }>;
const catalog = new Map(METRIC_CATALOG.map(value => [value.id, value]));
const knownRequests = (s: Summary) => s.requests.success + s.requests.error + s.requests.refusal + s.requests.cancel + s.requests.timeout;
const allRequests = (s: Summary) => knownRequests(s) + s.requests.unknownOutcome;
const knownTools = (s: Summary) => s.tools.success + s.tools.error + s.tools.cancel + s.tools.timeout;
const allTurns = (s: Summary) => s.turns.completed + s.turns.aborted;
const recipes: Record<string, Recipe> = Object.create(null);
for (const grain of ["request", "response", "turn", "session"] as const)
  for (const quantity of ["input", "output", "total"] as const)
    recipes[`mean-${quantity}-tokens-per-${grain}`] = { source: "usage", cohort: `measured ${grain} token observations`, grain, token: true,
      distribution: summary => summary.tokens?.[quantity] ?? null, statistic: "observedMean" };
for (const [suffix, statistic] of [["median", "median"], ["p90", "p90"], ["p95", "p95"], ["p99", "p99"], ["minimum", "minimum"], ["maximum", "maximum"]] as const)
  recipes[`token-size-${suffix}`] = { source: "usage", cohort: "measured observations of the selected grain and token quantity", token: true,
    distribution: (summary, query) => summary.tokens?.[query.quantity] ?? null, statistic };
for (const [suffix, statistic] of [["p50", "median"], ["p95", "p95"], ["p99", "p99"]] as const)
  recipes[`request-latency-${suffix}`] = { source: "request", cohort: "classified terminal requests with exact dispatch-to-terminal timing",
    distribution: summary => summary.requests.latencyMs, statistic, classifiedRequests: true };
recipes["time-to-first-token"] = { source: "request", cohort: "classified requests with exact dispatch-to-first-token timing",
  distribution: summary => summary.requests.firstTokenMs, statistic: "observedMean", classifiedRequests: true };
for (const [suffix, statistic] of [["p50", "median"], ["p90", "p90"], ["p95", "p95"], ["p99", "p99"]] as const)
  recipes[`context-occupancy-${suffix}`] = { source: "context", cohort: "recorded context snapshots", distribution: summary => summary.context.tokens, statistic };
recipes["maximum-context-occupancy"] = { source: "context", cohort: "recorded context snapshots", distribution: summary => summary.context.tokens, statistic: "maximum" };
for (const id of ["observed-turn-count", "distinct-turns"])
  recipes[id] = { source: "turn", cohort: "recorded terminal turns", count: allTurns, population: allTurns };
recipes["completed-turn-count"] = { source: "turn", cohort: "recorded terminal turns", count: summary => summary.turns.completed, population: allTurns };
recipes["aborted-turn-count"] = { source: "turn", cohort: "recorded terminal turns", count: summary => summary.turns.aborted, population: allTurns };
recipes["runtime-per-measured-turn"] = { source: "turn", cohort: "completed turns with exact start-to-end timing",
  distribution: summary => summary.turns.completedRuntimeMs, statistic: "observedMean" };
recipes["observed-turn-duration"] = { source: "turn", cohort: "terminal turns with exact start-to-end timing",
  distribution: summary => summary.turns.runtimeMs, statistic: "observedMean" };
recipes["tokens-per-measured-turn"] = { source: "usage", cohort: "measured turn token observations", grain: "turn", token: true,
  distribution: summary => summary.tokens?.total ?? null, statistic: "observedMean" };
recipes["distinct-requests"] = { source: "request", cohort: "recorded request attempts of every outcome", count: allRequests, population: allRequests };
recipes["retry-attempt-count"] = { source: "request", cohort: "recorded request attempts with explicit retry links",
  count: summary => summary.requests.retries, population: allRequests };
recipes["successful-request-count"] = { source: "request", cohort: "classified terminal requests",
  count: summary => summary.requests.success, population: knownRequests, missing: summary => summary.requests.unknownOutcome };
recipes["failed-request-count"] = { source: "request", cohort: "classified terminal requests; failure includes error, refusal, cancellation and timeout",
  count: summary => summary.requests.error + summary.requests.refusal + summary.requests.cancel + summary.requests.timeout,
  population: knownRequests, missing: summary => summary.requests.unknownOutcome };
for (const outcome of ["error", "refusal", "cancel", "timeout"] as const)
  recipes[`${outcome}-request-rate`] = { source: "request", cohort: "enumerated request attempts with resolved outcomes",
    outcomeRate: outcome, classifiedRequests: true };
recipes["tool-requested-count"] = { source: "tool", cohort: "recorded tool invocations at the requested stage",
  count: summary => summary.tools.requested, population: summary => summary.tools.requested + summary.tools.dispatched + summary.tools.terminal };
recipes["tool-dispatched-count"] = { source: "tool", cohort: "recorded tool invocations at the dispatched stage",
  count: summary => summary.tools.dispatched, population: summary => summary.tools.requested + summary.tools.dispatched + summary.tools.terminal };
recipes["tool-completed-count"] = { source: "tool", cohort: "recorded tool invocations with classified terminal outcomes",
  count: summary => summary.tools.success, population: knownTools, missing: summary => summary.tools.unknownOutcome };
recipes["tool-failed-count"] = { source: "tool", cohort: "recorded tool invocations with classified terminal outcomes; failure includes error, cancellation and timeout",
  count: summary => summary.tools.error + summary.tools.cancel + summary.tools.timeout, population: knownTools,
  missing: summary => summary.tools.unknownOutcome };
recipes["compaction-count"] = { source: "compaction", cohort: "recorded compaction attempts by outcome",
  count: summary => summary.compactions.applied + summary.compactions.planned + summary.compactions.failed + summary.compactions.skipped,
  population: summary => summary.compactions.applied + summary.compactions.planned + summary.compactions.failed + summary.compactions.skipped };
recipes["compaction-duration"] = { source: "compaction", cohort: "applied compactions with exact duration",
  distribution: summary => summary.compactions.appliedDurationMs, statistic: "observedMean" };
recipes["pre-compaction-context"] = { source: "compaction", cohort: "applied compactions with an explicit pre-compaction context",
  distribution: summary => summary.compactions.beforeTokens, statistic: "observedMean" };
recipes["post-compaction-context"] = { source: "compaction", cohort: "applied compactions with an explicit post-compaction context",
  distribution: summary => summary.compactions.afterTokens, statistic: "observedMean" };
Object.freeze(recipes);
export const RICH_SUPPORTED_METRIC_IDS: readonly string[] = Object.freeze(Object.keys(recipes));
for (const id of RICH_SUPPORTED_METRIC_IDS) if (!catalog.has(id)) throw new Error(`rich_metric_catalog_drift:${id}`);

const identity = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/u.test(value) && !/^0+$/u.test(value);
/** Copy the complete query before report parsing. Accessors, sparse arrays and
 * unknown metric IDs cannot trigger an expensive fold or widen its selection. */
export function parseRichMetricQuery(input: unknown): RichMetricQuery | null {
  try {
    const raw = statsOwnRecord(input, ["schemaVersion", "selection", "quantity", "metricIds"]);
    const selected = raw && statsOwnRecord(raw.selection, ["window", "grain", "tokenScope", "lineage", "executionId"]);
    const window = selected && statsOwnRecord(selected.window, ["startMs", "endMs"]);
    if (!raw || raw.schemaVersion !== 1 || !selected || !window || !statsInteger(window.startMs, 0, 8_640_000_000_000_000)
      || !statsInteger(window.endMs, window.startMs + 1, Math.min(8_640_000_000_000_000, window.startMs + RICH_FACT_MAX_WINDOW_MS))
      || typeof selected.grain !== "string" || !["usage_observation", "request", "response", "turn", "session"].includes(selected.grain)
      || typeof selected.tokenScope !== "string" || !["direct", "inclusive", "unknown"].includes(selected.tokenScope)
      || typeof selected.lineage !== "string" || !["root", "child", "unknown", "all"].includes(selected.lineage)
      || (selected.executionId !== null && !identity(selected.executionId))
      || typeof raw.quantity !== "string" || !["input", "output", "total", "reasoning", "cacheWriteUnknown"].includes(raw.quantity)) return null;
    if (!Array.isArray(raw.metricIds) || Object.getPrototypeOf(raw.metricIds) !== Array.prototype) return null;
    const entries = Object.getOwnPropertyDescriptors(raw.metricIds), length = Object.getOwnPropertyDescriptor(raw.metricIds, "length");
    if (!length || !("value" in length) || !statsInteger(length.value, 1, RICH_METRIC_MAX_QUERY_IDS)
      || Reflect.ownKeys(entries).length !== length.value + 1) return null;
    const ids: string[] = [];
    for (let index = 0; index < length.value; index++) {
      const item = entries[String(index)];
      if (!item || !("value" in item) || !item.enumerable || typeof item.value !== "string" || !catalog.has(item.value) || ids.includes(item.value)) return null;
      ids.push(item.value);
    }
    return Object.freeze({ schemaVersion: 1, quantity: raw.quantity as RichMetricQuantity, metricIds: Object.freeze(ids),
      selection: Object.freeze({ window: Object.freeze({ startMs: window.startMs, endMs: window.endMs }), grain: selected.grain as RichGrain,
        tokenScope: selected.tokenScope as RichSelection["tokenScope"], lineage: selected.lineage as RichSelection["lineage"], executionId: selected.executionId as string | null }) });
  } catch { return null; }
}
function measure(id: string, summary: Summary, query: RichMetricQuery): RichMetricMeasure {
  const definition = catalog.get(id)!, recipe = recipes[id], source = recipe?.source ?? "usage";
  const coverage = summary.sourceCoverage[source];
  const result = (value: MetricValue | null, measured = 0, unmeasured = 0, reason: RichMetricReason | null = null,
    aggregation: RichMetricMeasure["aggregation"] = "count"): RichMetricMeasure => Object.freeze({
      id, version: 1, unit: definition.unit, value: value ? Object.freeze(value) : null,
      status: value === null ? "unavailable" : coverage !== "complete" || unmeasured > 0 ? "partial" : "available",
      reason, cohort: recipe?.cohort ?? "no implemented cohort for this profile", aggregation, measured, unmeasured,
      sourceKind: source, sourceCoverage: coverage,
    });
  if (!recipe) return result(null, 0, 0, "not-implemented-in-profile");
  if (coverage === "unsupported") return result(null, 0, 0, "unsupported-source-kind");
  if (recipe.grain !== undefined && recipe.grain !== query.selection.grain) return result(null, 0, 0, "different-grain");
  if (recipe.token && !summary.tokenAggregation.eligible) return result(null, 0, 0, summary.tokenAggregation.reason);
  if (recipe.classifiedRequests && summary.requests.unknownOutcome > 0)
    return result(null, knownRequests(summary), summary.requests.unknownOutcome, "unclassified-request-outcomes");
  if (recipe.outcomeRate) {
    const denominator = allRequests(summary);
    return denominator === 0 ? result(null, 0, 0, "no-measured-observations", "ratio")
      : result({ kind: "ratio", numerator: BigInt(summary.requests[recipe.outcomeRate]), denominator: BigInt(denominator) }, denominator, 0, null, "ratio");
  }
  if (recipe.count && recipe.population) {
    const population = recipe.population(summary), missing = recipe.missing?.(summary) ?? 0;
    return population === 0 ? result(null, 0, missing, "no-measured-observations")
      : result({ kind: "integer", amount: BigInt(recipe.count(summary)) }, population, missing);
  }
  const distribution = recipe.distribution?.(summary, query), statistic = recipe.statistic!;
  const aggregation = statistic === "observedMean" ? "mean" : statistic === "minimum" ? "minimum" : statistic === "maximum" ? "maximum" : "nearest-rank";
  if (!distribution || distribution.measured === 0) return result(null, 0, distribution?.unmeasured ?? 0, "no-measured-observations", aggregation);
  const selected = distribution[statistic];
  return typeof selected === "bigint" ? result({ kind: "integer", amount: selected }, distribution.measured, distribution.unmeasured, null, aggregation)
    : selected === null ? result(null, distribution.measured, distribution.unmeasured, "zero-denominator", aggregation)
      : result({ kind: "ratio", numerator: selected.numerator, denominator: selected.denominator }, distribution.measured, distribution.unmeasured, null, aggregation);
}

/** Local profile projection. It does not merge provenance epochs, infer request
 * grain from token records, or substitute duration sums for wall time. Browser
 * worker admission, report lifetime and bounded presentation remain separate. */
export function evaluateRichMetricQuery(input: unknown, queryInput: unknown): Result<RichMetricResult, RichFactError | "invalid_rich_metric_query"> {
  const query = parseRichMetricQuery(queryInput);
  if (!query) return err("invalid_rich_metric_query");
  const result = summarizeRichFacts(input, query.selection);
  if (!result.ok) return result;
  const summary = result.value;
  return ok(Object.freeze({ schemaVersion: 1, profile: "rich-facts-v1", provenance: Object.freeze({ ...summary.provenance }), query,
    observedOnly: true, tokenAggregation: Object.freeze({ ...summary.tokenAggregation }), excludedUnknownLineage: summary.excludedUnknownLineage,
    retractedFacts: summary.retractedFacts, requestOutcomes: Object.freeze({ success: summary.requests.success, error: summary.requests.error,
      refusal: summary.requests.refusal, cancel: summary.requests.cancel, timeout: summary.requests.timeout, unknown: summary.requests.unknownOutcome }),
    measures: Object.freeze(query.metricIds.map(id => measure(id, summary, query))) }));
}
