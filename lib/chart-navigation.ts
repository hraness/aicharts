const atlasKeys = ["atlas", "task", "atlasView", "atlasPoint", "atlasCompare", "atlasProvider", "atlasAll", "atlasProfiles"] as const;
const codingKeys = ["benchmark", "compare", "point", "provider"] as const;
const codingAnchors = new Set(["#chart", "#coding-agents", "#model-updates", "#coding-agent-chart-title"]);

/** Old home links retain their state; destinations are fixed same-origin routes. */
export function legacyChartDestination(pathname: unknown, search: unknown, hash: unknown = ""): string | null {
  if (pathname !== "/" || typeof search !== "string" || typeof hash !== "string") return null;
  const params = new URLSearchParams(search);
  const query = params.size === 0 ? "" : `?${params.toString()}`;
  if (params.has("atlas") || hash === "#explore") return `/benchmarks${query}#explore`;
  if (codingKeys.some(key => params.has(key)) || codingAnchors.has(hash)) {
    return `/coding${query}${codingAnchors.has(hash) ? hash : "#coding-agents"}`;
  }
  if (atlasKeys.some(key => params.has(key))) return `/benchmarks${query}#explore`;
  return null;
}
