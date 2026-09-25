import { err, ok, type Result } from "../result";
import { METRIC_CATALOG, type MetricCatalogEntry } from "./metric-explorer-catalog";
import { metricWindow, type MetricFold, type MetricTokenPart } from "./metric-explorer-fold";

export type MetricReason = "no-observations" | "missing-categories" | "zero-denominator" | "insufficient-window"
  | "grouping-required"
  | "period-coverage-unavailable" | "needs-observation-facts" | "needs-billing-evidence" | "needs-source-health"
  | "needs-tariff-evidence" | "needs-account-dimensions" | "separate-benchmark-population"
  | "matched-cohort-unavailable" | "no-baseline";
export type MetricValue = Readonly<{ kind: "integer"; amount: bigint }> | Readonly<{ kind: "ratio"; numerator: bigint; denominator: bigint }>;
export type MetricMeasure = Readonly<{
  id: string; version: 1; unit: string; status: "available" | "partial" | "unavailable"; value: MetricValue | null;
  eligibleRecords: bigint; selectedRecords: bigint; excludedRecords: bigint; reason: MetricReason | null;
  evidence: "observed-subtotal" | "eligible-cohort" | "planned";
}>;
/** Previous-period evidence for one cohort. `matched` is exposure: the previous
 * window lies inside the report, both windows are complete and every day of both
 * carries observations. `cohortMatched` adds identical group populations along
 * the query's dimensions. `counterpart` is the same cohort's previous fold, or
 * null when that cohort has no previous observations. */
export type MetricComparisonContext = Readonly<{
  population: MetricFold; counterpart: MetricFold | null; matched: boolean; reason: MetricReason | null;
  cohortMatched: boolean; cohortReason: MetricReason | null;
}>;
export type MetricValueContext = Readonly<{
  firstUtcDay: number; dayCount: number; asOfUtcDay: number; groupBy: readonly string[];
  population: MetricFold; costKind: "reported" | "estimated";
  sourceIssues: number; previous: MetricComparisonContext | null;
}>;
const catalog = new Map(METRIC_CATALOG.map(metric => [metric.id, metric]));
const quantityParts: Readonly<Record<string, MetricTokenPart>> = {
  "uncached-input-tokens": "input", "cache-read-tokens": "cacheRead", "cache-write-tokens": "cacheWrite",
  "cache-write-unknown-tokens": "cacheWrite", "cache-write-volume-unknown": "cacheWrite",
  "non-reasoning-output-tokens": "output", "reasoning-output-tokens": "reasoning",
};
const totals = new Set(["accounted-tokens", "model-consumed-tokens", "utc-day-tokens", "utc-week-tokens", "utc-month-tokens",
  "cumulative-tokens", "weekday-token-heatmap"]);
const cohortRatios = new Set(["input-output-token-ratio", "reasoning-output-share", "cached-input-share", "cache-write-input-share",
  "cache-read-token-share", "cache-write-token-share", "cache-reuse-to-write-ratio"]);
/** Matched comparisons carry signed changes; every other value is non-negative. */
export const SIGNED_METRIC_IDS: ReadonlySet<string> = new Set(["previous-period-token-change", "previous-period-token-change-percent",
  "compare-periods", "compare-clients", "compare-models", "composition-share-change"]);
export const SUPPORTED_METRIC_IDS: ReadonlySet<string> = new Set([...Object.keys(quantityParts), ...totals, ...cohortRatios, ...SIGNED_METRIC_IDS,
  "inclusive-output-tokens", "client-token-share", "provider-token-share", "model-token-share", "unknown-model-token-share",
  "rolling-7-day-tokens", "rolling-30-day-tokens", "rolling-90-day-tokens", "observed-active-days", "observed-usage-streak", "peak-daily-tokens",
  "source-reported-charge", "dated-retail-estimated-cost", "unpriced-records", "pricing-record-coverage", "model-attribution-coverage",
  "cost-by-client", "cost-by-model", "cost-by-time",
  "effective-usd-per-million-total-tokens", "tokens-per-source-duration-second"]);

