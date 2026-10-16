import { PUBLIC_MODEL_CARD_PATHS } from "./public-model-card-paths.generated";

/**
 * Small client-safe allowlists for public dynamic routes.
 *
 * Keep these identifiers bounded: analytics may retain them as content IDs, while
 * every other route-shaped value collapses to the shared `other` bucket. Model-card
 * paths are generated from the published coding cards and Index pages so a data
 * refresh can admit a new route without a hand-edited list.
 */

export { PUBLIC_MODEL_CARD_PATHS };
export const PUBLIC_BLOG_SLUGS = [
  "introducing-ai-charts",
  "gemini-4-argon-coding-agent-index",
  "gpt-6-1-sol-coding-agent-index",
  "opus-5-5-coding-agent-index",
  "sonnet-5-5-coding-agent-index",
  "opus-5-5-intelligence-index",
  "haiku-5-5-intelligence-index",
  "gpt-6-sol-coding-agent-index",
  "grok-4-7-coding-agent-index",
  "mimo-v2-6-pro-cost-frontier",
  "harness-design-coding-agents",
  "harnesstax-coding-agent-harness",
  "real-swe-private-enterprise-benchmark",
  "devin-fusion-cost-saving",
  "terminal-bench-science",
  "small-models-have-arrived",
  "coding-agent-score-holdouts",
  "open-models-coding-agent-benchmarks",
  "aa-index-cost-coding-agents",
  "mirrorcode-coding-agent-benchmark",
] as const;

export type PublicBlogSlug = typeof PUBLIC_BLOG_SLUGS[number];

const publicBlogSlugSet = new Set<string>(PUBLIC_BLOG_SLUGS);

export function isPublicBlogSlug(value: unknown): value is PublicBlogSlug {
  return typeof value === "string" && publicBlogSlugSet.has(value);
}

const publicModelCardPathSet = new Set<string>(PUBLIC_MODEL_CARD_PATHS);

export function isPublicModelCardPath(value: unknown): boolean {
  return typeof value === "string" && publicModelCardPathSet.has(value);
}
