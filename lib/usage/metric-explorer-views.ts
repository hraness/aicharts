import { METRIC_FAMILIES } from "./metric-explorer-catalog";

export type MetricFamily = typeof METRIC_FAMILIES[number];
export type MetricExplorerView = Readonly<{ id: string; name: string; families: readonly MetricFamily[] }>;

/** Focused explorer pages. "all" lists every definition; every catalog family
 * belongs to exactly one focused page so no metric is unreachable by topic. */
const definitions: readonly Readonly<{ id: string; name: string; families: readonly MetricFamily[] }>[] = [
  { id: "all", name: "All metrics", families: [] },
  { id: "tokens", name: "Tokens", families: ["token-volume", "mix", "trends", "cache-economics", "comparisons"] },
  { id: "costs", name: "Costs", families: ["costs", "billing-and-limits", "budgets-and-forecasts"] },
  { id: "performance", name: "Performance", families: ["latency-and-generation", "activity-and-concurrency"] },
  { id: "sessions", name: "Sessions & agents", families: ["typical-sizes", "sessions-turns-and-agents", "context-and-compaction"] },
  { id: "reliability", name: "Reliability", families: ["reliability"] },
  { id: "coverage", name: "Coverage", families: ["coverage-and-freshness", "operations", "benchmark-context"] },
];
export const METRIC_EXPLORER_VIEWS: readonly MetricExplorerView[] = Object.freeze(definitions.map(view => Object.freeze({ ...view, families: Object.freeze([...view.families]) })));

/** Families that no focused page lists, and families listed twice. Both are empty by construction. */
export function metricExplorerViewGaps(): Readonly<{ unlisted: readonly string[]; duplicated: readonly string[] }> {
  const seen = new Map<string, number>();
  for (const view of METRIC_EXPLORER_VIEWS) for (const family of view.families) seen.set(family, (seen.get(family) ?? 0) + 1);
  return Object.freeze({ unlisted: Object.freeze(METRIC_FAMILIES.filter(family => !seen.has(family))),
    duplicated: Object.freeze([...seen].filter(([, count]) => count > 1).map(([family]) => family)) });
}