export function metricDefinition(id: string): MetricCatalogEntry | undefined { return catalog.get(id); }
export function unavailableMetricReason(definition: MetricCatalogEntry): MetricReason {
  if (["compare-accounts", "compare-devices"].includes(definition.id)) return "needs-account-dimensions";
  if (definition.id === "cache-write-break-even" || definition.id === "modeled-cache-savings" || definition.id === "historical-repricing") return "needs-tariff-evidence";
  if (definition.availability === "billing-evidence" || definition.implementationPhase === "10") return "needs-billing-evidence";
  if (definition.implementationPhase === "4" || definition.family === "operations") return "needs-source-health";
  if (definition.family === "benchmark-context") return "separate-benchmark-population";
  return "needs-observation-facts";
}
export const METRIC_REASON_TEXT: Readonly<Record<MetricReason, string>> = Object.freeze({
  "no-observations": "No eligible observations are present. Missing usage is not a measured zero.",
  "missing-categories": "This quantity needs known token categories on the same observations.",
  "zero-denominator": "The eligible denominator is zero; a ratio cannot be established.",
  "insufficient-window": "The selected range is shorter than this metric's window.",
  "grouping-required": "Choose this metric's client, model or calendar grouping to inspect its category values.",
  "period-coverage-unavailable": "This report does not retain matched source populations, versions and exposure for both periods.",
  "needs-observation-facts": "This daily aggregate does not retain the observation-level facts or compatible denominator this metric needs.",
  "needs-billing-evidence": "Explicit billing, budget or threshold evidence is required; token totals cannot supply it.",
  "needs-source-health": "Collection or operational evidence is separate from this numeric usage report.",
  "needs-tariff-evidence": "A compatible dated tariff and the same priced observation cohort are required.",
  "needs-account-dimensions": "This report has no compatible account or device contribution dimension.",
  "separate-benchmark-population": "Published evaluations are a separate population; personal usage is not a benchmark score.",
  "matched-cohort-unavailable": "The two periods do not observe the same groups along this dimension, so a matched comparison is refused.",
  "no-baseline": "The previous period has no accounted tokens; a percentage change has no baseline.",
});
export function metricRecommendedDimension(id: string): "client" | "provider" | "model" | "utc-day" | "utc-week" | "utc-month" | "weekday" | null {
  if (["client-token-share", "cost-by-client", "compare-clients"].includes(id)) return "client";
  if (id === "provider-token-share") return "provider";
  if (["model-token-share", "cost-by-model", "compare-models"].includes(id)) return "model";
  if (["utc-day-tokens", "cost-by-time"].includes(id)) return "utc-day";
  if (id === "utc-week-tokens") return "utc-week";
  if (id === "utc-month-tokens") return "utc-month";
  if (id === "weekday-token-heatmap") return "weekday";
  return null;
}

/** Short product definitions accompany the exact values. Full formula and
 * assurance prose stays in the source registry, outside the browser bundle. */
