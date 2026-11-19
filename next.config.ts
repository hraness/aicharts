import type { NextConfig } from "next";
// Relative import: the config is compiled before the "@/" path alias exists.
import { catalog } from "./lib/catalog";

type Redirect = Readonly<{ source: string; destination: string; permanent: true }>;

const modelPath = (slug: string) => (catalog.find(slug) ? `/models/${slug}` : "/models");

/** Posts from the earlier aicharts.io (hraness/aicharts-legacy) that search engines still list. */
const LEGACY_POSTS: Readonly<Record<string, string>> = {
  "introducing-ai-charts": "/blog/introducing-aicharts",
  "gemini-4-argon-coding-agent-index": modelPath("gemini-4-argon"),
  "gpt-6-1-sol-coding-agent-index": modelPath("gpt-6-1-sol"),
  "gpt-6-sol-coding-agent-index": modelPath("gpt-6-sol"),
  "opus-5-5-coding-agent-index": modelPath("claude-opus-5-5"),
  "opus-5-5-intelligence-index": modelPath("claude-opus-5-5"),
  "sonnet-5-5-coding-agent-index": modelPath("claude-sonnet-5-5"),
  "haiku-5-5-intelligence-index": modelPath("claude-haiku-5-5"),
  "muse-wonder-intelligence-index": "/blog",
  "kimi-k3-1-pro-intelligence-index": "/blog",
  "grok-4-7-coding-agent-index": "/blog",
  "mimo-v2-6-pro-cost-frontier": "/blog",
  "harness-design-coding-agents": "/blog",
  "harnesstax-coding-agent-harness": "/blog",
  "real-swe-private-enterprise-benchmark": "/blog",
  "devin-fusion-cost-saving": "/blog",
  "terminal-bench-science": "/blog",
  "small-models-have-arrived": "/blog",
  "coding-agent-score-holdouts": "/blog",
  "open-models-coding-agent-benchmarks": "/blog",
  "aa-index-cost-coding-agents": "/blog",
  "mirrorcode-coding-agent-benchmark": "/blog",
};

const permanent = (source: string, destination: string): Redirect => ({
  source,
  destination,
  permanent: true,
});

export function siteRedirects(): Redirect[] {
  return [
    // Comparison pages list the newer model first; the other order points there.
    ...catalog.pairs.map((pair) =>
      permanent(`/compare/${pair.reverseSlug}`, `/compare/${pair.slug}`),
    ),
    // Legacy model profiles: /models/<lab>/<model>/<profile>.
    ...catalog.releases.map((release) =>
      permanent(`/models/:creator/${release.slug}/:profile*`, `/models/${release.slug}`),
    ),
    permanent("/models/:creator/:model/:rest*", "/models"),
    ...Object.entries(LEGACY_POSTS).map(([slug, to]) => permanent(`/blog/${slug}`, to)),
    permanent("/blog/feed.xml", "/blog"),
    permanent("/benchmarks", "/"),
    permanent("/coding", "/"),
    permanent("/preview", "/"),
    permanent("/calculator", "/models"),
    permanent("/data", "/api/releases"),
    permanent("/data/:path*", "/api/releases"),
    permanent("/api/markdown/:path*", "/llms.txt"),
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "codingchart.com" }],
        destination: "https://aicharts.io/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.codingchart.com" }],
        destination: "https://aicharts.io/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.aicharts.io" }],
        destination: "https://aicharts.io/:path*",
        permanent: true,
      },
      ...siteRedirects(),
    ];
  },
};

export default nextConfig;
