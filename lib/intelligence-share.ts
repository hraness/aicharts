/**
 * Homepage Intelligence chart URL codec. Selection uses the configuration
 * slug when it uniquely identifies a plotted point, otherwise the opaque
 * record id. Metric state uses a short token rather than a display name.
 */

export type IntelligenceShareMetric = "costUsdPerTask" | "outputTokensPerTask";

export type IntelligenceShareRecord = Readonly<{
  id: string;
  slug: string;
}>;

export type IntelligenceShareWeights = "all" | "closed" | "open";

export type IntelligenceShareView = Readonly<{
  metric: IntelligenceShareMetric;
  pinnedId: string;
  weights: IntelligenceShareWeights;
}>;

const MODEL_PARAM = "model";
const RESOURCE_PARAM = "resource";
const WEIGHTS_PARAM = "weights";
const TOKENS_RESOURCE = "tokens";
const OPEN_WEIGHTS = "open";
const CLOSED_WEIGHTS = "closed";

export const INTELLIGENCE_SHARE_PARAM_KEYS = [MODEL_PARAM, RESOURCE_PARAM, WEIGHTS_PARAM] as const;

export function intelligenceShareIdentity(
  records: readonly IntelligenceShareRecord[],
  pinnedId: string,
): string | null {
  const record = records.find(item => item.id === pinnedId);
  if (record === undefined) return null;
  return records.filter(item => item.slug === record.slug).length === 1
    ? record.slug
    : record.id;
}

export function parseIntelligenceShareView(
  search: string,
  records: readonly IntelligenceShareRecord[],
  defaults: IntelligenceShareView,
): IntelligenceShareView {
  const params = new URLSearchParams(search);
  const requested = params.get(MODEL_PARAM);
  const match = requested === null
    ? undefined
    : records.find(item => item.slug === requested || item.id === requested);
  const resource = params.get(RESOURCE_PARAM);
  const weightsValue = params.get(WEIGHTS_PARAM);
  return {
    metric: resource === TOKENS_RESOURCE ? "outputTokensPerTask" : defaults.metric,
    pinnedId: match?.id ?? defaults.pinnedId,
    weights: weightsValue === OPEN_WEIGHTS
      ? "open"
      : weightsValue === CLOSED_WEIGHTS
        ? "closed"
        : defaults.weights,
  };
}

/** Serialize non-default Intelligence selection, preserving unrelated parameters. */
export function intelligenceShareSearch(
  view: IntelligenceShareView,
  records: readonly IntelligenceShareRecord[],
  defaults: IntelligenceShareView,
  currentSearch = "",
): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of INTELLIGENCE_SHARE_PARAM_KEYS) params.delete(key);
  const identity = intelligenceShareIdentity(records, view.pinnedId);
  if (identity !== null && view.pinnedId !== defaults.pinnedId) params.set(MODEL_PARAM, identity);
  if (view.metric !== defaults.metric) params.set(RESOURCE_PARAM, TOKENS_RESOURCE);
  if (view.weights === "open") params.set(WEIGHTS_PARAM, OPEN_WEIGHTS);
  if (view.weights === "closed") params.set(WEIGHTS_PARAM, CLOSED_WEIGHTS);
  return params.toString();
}