export function metricExplanation(id: string): string | null {
  if (["accounted-tokens", "model-consumed-tokens"].includes(id)) return "Input + cache reads + cache writes + non-reasoning output + reasoning. The five buckets are disjoint; missing buckets remain unknown.";
  if (id === "inclusive-output-tokens") return "Non-reasoning output + reasoning, counted once. This report stores those output categories separately.";
  if (id === "non-reasoning-output-tokens") return "Output tokens excluding the separately recorded reasoning subset.";
  if (id === "reasoning-output-tokens") return "The recorded reasoning subset of output. It is already included in total and inclusive output tokens.";
  if (id.includes("cache-write") && (id.endsWith("unknown") || id.endsWith("unknown-tokens"))) return "Known cache-write tokens with no retained TTL classification. This report cannot divide them into short- and long-lived writes.";
  if (["cached-input-share", "cache-read-token-share"].includes(id)) return "Cache-read tokens ÷ (uncached input + cache reads + cache writes), using complete category observations only. This is token share, not request hit rate.";
  if (["cache-write-input-share", "cache-write-token-share"].includes(id)) return "Cache-write tokens ÷ all input tokens on the same complete-category observations.";
  if (id === "input-output-token-ratio") return "All input tokens ÷ inclusive output, on observations with complete input and output categories.";
  if (id === "reasoning-output-share") return "Reasoning tokens ÷ inclusive output on the same complete-category observations.";
  if (id === "cache-reuse-to-write-ratio") return "Cache-read tokens ÷ cache-write tokens in this window. Reads may reuse earlier or external writes; this does not measure reuse of an individual cache object.";
  if (["client-token-share", "provider-token-share", "model-token-share"].includes(id)) return "Each group’s observed tokens ÷ the total selected population. Unknown attribution stays in the denominator; the overall selection is 100%.";
  if (id === "unknown-model-token-share") return "Tokens with unknown model attribution ÷ all observed tokens in this selection.";
  if (id === "model-attribution-coverage") return "Tokens assigned to a model in the report’s registry ÷ all observed tokens, including unknown models. This does not measure scan completeness.";
  if (id === "pricing-record-coverage") return "Records with either a reported charge or a retained estimate ÷ all selected source-defined records. This profile keeps the two priced record populations disjoint.";
  if (id === "unpriced-records") return "Selected records without a reported charge or retained retail estimate. Unknown token counts remain a separate gap.";
  if (id === "effective-usd-per-million-total-tokens") return "USD charge × 1,000,000 ÷ tokens on wholly priced, complete-category rows of the selected cost kind. Partial price coverage cannot supply a matching token denominator.";
  if (id === "source-reported-charge") return "Sum of retained source-reported USD charges. A measured zero is retained; this subtotal is not an invoice or subscription payment.";
  if (id === "dated-retail-estimated-cost") return "Sum of retained retail estimates. This profile does not bind a tariff revision, and imported estimates may use different prices or dates.";
  if (id.startsWith("cost-by-")) return "Observed USD subtotal for the chosen cost kind, grouped as shown below. Source-reported charges and alternative retail estimates remain separate.";
  if (id === "tokens-per-source-duration-second") return "Tokens attributed to timed observations × 1,000 ÷ their source-duration milliseconds. Unknown timed tokens are excluded with their durations. Source duration is not decode speed or time spent working.";
  if (id.startsWith("rolling-")) return "Observed token subtotal in the named number of complete UTC days before the earlier of the range’s exclusive end and the report’s generation day. Missing days stay unknown.";
  if (id === "observed-active-days") return "Distinct selected UTC days with a positive token contribution. Zero-token and token-unknown records do not prove positive token activity.";
  if (id === "observed-usage-streak") return "Consecutive positive-token UTC days ending on the selected range’s final day. An unobserved day ends the observed run without proving inactivity.";
  if (id === "peak-daily-tokens") return "Largest observed UTC-day token subtotal in the selection. With partial coverage, this is a lower-bound peak.";
  if (id === "previous-period-token-change" || id === "compare-periods") return "Accounted tokens in the selected range minus the same-length range immediately before it. Both ranges must lie in the report with observations on every day; a group is compared with the same group in the previous range.";
  if (id === "previous-period-token-change-percent") return "Signed token change ÷ the previous range’s accounted tokens on the same matched cohort. A zero baseline is refused rather than shown as infinity or zero.";
  if (id === "compare-clients" || id === "compare-models") return "Signed accounted-token change per group between two matched, same-length ranges. The comparison is refused when the two ranges do not observe the same set of groups.";
  if (id === "composition-share-change") return "Each group’s share of the selected population now minus its share in the previous range, in percentage points, on identical cohorts only.";
  if (id === "cumulative-tokens") return "Observed token subtotal from the selected start through the exclusive end of the selected range. The selected start is the explicit accumulation boundary.";
  if (id.startsWith("utc-") || id === "weekday-token-heatmap") return "The value is the selected range’s observed subtotal; the table groups it by the chosen UTC calendar bucket. Days with records are shown per group; complete calendar exposure is unknown.";
  if (Object.hasOwn(quantityParts, id)) return "Sum of the explicitly retained token category. In a partial breakdown, an unreported category is not a measured zero.";
  return null;
}
/** Exact signed difference and relative change between a current and a
 * previous measure of the same metric. `percent` is null without a positive or
 * negative baseline; a zero baseline is never rendered as zero or infinity. */
