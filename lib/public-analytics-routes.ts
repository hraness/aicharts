/**
 * Small client-safe allowlists for public dynamic routes.
 *
 * Keep these identifiers bounded: analytics may retain them as content IDs, while
 * every other route-shaped value collapses to the shared `other` bucket.
 */
export const PUBLIC_BLOG_SLUGS = [
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
  "/models/alibaba/qwen3.7-plus/default",
  "/models/alibaba/qwen3.8-max/default",
  "/models/anthropic/claude-fable-5/low",
  "/models/anthropic/claude-fable-5/medium",
  "/models/anthropic/claude-fable-5/high",
  "/models/anthropic/claude-fable-5/xhigh",
  "/models/anthropic/claude-fable-5/max",
  "/models/anthropic/claude-fable-5.1/max",
  "/models/anthropic/claude-opus-4.7/medium",
  "/models/anthropic/claude-opus-4.7/max",
  "/models/anthropic/claude-opus-4.8/low",
  "/models/anthropic/claude-opus-4.8/medium",
  "/models/anthropic/claude-opus-4.8/high",
  "/models/anthropic/claude-opus-4.8/xhigh",
  "/models/anthropic/claude-opus-4.8/max",
  "/models/anthropic/claude-opus-5/none",
  "/models/anthropic/claude-opus-5/low",
  "/models/anthropic/claude-opus-5/medium",
  "/models/anthropic/claude-opus-5/high",
  "/models/anthropic/claude-opus-5/xhigh",
  "/models/anthropic/claude-opus-5/max",
  "/models/anthropic/claude-sonnet-4.6/medium",
  "/models/cognition/swe-1.7/default",
  "/models/cursor/composer-2.5/default",
  "/models/cursor/composer-2.5-fast/default",
  "/models/deepseek/deepseek-v4-flash-0731/max",
  "/models/deepseek/deepseek-v4-pro/high",
  "/models/deepseek/deepseek-v4-pro-0813/max",
  "/models/google/gemini-3.1-pro/high",
  "/models/google/gemini-3.6-flash/high",
  "/models/google/gemini-3.7-flash/high",
  "/models/google/gemini-3.8-flash/high",
  "/models/meta/muse-spark-1.1/xhigh",
  "/models/meta/muse-spark-1.2/xhigh",
  "/models/meta/muse-spark-1.3/xhigh",
  "/models/meta/muse-spark-1.3/max",
  "/models/moonshotai/kimi-k2.6/default",
  "/models/moonshotai/kimi-k3/default",
  "/models/openai/gpt-5.5/medium",
  "/models/openai/gpt-5.5/xhigh",
  "/models/openai/gpt-5.6-luna/none",
  "/models/openai/gpt-5.6-luna/low",
  "/models/openai/gpt-5.6-luna/medium",
  "/models/openai/gpt-5.6-luna/high",
  "/models/openai/gpt-5.6-luna/xhigh",
  "/models/openai/gpt-5.6-luna/max",
  "/models/openai/gpt-5.6-sol/none",
  "/models/openai/gpt-5.6-sol/low",
  "/models/openai/gpt-5.6-sol/medium",
  "/models/openai/gpt-5.6-sol/high",
  "/models/openai/gpt-5.6-sol/xhigh",
  "/models/openai/gpt-5.6-sol/max",
  "/models/openai/gpt-5.6-terra/none",
  "/models/openai/gpt-5.6-terra/low",
  "/models/openai/gpt-5.6-terra/medium",
  "/models/openai/gpt-5.6-terra/high",
  "/models/openai/gpt-5.6-terra/xhigh",
  "/models/openai/gpt-5.6-terra/max",
  "/models/openai/gpt-6-astra/max",
  "/models/spacexai/grok-4.5/high",
  "/models/zai/glm-5.1/default",
  "/models/zai/glm-5.2/default",
] as const;

const publicModelCardPathSet = new Set<string>(PUBLIC_MODEL_CARD_PATHS);

export function isPublicModelCardPath(value: unknown): boolean {
  return typeof value === "string" && publicModelCardPathSet.has(value);
}
