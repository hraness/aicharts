/**
 * Small client-safe allowlists for public dynamic routes.
 *
 * Keep these identifiers bounded: analytics may retain them as content IDs, while
 * every other route-shaped value collapses to the shared `other` bucket.
 */
export const PUBLIC_BLOG_SLUGS = [
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

export const PUBLIC_MODEL_CARD_PATHS = [
  "/models/alibaba/qwen3.8-max/default",
  "/models/anthropic/claude-fable-5.1/max",
  "/models/anthropic/claude-opus-5/max",
  "/models/deepseek/deepseek-v4-flash-0731/max",
  "/models/deepseek/deepseek-v4-pro-0813/max",
  "/models/google/gemini-3.8-flash/high",
  "/models/meta/muse-spark-1.3/xhigh",
  "/models/meta/muse-spark-1.3/max",
  "/models/moonshotai/kimi-k3/default",
  "/models/openai/gpt-5.6-luna/max",
  "/models/openai/gpt-5.6-sol/max",
  "/models/openai/gpt-6-astra/max",
  "/models/unlisted/claude-fable-5-1-xhigh-swe-2-medium.e2f060e68d045988c8f73d9b/default",
  "/models/unlisted/glm-5-3.fffd32adf07098d3cd835ee1/default",
  "/models/unlisted/gpt-6-astra-xhigh-swe-2-medium.54c5f1484f55a9b95f428406/default",
  "/models/unlisted/gpt-6-luna.e5786855c646d1b4080cc158/max",
  "/models/unlisted/gpt-6-sol.51d76cb8a0598a113a64caf1/max",
  "/models/unlisted/grok-4-6.8d0cb9ac05267687236dffd8/xhigh",
  "/models/unlisted/grok-4-7.4d350d6b4877df4c73975497/xhigh",
  "/models/anthropic/claude-opus-5-5/index",
  "/models/openai/gpt-6-luna/index",
  "/models/openai/gpt-6-sol/index",
  "/models/xai/grok-4-7/index",
  "/models/xiaomi/mimo-v2-6-pro/index",
  "/models/stepfun/step-5-preview/index",
  "/models/deepseek/deepseek-v4-1-flash/index",
] as const;

const publicModelCardPathSet = new Set<string>(PUBLIC_MODEL_CARD_PATHS);

export function isPublicModelCardPath(value: unknown): boolean {
  return typeof value === "string" && publicModelCardPathSet.has(value);
}