export type MetricChange = Readonly<{ absolute: MetricValue; percent: Readonly<{ kind: "ratio"; numerator: bigint; denominator: bigint }> | null }>;
export function metricChange(current: MetricValue | null, previous: MetricValue | null): MetricChange | null {
  if (current === null || previous === null) return null;
  const a = current.kind === "integer" ? { n: current.amount, d: 1n } : { n: current.numerator, d: current.denominator };
  const b = previous.kind === "integer" ? { n: previous.amount, d: 1n } : { n: previous.numerator, d: previous.denominator };
  if (a.d <= 0n || b.d <= 0n) return null;
  const difference = a.n * b.d - b.n * a.d;
  const absolute: MetricValue = current.kind === "integer" && previous.kind === "integer"
    ? { kind: "integer", amount: difference } : { kind: "ratio", numerator: difference, denominator: a.d * b.d };
  if (b.n === 0n) return Object.freeze({ absolute: Object.freeze(absolute), percent: null });
  const denominator = a.d * b.n, sign = denominator < 0n ? -1n : 1n;
  return Object.freeze({ absolute: Object.freeze(absolute), percent: Object.freeze({ kind: "ratio" as const, numerator: difference * sign, denominator: denominator * sign }) });
}
export function metricCollectionPath(definition: MetricCatalogEntry): Readonly<{ label: string; href: string | null }> {
  if (definition.family === "benchmark-context") return { label: "Open sourced model comparisons", href: "/" };
  if (definition.implementationPhase === "4") return { label: "Inspect local collection with aicharts stats --health-json or stats-health", href: null };
  if (definition.availability === "local-profile") return { label: "Inspect qualified local session facts; this report does not contain them", href: "/usage/sessions" };
  if (definition.implementationPhase === "10") return { label: "Planned private billing, budgets and alert evidence", href: null };
  if (definition.implementationPhase === "8") return { label: "Planned qualified numeric instrumentation and observation detail", href: null };
  return { label: "Planned snapshot and cohort evidence from account contributions", href: null };
}

const U128_MAX = (1n << 128n) - 1n;
export type MetricRounding = "floor" | "ceiling" | "half-up";
/** One rounding of an exact ratio, as the native kernel's `ExactRatio::rounded`.
 * Half-up rounds a remainder of at least half the denominator upward. */
export function metricRatioRounded(numerator: bigint, denominator: bigint, rule: MetricRounding): Result<bigint, "zero_denominator" | "overflow"> {
  if (numerator < 0n || denominator < 0n || numerator > U128_MAX || denominator > U128_MAX) return err("overflow");
  if (denominator === 0n) return err("zero_denominator");
  const quotient = numerator / denominator, remainder = numerator % denominator;
  const increment = rule === "floor" ? false : rule === "ceiling" ? remainder !== 0n : remainder >= denominator / 2n + denominator % 2n;
  const rounded = quotient + (increment ? 1n : 0n);
  return rounded > U128_MAX ? err("overflow") : ok(rounded);
}

export type MetricBasis = "reported" | "derived" | "estimated";
/** Unknown and unsupported are distinct from a known zero. */
export type MetricQuantityEvidence = Readonly<{ kind: "known"; value: bigint; basis: MetricBasis }> | Readonly<{ kind: "unknown" }> | Readonly<{ kind: "unsupported" }>;
/** Caller-established population identity and compatible units; equality is a
 * consistency predicate, never proof of source identity. */
export type MetricPopulation = Readonly<{ identity: string; unit: string; grain: string }>;
export type MetricScopedQuantity = Readonly<{ population: MetricPopulation; evidence: MetricQuantityEvidence }>;
export type MetricMatchedPair = Readonly<{ left: bigint; right: bigint; leftBasis: MetricBasis; rightBasis: MetricBasis }>;
/** As the native kernel's `match_quantities`: a ratio pairs two known
 * quantities over the same population, or it does not exist. */
export function matchMetricQuantities(left: MetricScopedQuantity, right: MetricScopedQuantity): Result<MetricMatchedPair, "population_mismatch" | "missing_evidence"> {
  if (left.population.identity !== right.population.identity || left.population.unit !== right.population.unit
    || left.population.grain !== right.population.grain) return err("population_mismatch");
  if (left.evidence.kind !== "known" || right.evidence.kind !== "known") return err("missing_evidence");
  return ok(Object.freeze({ left: left.evidence.value, right: right.evidence.value, leftBasis: left.evidence.basis, rightBasis: right.evidence.basis }));
}
const knownQuantity = (value: bigint, basis: MetricBasis, records: bigint): MetricQuantityEvidence => records === 0n ? { kind: "unknown" } : { kind: "known", value, basis };

/** Values keep exact numerators and denominators. Any display rounding happens
 * after this fold, and unavailable quantities never carry a numeric zero. */
export function metricMeasure(id: string, fold: MetricFold, context: MetricValueContext): MetricMeasure {
  const definition = catalog.get(id);
  if (definition === undefined) throw new Error("metric_id_invalid");
  const result = (value: MetricValue | null, eligibleRecords: bigint, reason: MetricReason | null = null,
    unit = definition.unit, evidence: MetricMeasure["evidence"] = "observed-subtotal"): MetricMeasure => Object.freeze({
      id, version: 1, unit, value: value === null ? null : Object.freeze(value), eligibleRecords, selectedRecords: fold.records,
      excludedRecords: fold.records > eligibleRecords ? fold.records - eligibleRecords : 0n,
      status: value === null ? "unavailable" : eligibleRecords < fold.records || fold.partialRecords > 0n || context.sourceIssues > 0 ? "partial" : "available",
      reason, evidence,
    });
  const integer = (amount: bigint, eligible = fold.tokenRecords, unit = definition.unit) => eligible === 0n
    ? result(null, 0n, "no-observations", unit) : result({ kind: "integer", amount }, eligible, null, unit);
  const ratio = (numerator: bigint, denominator: bigint, eligible: bigint, unit = definition.unit) => eligible === 0n
    ? result(null, 0n, "no-observations", unit, "eligible-cohort")
    : denominator === 0n ? result(null, eligible, "zero-denominator", unit, "eligible-cohort")
      : result({ kind: "ratio", numerator, denominator }, eligible, null, unit, "eligible-cohort");
  // A cohort ratio exists only for two known quantities over one selected
  // population; an empty cohort has unknown quantities, never zeros.
  const cohortRatio = (identity: string, left: MetricQuantityEvidence, right: MetricQuantityEvidence, eligible: bigint, unit = definition.unit) => {
    const population = { identity, unit: "records", grain: "aggregate-row" };
    const matched = matchMetricQuantities({ population, evidence: left }, { population, evidence: right });
    return matched.ok ? ratio(matched.value.left, matched.value.right, eligible, unit) : result(null, 0n, "no-observations", unit, "eligible-cohort");
  };
  if (!SUPPORTED_METRIC_IDS.has(id)) return result(null, 0n, unavailableMetricReason(definition), definition.unit, "planned");
  const dimension = metricRecommendedDimension(id);
  if (dimension !== null && !context.groupBy.includes(dimension)) return result(null, 0n, "grouping-required");
  if (SIGNED_METRIC_IDS.has(id)) {
    const previous = context.previous, cohortBound = id === "compare-clients" || id === "compare-models" || id === "composition-share-change";
    if (cohortBound && context.groupBy.length === 0) return result(null, 0n, "grouping-required");
    if (previous === null || !previous.matched) return result(null, 0n, previous?.reason ?? "period-coverage-unavailable");
    if (cohortBound && !previous.cohortMatched) return result(null, 0n, previous.cohortReason ?? "matched-cohort-unavailable");
    const counterpart = previous.counterpart;
    if (counterpart === null) return result(null, 0n, "matched-cohort-unavailable");
    if (fold.tokenRecords === 0n && counterpart.tokenRecords === 0n) return result(null, 0n, "no-observations", id.endsWith("-percent") ? "ratio" : id === "composition-share-change" ? "percentage-points" : "tokens");
    if (id === "previous-period-token-change-percent") return counterpart.total === 0n ? result(null, fold.tokenRecords, "no-baseline", "ratio", "eligible-cohort")
      : result({ kind: "ratio", numerator: fold.total - counterpart.total, denominator: counterpart.total }, fold.tokenRecords, null, "ratio", "eligible-cohort");
    if (id === "composition-share-change") {
      const current = context.population.total, prior = previous.population.total;
      if (current === 0n || prior === 0n) return result(null, fold.tokenRecords, "zero-denominator", "percentage-points", "eligible-cohort");
      // share_now − share_before, exact: (a/c − b/p) × 100 = (a·p − b·c) × 100 / (c·p).
      return result({ kind: "ratio", numerator: (fold.total * prior - counterpart.total * current) * 100n, denominator: current * prior }, fold.tokenRecords, null, "percentage-points", "eligible-cohort");
    }
    return result({ kind: "integer", amount: fold.total - counterpart.total }, fold.tokenRecords, null, "tokens");
  }
  if (totals.has(id)) return integer(fold.total, fold.tokenRecords, "tokens");
  const part = quantityParts[id];
  if (part !== undefined) {
    // A missing category and an explicitly recorded zero share the v2 scalar
    // representation when breakdown coverage is partial.
    if (fold.tokens[part] === 0n && fold.partialRecords > 0n) return result(null, fold.categories.records, "missing-categories");
    return integer(fold.tokens[part]);
  }
  if (id === "inclusive-output-tokens") {
    if (fold.tokens.output + fold.tokens.reasoning === 0n && fold.partialRecords > 0n) return result(null, fold.categories.records, "missing-categories");
    return integer(fold.tokens.output + fold.tokens.reasoning);
  }
  if (cohortRatios.has(id)) {
    const c = fold.categories, input = c.tokens.input + c.tokens.cacheRead + c.tokens.cacheWrite, output = c.tokens.output + c.tokens.reasoning;
    if (id === "input-output-token-ratio") return ratio(input, output, c.records);
    if (id === "reasoning-output-share") return ratio(c.tokens.reasoning, output, c.records);
    if (["cached-input-share", "cache-read-token-share"].includes(id)) return ratio(c.tokens.cacheRead, input, c.records);
    if (["cache-write-input-share", "cache-write-token-share"].includes(id)) return ratio(c.tokens.cacheWrite, input, c.records);
    return ratio(c.tokens.cacheRead, c.tokens.cacheWrite, c.records);
  }
  if (["client-token-share", "provider-token-share", "model-token-share"].includes(id)) return ratio(fold.total, context.population.total, fold.tokenRecords);
  if (id === "unknown-model-token-share") return ratio(fold.unknownModelTokens, fold.total, fold.tokenRecords);
  if (id === "model-attribution-coverage") return ratio(fold.total - fold.unknownModelTokens, fold.total, fold.tokenRecords);
  if (id === "pricing-record-coverage") return ratio(fold.reportedCostRecords + fold.estimatedCostRecords, fold.records, fold.records);
  if (id === "unpriced-records") return integer(fold.records - fold.reportedCostRecords - fold.estimatedCostRecords, fold.records, "records");
  if (id === "source-reported-charge" || id === "dated-retail-estimated-cost" || id.startsWith("cost-by-")) {
    const reported = id === "source-reported-charge" || (id.startsWith("cost-by-") && context.costKind === "reported");
    const amount = reported ? fold.reportedCost : fold.estimatedCost, records = reported ? fold.reportedCostRecords : fold.estimatedCostRecords;
    return amount === null ? result(null, 0n, "no-observations", "microusd") : integer(amount, records, "microusd");
  }
  if (id.startsWith("effective-usd-per-million-")) {
    const cohort = context.costKind === "reported" ? fold.reportedCohort : fold.estimatedCohort;
    // micro-USD / token equals USD / million tokens exactly.
    return cohortRatio(`${context.costKind}-cost-cohort`, knownQuantity(cohort.microusd, context.costKind, cohort.records),
      knownQuantity(cohort.total, "reported", cohort.records), cohort.records, "USD-per-million-tokens");
  }
  if (id === "tokens-per-source-duration-second") {
    const cohort = fold.rateCohort;
    return cohortRatio("timed-cohort", knownQuantity(cohort.tokens * 1000n, "reported", cohort.records), knownQuantity(cohort.durationMs, "reported", cohort.records), cohort.records);
  }
  if (id.startsWith("rolling-")) {
    const width = id === "rolling-7-day-tokens" ? 7 : id === "rolling-30-day-tokens" ? 30 : 90;
    if (context.asOfUtcDay - context.firstUtcDay < width) return result(null, 0n, "insufficient-window");
    const window = metricWindow(fold, context.asOfUtcDay - width, width);
    return integer(window.total, window.tokenRecords);
  }
  if (id === "observed-active-days") return integer(BigInt(fold.days.filter(day => day.totals.total > 0n).length), fold.tokenRecords, "days");
  if (id === "observed-usage-streak") {
    const positive = new Set(fold.days.filter(day => day.totals.total > 0n).map(day => day.utcDay));
    let length = 0;
    for (let day = context.firstUtcDay + context.dayCount - 1; day >= context.firstUtcDay && positive.has(day); day--) length++;
    return integer(BigInt(length), fold.tokenRecords, "days");
  }
  if (id === "peak-daily-tokens") return integer(fold.days.reduce((peak, day) => day.totals.total > peak ? day.totals.total : peak, 0n));
  throw new Error("metric_implementation_missing");
}
