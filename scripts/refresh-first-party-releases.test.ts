import { describe, expect, test } from "bun:test";

import {
  FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS,
  deriveFirstPartyReleaseRadar,
  emptyFirstPartyReleaseRadar,
  namedModelsForProviderUrl,
  observeFirstPartyReleaseSource,
  parseFirstPartyReleaseRadar,
  parsePreviousFirstPartyReleaseRadar,
  parseProviderSitemap,
  releaseCandidateNamesForProviderUrl,
  releaseCandidateNamesForSourceUrl,
  sourceAcceptsContentType,
  validateFirstPartyReleaseReplacement,
  type FetchedSitemap,
  type FirstPartyReleaseRadar,
  type FirstPartyReleaseSourceDefinition,
  type FirstPartyReleaseSourceObservation,
} from "../lib/first-party-release-data";
import { assertProperty, fc } from "../lib/property-test";
import { err, ok } from "../lib/result";
import {
  fetchFirstPartyReleaseSource,
  FirstPartyReleaseRefreshDegradedError,
  refreshFirstPartyReleaseRadar,
} from "./refresh-first-party-releases";

const observedAt = "2026-09-02T18:00:00.000Z";

function sourceDefinition(
  id: (typeof FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS)[number]["id"],
): FirstPartyReleaseSourceDefinition {
  const definition = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.find(item => item.id === id);
  if (definition === undefined) throw new Error(`Missing first-party source ${id}.`);
  return definition;
}

const anthropic = sourceDefinition("anthropic-sitemap");
const openai = sourceDefinition("openai-release-sitemap");
const meta = sourceDefinition("meta-research-sitemap");
const openAiSafety = sourceDefinition("openai-safety-sitemap");
const openAiCatalog = sourceDefinition("openai-model-catalog");
const xai = sourceDefinition("xai-release-notes");
const zai = sourceDefinition("zai-release-notes");
const qwen = sourceDefinition("qwen-model-releases");
const minimax = sourceDefinition("minimax-model-releases");
const nvidia = sourceDefinition("nvidia-nemotron-rss");
const amazon = sourceDefinition("amazon-nova-rss");
const baidu = sourceDefinition("baidu-ernie-sitemap");
const deepseekApi = sourceDefinition("deepseek-api-sitemap");

function sitemap(entries: readonly Readonly<{ lastmod?: string; url: string }>[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(entry => (
      [
        `<url><loc>${entry.url.replaceAll("&", "&amp;")}</loc>`,
        entry.lastmod === undefined ? "" : `<lastmod>${entry.lastmod}</lastmod>`,
        "</url>",
      ].join("")
    )),
    "</urlset>",
  ].join("\n");
}

function rss(entries: readonly Readonly<{ date: string; title: string; url: string }>[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel>',
    ...entries.map(entry => [
      "<item>",
      `<title><![CDATA[${entry.title}]]></title>`,
      `<link>${entry.url}</link>`,
      `<pubDate>${entry.date}</pubDate>`,
      "</item>",
    ].join("")),
    "</channel></rss>",
  ].join("\n");
}

function anthropicXml(includeLatest = true): string {
  const candidates = [
    ...(includeLatest ? [{
      lastmod: "2026-09-02T13:38:25.952Z",
      url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    }] : []),
    {
      lastmod: "2026-05-21T15:00:00.000Z",
      url: "https://www.anthropic.com/news/claude-fable-5-mythos-5",
    },
    {
      lastmod: "2026-06-30T18:11:23.000Z",
      url: "https://www.anthropic.com/news/claude-5-0-sonnet",
    },
    {
      lastmod: "2026-08-27T15:13:34.000Z",
      url: "https://www.anthropic.com/news/claude-for-life-sciences",
    },
  ];
  const fillerCount = anthropic.minimumEntryCount - candidates.length;
  return sitemap([
    ...candidates,
    ...Array.from({ length: fillerCount }, (_, index) => ({
      lastmod: "2026-08-01T00:00:00.000Z",
      url: `https://www.anthropic.com/policy/example-${index}`,
    })),
  ]);
}

function openAiXml(): string {
  const candidates = [
    { lastmod: "2026-09-02T07:19:03.357Z", url: "https://openai.com/index/gpt-5-6/" },
    { lastmod: "2026-07-01T00:00:00.000Z", url: "https://openai.com/index/introducing-gpt-5-5/" },
    { lastmod: "2026-06-01T00:00:00.000Z", url: "https://openai.com/index/gpt-5-3-codex-spark/" },
    { lastmod: "2026-05-01T00:00:00.000Z", url: "https://openai.com/index/previewing-gpt-5-6-sol/" },
    { lastmod: "2026-04-01T00:00:00.000Z", url: "https://openai.com/index/o3-mini/" },
  ];
  return sitemap([
    ...candidates,
    ...Array.from({ length: openai.minimumEntryCount - candidates.length }, (_, index) => ({
      lastmod: "2026-03-01T00:00:00.000Z",
      url: `https://openai.com/index/company-update-${index}/`,
    })),
  ]);
}

function openAiSafetyXml(): string {
  const candidates = [
    {
      lastmod: "2026-09-03T14:00:00.000Z",
      url: "https://openai.com/index/safety-overview-gpt-6-astra/",
    },
  ];
  return sitemap([
    ...candidates,
    ...Array.from({ length: openAiSafety.minimumEntryCount - candidates.length }, (_, index) => ({
      lastmod: "2026-08-01T00:00:00.000Z",
      url: `https://openai.com/index/safety-note-${index}/`,
    })),
  ]);
}

function openAiCatalogMarkdown(): string {
  return [
    "# Models",
    "## Featured models",
    "- [GPT-6 Astra](/api/docs/models/gpt-6-astra): Latest frontier model.",
    "- [GPT-5.6](/api/docs/models/gpt-5.6): General-purpose model.",
    "- [GPT-5.6 Sol](/api/docs/models/gpt-5.6-sol): Coding model.",
    "## All models",
    "Additional catalog content.",
  ].join("\n");
}

function metaXml(): string {
  return sitemap([
    { lastmod: "2026-09-02", url: "https://research.meta.ai" },
    { lastmod: "2026-09-02", url: "https://research.meta.ai/blog" },
    { lastmod: "2026-09-02", url: "https://research.meta.ai/blog/introducing-muse-spark-1-3" },
    { lastmod: "2026-09-01", url: "https://research.meta.ai/blog/introducing-muse-voice-transcribe" },
    { lastmod: "2026-08-20", url: "https://research.meta.ai/blog/multimodal-intelligence-of-muse-spark-1-2" },
    { lastmod: "2026-08-14", url: "https://research.meta.ai/blog/addressing-third-party-testing-misconfiguration-muse-spark-1-1" },
    { lastmod: "2026-08-10", url: "https://research.meta.ai/blog/introducing-muse-glimmer-open-agentic-model" },
    { lastmod: "2026-08-05", url: "https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2" },
    { lastmod: "2026-07-09", url: "https://research.meta.ai/blog/introducing-muse-spark-meta-model-api" },
  ]);
}

function xaiMarkdown(): string {
  return [
    "# Release Notes",
    "## September",
    "### Grok 4.6",
    "### Grok 4.5",
    ...Array.from({ length: xai.minimumEntryCount - 2 }, (_, index) => `### Platform update ${index}`),
  ].join("\n");
}

function zaiMarkdown(): string {
  return [
    "# New Released",
    "## Models",
    ...Array.from({ length: zai.minimumEntryCount }, (_, index) => (
      `<Update label="2026-08-${String(index + 1).padStart(2, "0")}" description="GLM-${index + 1}">\nDetails\n</Update>`
    )),
  ].join("\n");
}

function qwenMarkdown(): string {
  return [
    "# Model releases",
    '<Update label="2026-08-27">',
    ...Array.from({ length: qwen.minimumEntryCount }, (_, index) => `### Qwen3.${index + 1}`),
    "</Update>",
  ].join("\n");
}

function deepSeekUpdatesHtml(): string {
  const modelEntries = Array.from({ length: 19 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    id: `deepseek-v${index + 1}-0-release`,
    title: `DeepSeek-V${index + 1}.0 Release`,
  }));
  const entries = [
    ...modelEntries,
    { date: "2024-08-02", id: "api-launches-context-caching-on-disk-technology", title: "API Launches Context Caching on Disk Technology" },
    { date: "2024-07-25", id: "new-api-features", title: "New API Features" },
  ];
  return [
    "<!doctype html>",
    "<html><body><main><article>",
    '<div class="theme-doc-markdown markdown">',
    "<h1>Change Log</h1>",
    ...entries.flatMap(entry => [
      `<h2 id="date-${entry.date}">Date: ${entry.date}<a href="#date-${entry.date}">​</a></h2>`,
      `<h3 id="${entry.id}">${entry.title}<a href="#${entry.id}">​</a></h3>`,
      "<p>Provider-owned release detail.</p>",
    ]),
    "</div></article></main></body></html>",
  ].join("\n");
}

function minimaxMarkdown(): string {
  return [
    "# Models",
    "#### 2026-08-27",
    ...Array.from({ length: minimax.minimumEntryCount }, (_, index) => (
      `<Card title="MiniMax M${index + 1}" href="/models/minimax-m${index + 1}">\nDetails\n</Card>`
    )),
  ].join("\n");
}

function nvidiaRss(): string {
  return rss([
    {
      date: "Wed, 02 Sep 2026 15:00:00 +0000",
      title: "NVIDIA Nemotron 3 Super is now available",
      url: "https://blogs.nvidia.com/blog/nemotron-3-super/",
    },
    ...Array.from({ length: nvidia.minimumEntryCount - 1 }, (_, index) => ({
      date: "Tue, 01 Sep 2026 15:00:00 +0000",
      title: `AI infrastructure update ${index}`,
      url: `https://blogs.nvidia.com/blog/ai-infrastructure-update-${index}/`,
    })),
  ]);
}

function amazonRss(): string {
  const candidates = [
    ["Amazon Nova 2 Lite is now available", "introducing-amazon-nova-2-lite"],
    ["Amazon Nova 2 Sonic is now available", "introducing-amazon-nova-2-sonic"],
    ["Amazon Nova Premier is now available", "amazon-nova-premier"],
    ["Amazon Nova Reel 1.1 is now available", "amazon-nova-reel-1-1"],
  ] as const;
  return rss([
    ...candidates.map(([title, slug]) => ({
      date: "Wed, 02 Sep 2026 15:00:00 +0000",
      title,
      url: `https://aws.amazon.com/blogs/aws/${slug}/`,
    })),
    ...Array.from({ length: amazon.minimumEntryCount - candidates.length }, (_, index) => ({
      date: "Tue, 01 Sep 2026 15:00:00 +0000",
      title: `AWS infrastructure update ${index}`,
      url: `https://aws.amazon.com/blogs/aws/infrastructure-update-${index}/`,
    })),
  ]);
}

function baiduXml(): string {
  const candidates = Array.from({ length: baidu.minimumCandidateCount }, (_, index) => ({
    lastmod: `2026-08-${String(index + 1).padStart(2, "0")}`,
    url: `/blog/posts/ernie-${index + 5}-0-preview`,
  }));
  return sitemap([
    ...candidates,
    ...Array.from({ length: baidu.minimumEntryCount - candidates.length }, (_, index) => ({
      url: `/blog/posts/research-update-${index}`,
    })),
  ]);
}

function standardSitemapFixture(
  definition: FirstPartyReleaseSourceDefinition,
  candidateUrls: readonly string[],
): string {
  const candidateEntries = candidateUrls.map((url, index) => ({
    ...(definition.datePolicy === "ignore" ? {} : {
      lastmod: `2026-08-${String((index % 27) + 1).padStart(2, "0")}`,
    }),
    url,
  }));
  const fillerEntries = Array.from({
    length: definition.minimumEntryCount - candidateEntries.length,
  }, (_, index) => ({
    ...(definition.datePolicy === "all" ? { lastmod: "2026-08-01" } : {}),
    url: `https://${definition.canonicalHost}/fixture/non-model-${index}`,
  }));
  return sitemap([...candidateEntries, ...fillerEntries]);
}

function metaNewsroomMarkdown(): string {
  return [
    "# Meta Newsroom",
    "## Content",
    "- [Introducing Muse Spark 1.3](https://about.fb.com/news/2026/09/introducing-muse-spark-1-3.md): Last updated 2026-09-02.",
    ...Array.from({ length: sourceDefinition("meta-newsroom-index").minimumEntryCount - 1 }, (_, index) => (
      `- [Company update ${index}](https://about.fb.com/news/2026/08/company-update-${index}.md): Last updated 2026-08-01.`
    )),
  ].join("\n");
}

type SourceFixture = Readonly<{ contentType: string; text: string }>;

function fixtureFor(definition: FirstPartyReleaseSourceDefinition): SourceFixture {
  switch (definition.id) {
    case "anthropic-sitemap": return { contentType: "application/xml", text: anthropicXml() };
    case "openai-release-sitemap": return { contentType: "application/xml", text: openAiXml() };
    case "meta-research-sitemap": return { contentType: "application/xml", text: metaXml() };
    case "openai-safety-sitemap": return { contentType: "application/xml", text: openAiSafetyXml() };
    case "openai-model-catalog": return { contentType: "text/markdown", text: openAiCatalogMarkdown() };
    case "meta-newsroom-index": return { contentType: "text/plain", text: metaNewsroomMarkdown() };
    case "google-deepmind-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://deepmind.google/models/model-cards/gemini-${index + 1}-0-pro/`
      ))),
    };
    case "xai-release-notes": return { contentType: "text/markdown", text: xaiMarkdown() };
    case "mistral-site-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://mistral.ai/news/announcing-mistral-${index + 1}`
      ))),
    };
    case "cohere-docs-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://docs.cohere.com/changelog/command-r-${index + 1}`
      ))),
    };
    case "deepseek-site-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://www.deepseek.com/en/news/deepseek-v${index + 1}-0-release`
      ))),
    };
    case "deepseek-api-sitemap": return {
      contentType: "text/html",
      text: deepSeekUpdatesHtml(),
    };
    case "zai-release-notes": return { contentType: "text/markdown", text: zaiMarkdown() };
    case "kimi-docs-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://platform.kimi.com/docs/guide/use-kimi-k2-${index + 5}-model`
      ))),
    };
    case "qwen-model-releases": return { contentType: "text/markdown", text: qwenMarkdown() };
    case "minimax-model-releases": return { contentType: "text/markdown", text: minimaxMarkdown() };
    case "bytedance-seed-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://seed.bytedance.com/blog/introducing-seedance-${index + 1}-0`
      ))),
    };
    case "microsoft-model-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://microsoft.ai/models/mai-${index + 1}-preview/`
      ))),
    };
    case "nvidia-nemotron-rss": return { contentType: "application/rss+xml", text: nvidiaRss() };
    case "amazon-nova-rss": return { contentType: "application/rss+xml", text: amazonRss() };
    case "baidu-ernie-sitemap": return { contentType: "application/xml", text: baiduXml() };
    case "tencent-post-sitemaps": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://www.tencent.com/tencent-releases-and-open-sources-tencent-hy${index + 4}-preview/`
      ))),
    };
    case "xiaomi-mimo-sitemap": return {
      contentType: "application/xml",
      text: standardSitemapFixture(definition, Array.from({ length: definition.minimumCandidateCount }, (_, index) => (
        `https://mimo.mi.com/docs/en-US/news/latest/v2-${index + 5}-tts-release/`
      ))),
    };
  }
}

function fetched(text: string, contentType = "application/xml"): FetchedSitemap {
  return {
    byteLength: new TextEncoder().encode(text).byteLength,
    contentType,
    httpStatus: 200,
    text,
  };
}

function observation(
  definition: FirstPartyReleaseSourceDefinition,
  xml: string,
  contentType = "application/xml",
): FirstPartyReleaseSourceObservation {
  const result = observeFirstPartyReleaseSource(definition, fetched(xml, contentType), observedAt);
  expect(result.ok).toBeTrue();
  if (!result.ok) throw result.error;
  return result.value;
}

function currentObservations(): readonly FirstPartyReleaseSourceObservation[] {
  return [
    observation(anthropic, anthropicXml()),
    observation(openai, openAiXml()),
    observation(meta, metaXml()),
  ];
}

function configuredObservations(): readonly FirstPartyReleaseSourceObservation[] {
  return FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.map(definition => {
    const fixture = fixtureFor(definition);
    return observation(definition, fixture.text, fixture.contentType);
  });
}

describe("first-party release URL recognition", () => {
  test("keeps the tracked lab registry broad and its legacy source prefix stable", () => {
    expect(FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS).toHaveLength(23);
    expect(new Set(FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.map(source => source.providerId)).size)
      .toBe(19);
    expect(FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.slice(0, 3).map(source => source.id)).toEqual([
      "anthropic-sitemap",
      "openai-release-sitemap",
      "meta-research-sitemap",
    ]);
  });

  test("recognizes an official model-release route for every tracked provider", () => {
    const cases = [
      {
        expectedIdentity: /Qwen3/u,
        providerId: "alibaba_cloud",
        url: "https://docs.qwencloud.com/changelog/models#2026-08-27-qwen3-8-plus",
      },
      {
        expectedIdentity: /Amazon Nova 2 Lite/u,
        providerId: "amazon",
        url: "https://aws.amazon.com/blogs/aws/introducing-amazon-nova-2-lite/",
      },
      {
        expectedIdentity: /Claude Fable 5\.1/u,
        providerId: "anthropic",
        url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
      },
      {
        expectedIdentity: /ERNIE 5\.0/u,
        providerId: "baidu",
        url: "https://ernie.baidu.com/blog/posts/ernie-5-0-preview",
      },
      {
        expectedIdentity: /Seedance 2\.0/u,
        providerId: "bytedance",
        url: "https://seed.bytedance.com/blog/introducing-seedance-2-0",
      },
      {
        expectedIdentity: /Command A Vision/u,
        providerId: "cohere",
        url: "https://docs.cohere.com/changelog/command-a-vision",
      },
      {
        expectedIdentity: /DeepSeek V3\.2/u,
        providerId: "deepseek",
        url: "https://www.deepseek.com/en/news/DeepSeek-V3.2-Release",
      },
      {
        expectedIdentity: /Gemini 3\.8 Pro/u,
        providerId: "google",
        url: "https://deepmind.google/models/model-cards/gemini-3-8-pro/",
      },
      {
        expectedIdentity: /Muse Spark 1\.3/u,
        providerId: "meta",
        url: "https://about.fb.com/news/2026/09/introducing-muse-spark-1-3/",
      },
      {
        expectedIdentity: /MAI 2 Preview/u,
        providerId: "microsoft",
        url: "https://microsoft.ai/models/mai-2-preview/",
      },
      {
        expectedIdentity: /MiniMax M3/u,
        providerId: "minimax",
        url: "https://platform.minimax.io/docs/release-notes/models#2026-08-25-minimax-m3",
      },
      {
        expectedIdentity: /Devstral 2/u,
        providerId: "mistral",
        url: "https://mistral.ai/news/announcing-devstral-2",
      },
      {
        expectedIdentity: /Kimi K2/u,
        providerId: "moonshot_ai",
        url: "https://platform.kimi.com/docs/guide/use-kimi-k2-5-model",
      },
      {
        expectedIdentity: /NVIDIA Nemotron 3 Super/u,
        providerId: "nvidia",
        url: "https://blogs.nvidia.com/blog/nemotron-3-super/",
      },
      {
        expectedIdentity: /GPT-6 Astra/u,
        providerId: "openai",
        url: "https://developers.openai.com/api/docs/models/gpt-6-astra",
      },
      {
        expectedIdentity: /Tencent HY4 Preview/u,
        providerId: "tencent",
        url: "https://www.tencent.com/tencent-releases-and-open-sources-tencent-hy4-preview/",
      },
      {
        expectedIdentity: /Grok 4\.6/u,
        providerId: "xai",
        url: "https://docs.x.ai/developers/release-notes#grok-4-6",
      },
      {
        expectedIdentity: /MiMo v2\.5 TTS/u,
        providerId: "xiaomi",
        url: "https://mimo.mi.com/docs/en-US/news/latest/v2-5-tts-release/",
      },
      {
        expectedIdentity: /GLM 5/u,
        providerId: "z_ai",
        url: "https://docs.z.ai/release-notes/new-released#2026-08-26-glm-5",
      },
      {
        expectedIdentity: /^GLM-4\.6V$/u,
        providerId: "z_ai",
        url: "https://docs.z.ai/release-notes/new-released#2025-12-08-glm-4-6v",
      },
      {
        expectedIdentity: /^GLM-4\.5V$/u,
        providerId: "z_ai",
        url: "https://docs.z.ai/release-notes/new-released#2025-08-11-glm-4-5v",
      },
    ] as const;

    for (const item of cases) {
      expect(
        namedModelsForProviderUrl(item.providerId, item.url).some(model => (
          item.expectedIdentity.test(model)
        )),
        `${item.providerId} should recognize ${item.url}`,
      ).toBeTrue();
    }
  });

  test("names both models on Anthropic's combined Fable and Mythos 5.1 release", () => {
    expect(namedModelsForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    )).toEqual(["Claude Fable 5.1", "Claude Mythos 5.1"]);
  });

  test("uses reviewed exact identities for irregular Anthropic model-release routes", () => {
    expect(namedModelsForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/claude-4",
    )).toEqual(["Claude Opus 4", "Claude Sonnet 4"]);
    expect(namedModelsForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/claude-3-family",
    )).toEqual(["Claude 3 Opus", "Claude 3 Sonnet"]);
    expect(namedModelsForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/claude-3-haiku",
    )).toEqual(["Claude 3 Haiku"]);
    expect(namedModelsForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/claude-2-1",
    )).toEqual(["Claude 2.1"]);
    expect(namedModelsForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/claude-gov-models-for-u-s-national-security-customers",
    )).toEqual(["Claude Gov models"]);
  });

  test("recognizes current OpenAI flagship and variant release routes without treating reports as models", () => {
    expect(namedModelsForProviderUrl("openai", "https://openai.com/index/gpt-5-6/"))
      .toEqual(["GPT-5.6"]);
    expect(namedModelsForProviderUrl("openai", "https://openai.com/index/previewing-gpt-5-6-sol/"))
      .toEqual(["GPT-5.6 Sol"]);
    expect(namedModelsForProviderUrl("openai", "https://openai.com/index/introducing-o3-and-o4-mini/"))
      .toEqual(["o3", "o4-mini"]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/gpt-4o-mini-advancing-cost-efficient-intelligence/",
    )).toEqual(["GPT-4o Mini"]);
    expect(namedModelsForProviderUrl("openai", "https://openai.com/index/gpt-4v-system-card/"))
      .toEqual([]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/openai-o1-mini-advancing-cost-efficient-reasoning/",
    )).toEqual(["o1-mini"]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/openai-o3-mini/",
    )).toEqual(["o3-mini"]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/introducing-chatgpt-images-2-0/",
    )).toEqual(["GPT Image 2"]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/sora-2/",
    )).toEqual(["Sora 2", "Sora 2 Pro"]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/dall-e-3/",
    )).toEqual(["DALL·E 3"]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/dall-e-2/",
    )).toEqual(["DALL·E 2"]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/sora-2-system-card/",
    )).toEqual([]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/dall-e-3-report/",
    )).toEqual([]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/o3-mini-system-card/",
    )).toEqual([]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/introducing-o3-and-o4-mini-system-card/",
    )).toEqual([]);
    expect(namedModelsForProviderUrl(
      "openai",
      "https://openai.com/index/codex-1-evals/",
    )).toEqual([]);
  });

  test("names Muse families from Meta research posts and model docs without ingesting OpenRouter slugs", () => {
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-spark-1-3",
    )).toEqual(["Muse Spark 1.3"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2",
    )).toEqual(["Muse Code", "Muse Spark 1.2"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-glimmer-open-agentic-model",
    )).toEqual(["Muse Glimmer"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-spark-meta-model-api",
    )).toEqual(["Muse Spark"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://developer.meta.com/ai/models/muse-spark/",
    )).toEqual(["Muse Spark"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://developer.meta.com/ai/models/muse-code/",
    )).toEqual(["Muse Code"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://developer.meta.com/ai/models/muse-image/",
    )).toEqual(["Muse Image"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-image-1-0",
    )).toEqual(["Muse Image 1.0"]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/multimodal-intelligence-of-muse-spark-1-2",
    )).toEqual(["Muse Spark 1.2"]);
    expect(namedModelsForProviderUrl("meta", "https://research.meta.ai")).toEqual([]);
    expect(namedModelsForProviderUrl("meta", "https://research.meta.ai/blog")).toEqual([]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-voice-transcribe",
    )).toEqual([]);
    expect(namedModelsForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/muse-for-developers",
    )).toEqual([]);
  });

  test("routes unknown model-family announcement shapes into review instead of dropping them", () => {
    expect(releaseCandidateNamesForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/claude-lyric-6-0",
    )).toEqual(["Unresolved announcement: Claude Lyric 6.0"]);
    expect(releaseCandidateNamesForProviderUrl(
      "openai",
      "https://openai.com/index/introducing-nova-1/",
    )).toEqual(["Unresolved announcement: Introducing Nova 1"]);
    expect(releaseCandidateNamesForProviderUrl(
      "openai",
      "https://openai.com/index/gpt-6-nova/",
    )).toEqual(["Unresolved announcement: GPT 6 Nova"]);
    expect(releaseCandidateNamesForProviderUrl(
      "openai",
      "https://openai.com/index/gpt-5-safe-completions/",
    )).toEqual([]);
    expect(releaseCandidateNamesForProviderUrl(
      "openai",
      "https://openai.com/index/using-gpt-4-for-content-moderation/",
    )).toEqual([]);
    expect(releaseCandidateNamesForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/claude-for-life-sciences",
    )).toEqual([]);
    expect(releaseCandidateNamesForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/news/introducing-claude-tag",
    )).toEqual([]);
    expect(releaseCandidateNamesForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-lyric-2-0",
    )).toEqual(["Unresolved announcement: Introducing Muse Lyric 2.0"]);
    expect(releaseCandidateNamesForProviderUrl(
      "meta",
      "https://developer.meta.com/ai/models/muse-nova-3/",
    )).toEqual(["Unresolved announcement: Muse Nova 3"]);
    expect(releaseCandidateNamesForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/introducing-muse-voice-transcribe",
    )).toEqual([]);
    expect(releaseCandidateNamesForProviderUrl(
      "meta",
      "https://research.meta.ai/blog/quarterly-research-update",
    )).toEqual([]);
  });

  test("routes an unknown family from every tracked lab's high-signal surface into review", () => {
    const cases = [
      ["qwen-model-releases", "https://docs.qwencloud.com/changelog/models#september-3-2026-alibaba-aurora-1"],
      ["amazon-nova-rss", "https://aws.amazon.com/blogs/aws/introducing-amazon-aurora-1-model/"],
      ["anthropic-sitemap", "https://www.anthropic.com/news/claude-lyric-6-0"],
      ["baidu-ernie-sitemap", "https://ernie.baidu.com/blog/posts/aurora-1-release/"],
      ["bytedance-seed-sitemap", "https://seed.bytedance.com/blog/introducing-aurora-1"],
      ["cohere-docs-sitemap", "https://docs.cohere.com/changelog/aurora-1-model-launch"],
      ["deepseek-site-sitemap", "https://www.deepseek.com/en/news/aurora-1-release/"],
      ["google-deepmind-sitemap", "https://deepmind.google/models/model-cards/aurora-1/"],
      ["meta-research-sitemap", "https://research.meta.ai/blog/introducing-muse-lyric-2-0"],
      ["microsoft-model-sitemap", "https://microsoft.ai/models/aurora-1/"],
      ["minimax-model-releases", "https://platform.minimax.io/docs/release-notes/models#sep-3-2026-aurora-1"],
      ["mistral-site-sitemap", "https://mistral.ai/news/announcing-aurora-1/"],
      ["kimi-docs-sitemap", "https://platform.kimi.com/docs/guide/aurora-1-quickstart"],
      ["nvidia-nemotron-rss", "https://blogs.nvidia.com/blog/introducing-aurora-1-model/"],
      ["openai-model-catalog", "https://developers.openai.com/api/docs/models/aurora-1"],
      ["tencent-post-sitemaps", "https://www.tencent.com/tencent-releases-aurora-1-model/"],
      ["xai-release-notes", "https://docs.x.ai/developers/release-notes#aurora-1-is-live"],
      ["xiaomi-mimo-sitemap", "https://mimo.mi.com/docs/en-US/news/latest/aurora-1-release"],
      ["zai-release-notes", "https://docs.z.ai/release-notes/new-released#2026-09-03-aurora-1"],
    ] as const;

    expect(new Set(cases.map(([sourceId]) => sourceDefinition(sourceId).providerId)).size).toBe(19);
    for (const [sourceId, url] of cases) {
      expect(releaseCandidateNamesForSourceUrl(sourceId, url), `${sourceId} silently dropped ${url}`)
        .toHaveLength(1);
    }
    expect(releaseCandidateNamesForSourceUrl(
      "deepseek-api-sitemap",
      "https://api-docs.deepseek.com/updates/#2026-09-03-deepseek-aurora-1-release",
    )).toHaveLength(1);
  });

  test("keeps catalog integrations and corporate-number noise out of lab-owned candidates", () => {
    expect(releaseCandidateNamesForSourceUrl(
      "qwen-model-releases",
      "https://docs.qwencloud.com/changelog/models#august-19-2026-kimi-k3",
    )).toEqual([]);
    expect(releaseCandidateNamesForSourceUrl(
      "cohere-docs-sitemap",
      "https://docs.cohere.com/changelog/2025-05-14-oci-models-release-notes",
    )).toEqual([]);
    expect(releaseCandidateNamesForSourceUrl(
      "mistral-site-sitemap",
      "https://mistral.ai/news/september-24-release/",
    )).toEqual([]);
    expect(releaseCandidateNamesForSourceUrl(
      "tencent-post-sitemaps",
      "https://www.tencent.com/tencent-announces-three-payment-initiatives-at-apec-2026/",
    )).toEqual([]);
    expect(releaseCandidateNamesForSourceUrl(
      "tencent-post-sitemaps",
      "https://www.tencent.com/zh-cn/tencent-releases-aurora-1-model/",
    )).toEqual([]);
    expect(releaseCandidateNamesForSourceUrl(
      "deepseek-api-sitemap",
      "https://api-docs.deepseek.com/updates/#2024-07-25-new-api-features",
    )).toEqual([]);
    expect(releaseCandidateNamesForSourceUrl(
      "deepseek-api-sitemap",
      "https://api-docs.deepseek.com/updates/#2024-08-02-api-launches-context-caching-on-disk-technology",
    )).toEqual([]);
    const nonReleaseUrls = [
      ["cohere-docs-sitemap", "https://docs.cohere.com/changelog/aya-expanse-on-whatsapp"],
      ["cohere-docs-sitemap", "https://docs.cohere.com/changelog/commandr-082024-ft"],
      ["mistral-site-sitemap", "https://mistral.ai/news/mistral-x-humain/"],
      ["mistral-site-sitemap", "https://mistral.ai/news/mistral-afp/"],
      ["mistral-site-sitemap", "https://mistral.ai/news/mistral-vibe-2-0/"],
      ["kimi-docs-sitemap", "https://platform.kimi.com/docs/guide/kimi-k3-tool-calling-best-practice"],
      ["kimi-docs-sitemap", "https://platform.kimi.com/docs/guide/use-kimi-k3-to-setup-agent"],
      ["nvidia-nemotron-rss", "https://blogs.nvidia.com/blog/palantir-secure-ai-us-agencies-nemotron-open-models/"],
      ["amazon-nova-rss", "https://aws.amazon.com/blogs/aws/aws-weekly-review-amazon-nova-sonic-and-more/"],
      ["xai-release-notes", "https://docs.x.ai/developers/release-notes#agent-tools-adapt-to-grok-4-1-fast-models-and-tool-prices-dropped"],
    ] as const;
    for (const [sourceId, url] of nonReleaseUrls) {
      expect(releaseCandidateNamesForSourceUrl(sourceId, url), `${url} should stay outside the release queue`)
        .toEqual([]);
    }
  });

  test("names every versioned Muse family slug and ignores research posts that do not name a model", () => {
    const families = ["code", "glimmer", "image", "spark"] as const;
    assertProperty(fc.property(
      fc.constantFrom(...families),
      fc.integer({ min: 1, max: 9 }),
      fc.integer({ min: 0, max: 9 }),
      (family, major, minor) => {
        const displayFamily = `${family[0]?.toUpperCase() ?? ""}${family.slice(1)}`;
        expect(namedModelsForProviderUrl(
          "meta",
          `https://research.meta.ai/blog/introducing-muse-${family}-${major}-${minor}`,
        )).toEqual([`Muse ${displayFamily} ${major}.${minor}`]);
        expect(namedModelsForProviderUrl(
          "meta",
          `https://developer.meta.com/ai/models/muse-${family}/`,
        )).toEqual([`Muse ${displayFamily}`]);
      },
    ));
    assertProperty(fc.property(
      fc.array(fc.constantFrom("quarterly", "research", "safety", "policy", "update"), {
        minLength: 1,
        maxLength: 4,
      }),
      tokens => {
        const slug = tokens.join("-");
        expect(releaseCandidateNamesForProviderUrl(
          "meta",
          `https://research.meta.ai/blog/${slug}`,
        )).toEqual([]);
      },
    ));
  });
});

describe("first-party release source adapters", () => {
  test("discovers Astra from the API catalog even before the release sitemap names it", () => {
    const releaseObservation = observation(openai, openAiXml());
    const catalogObservation = observation(
      openAiCatalog,
      openAiCatalogMarkdown(),
      "text/markdown; charset=utf-8",
    );

    expect(releaseObservation.candidates.some(candidate => (
      candidate.namedModels.includes("GPT-6 Astra")
    ))).toBeFalse();
    expect(catalogObservation.candidates).toContainEqual({
      candidateDateMeaning: "first-observed",
      canonicalUrl: "https://developers.openai.com/api/docs/models/gpt-6-astra",
      namedModels: ["GPT-6 Astra"],
      sourceModifiedAt: null,
    });

    const radar = deriveFirstPartyReleaseRadar(
      [catalogObservation],
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    expect(radar.candidates.find(candidate => candidate.namedModels.includes("GPT-6 Astra")))
      .toMatchObject({
        candidateDate: observedAt.slice(0, 10),
        candidateDateMeaning: "first-observed",
        firstSeenAt: observedAt,
        sourceId: "openai-model-catalog",
        sourceModifiedAt: observedAt,
      });
  });

  test("also recognizes Astra in OpenAI's safety sitemap", () => {
    const result = observation(openAiSafety, openAiSafetyXml());

    expect(result.candidates).toContainEqual({
      candidateDateMeaning: "provider-sitemap-lastmod",
      canonicalUrl: "https://openai.com/index/safety-overview-gpt-6-astra/",
      namedModels: ["GPT-6 Astra"],
      sourceModifiedAt: "2026-09-03T14:00:00.000Z",
    });
  });

  test("parses RSS titles and publication dates without leaking CDATA syntax", () => {
    const nvidiaObservation = observation(nvidia, nvidiaRss(), "application/rss+xml");
    const amazonObservation = observation(amazon, amazonRss(), "application/rss+xml");

    expect(nvidiaObservation.source.health.shape).toMatchObject({
      candidateCount: 1,
      rootElement: "rss",
    });
    expect(nvidiaObservation.candidates[0]).toEqual({
      candidateDateMeaning: "provider-published-date",
      canonicalUrl: "https://blogs.nvidia.com/blog/nemotron-3-super/",
      namedModels: ["NVIDIA Nemotron 3 Super"],
      sourceModifiedAt: "2026-09-02T15:00:00.000Z",
    });
    expect(amazonObservation.source.health.shape).toMatchObject({
      candidateCount: 4,
      rootElement: "rss",
    });
    expect(amazonObservation.candidates.every(candidate => (
      candidate.candidateDateMeaning === "provider-published-date"
    ))).toBeTrue();
  });

  test("parses DeepSeek's dated API change log without admitting generic API news", () => {
    const result = observation(deepseekApi, deepSeekUpdatesHtml(), "text/html; charset=utf-8");
    expect(result.source.health.shape).toMatchObject({
      candidateCount: 19,
      entryCount: 21,
      rootElement: "html-release-notes",
    });
    expect(result.candidates).toContainEqual({
      candidateDateMeaning: "provider-published-date",
      canonicalUrl: "https://api-docs.deepseek.com/updates/#2026-08-01-deepseek-v1-0-release",
      namedModels: ["DeepSeek V1.0"],
      sourceModifiedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.candidates.some(candidate => (
      candidate.canonicalUrl.endsWith("new-api-features")
      || candidate.canonicalUrl.includes("context-caching")
    ))).toBeFalse();

    const malformed = deepSeekUpdatesHtml().replace(
      '<h3 id="deepseek-v1-0-release">',
      '<h4 id="deepseek-v1-0-release">',
    );
    expect(parseProviderSitemap(deepseekApi, malformed).ok).toBeFalse();
  });

  test("uses DeepSeek release detail for alias headings and ignores mutable ordinal anchors", () => {
    const aliasHtml = deepSeekUpdatesHtml()
      .replace(
        '<h3 id="deepseek-v1-0-release">DeepSeek-V1.0 Release<a href="#deepseek-v1-0-release">​</a></h3>',
        '<h3 id="deepseek-reasoner"><code>deepseek-reasoner</code><a href="#deepseek-reasoner">​</a></h3>',
      )
      .replace("Provider-owned release detail.", "Model upgraded to DeepSeek-R1-0528.");
    const first = observation(deepseekApi, aliasHtml, "text/html");
    const firstAlias = first.candidates.find(candidate => candidate.namedModels.includes("DeepSeek R1-0528"));
    expect(firstAlias).toMatchObject({
      canonicalUrl: "https://api-docs.deepseek.com/updates/#2026-08-01-deepseek-reasoner",
      sourceModifiedAt: "2026-08-01T00:00:00.000Z",
    });

    const renumbered = observation(
      deepseekApi,
      aliasHtml
        .replace('id="deepseek-reasoner"', 'id="deepseek-reasoner-9"')
        .replace('href="#deepseek-reasoner"', 'href="#deepseek-reasoner-9"'),
      "text/html",
    );
    expect(renumbered.candidates.find(candidate => candidate.namedModels.includes("DeepSeek R1-0528")))
      .toMatchObject({ canonicalUrl: firstAlias?.canonicalUrl });
  });

  test("parses every release-note Markdown shape with stable fragment identities", () => {
    const cases = [
      { definition: xai, expectedMeaning: "first-observed", text: xaiMarkdown() },
      { definition: zai, expectedMeaning: "provider-published-date", text: zaiMarkdown() },
      { definition: qwen, expectedMeaning: "provider-published-date", text: qwenMarkdown() },
      { definition: minimax, expectedMeaning: "provider-published-date", text: minimaxMarkdown() },
    ] as const;

    for (const item of cases) {
      const result = observation(item.definition, item.text, "text/markdown; charset=utf-8");
      expect(result.source.health.shape).toMatchObject({
        rootElement: "markdown-release-notes",
      });
      expect(result.source.health.shape.candidateCount)
        .toBeGreaterThanOrEqual(item.definition.minimumCandidateCount);
      expect(result.candidates.length).toBeGreaterThanOrEqual(item.definition.minimumCandidateCount);
      expect(result.candidates.every(candidate => (
        candidate.candidateDateMeaning === item.expectedMeaning
        && new URL(candidate.canonicalUrl).hash.length > 1
      ))).toBeTrue();
    }
  });

  test("preserves Z.ai vision-version suffixes from release-note titles", () => {
    const parsed = parseProviderSitemap(zai, zaiMarkdown().replace("GLM-1", "GLM-4.6V"));
    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.entries.some(entry => (
      entry.namedModels?.includes("GLM-4.6V") === true
      && entry.url.endsWith("#2026-08-01-glm-4-6v")
    ))).toBeTrue();
  });

  test("accepts Qwen's one explicit non-model availability update", () => {
    const parsed = parseProviderSitemap(
      qwen,
      `${qwenMarkdown()}\n<Update label="March 31, 2026">\n## General availability\n\nQwenCloud is now generally available.\n</Update>`,
    );
    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.entries).toHaveLength(qwen.minimumEntryCount);
  });

  test("rejects plausible Markdown release rows that do not match the owned source format", () => {
    const malformedSources = [
      {
        definition: openAiCatalog,
        text: openAiCatalogMarkdown().replace(
          "## All models",
          "- [GPT-7 Aurora](/api/docs/models/gpt-7-aurora.md)\n## All models",
        ),
      },
      {
        definition: sourceDefinition("meta-newsroom-index"),
        text: `${metaNewsroomMarkdown()}\n- [Introducing Muse Code 2](https://about.fb.com/news/2026/09/introducing-muse-code-2.md): Last updated`,
      },
      {
        definition: zai,
        text: `${zaiMarkdown()}\n<Update description="GLM-7" label="2026-09-03">\nDetails\n</Update>`,
      },
      {
        definition: qwen,
        text: `${qwenMarkdown()}\n<Update label="September 3, 2026">\n#### Qwen4 Max\n</Update>`,
      },
      {
        definition: minimax,
        text: `${minimaxMarkdown()}\n#### Sep. 3, 2026\n<Card icon="file-text" title="MiniMax M99">\nDetails\n</Card>`,
      },
      {
        definition: xai,
        text: `${xaiMarkdown()}\n###Grok 5`,
      },
    ] as const;

    for (const item of malformedSources) {
      const parsed = parseProviderSitemap(item.definition, item.text);
      expect(parsed.ok, `${item.definition.id} silently accepted a malformed row`).toBeFalse();
      if (parsed.ok) continue;
      expect(parsed.error.message).toContain("unparseable");
    }
  });

  test("fails closed on an unterminated Markdown code fence", () => {
    const source = `${xaiMarkdown()}\n\`\`\`text\n### Grok 99`;
    const parsed = parseProviderSitemap(xai, source);
    expect(parsed.ok).toBeFalse();
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("unterminated Markdown code fence");
  });

  test("resolves Baidu's relative sitemap locations and requires dates only on candidates", () => {
    const parsed = parseProviderSitemap(baidu, baiduXml());
    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.datedEntryCount).toBe(baidu.minimumCandidateCount);
    expect(parsed.value.entries[0]?.url).toBe("https://ernie.baidu.com/blog/posts/ernie-5-0-preview");
    expect(parsed.value.entries.at(-1)?.lastModifiedAt).toBeNull();

    const observed = observeFirstPartyReleaseSource(
      baidu,
      fetched(baiduXml()),
      observedAt,
    );
    expect(observed.ok).toBeTrue();
    if (!observed.ok) return;
    expect(observed.value.candidates).toHaveLength(baidu.minimumCandidateCount);

    const candidateMissingDate = baiduXml().replace("<lastmod>2026-08-01</lastmod>", "");
    expect(observeFirstPartyReleaseSource(
      baidu,
      fetched(candidateMissingDate),
      observedAt,
    ).ok).toBeFalse();
  });

  test("validates a complete observation set across every configured source shape", () => {
    const observations = configuredObservations();
    expect(observations).toHaveLength(FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.length);

    const radar = deriveFirstPartyReleaseRadar(
      observations,
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const parsed = parseFirstPartyReleaseRadar(radar);
    expect(parsed.ok, parsed.ok ? undefined : parsed.error.message).toBeTrue();
  });
});

describe("provider sitemap shape guards", () => {
  test("accepts exact source media types and rejects misleading substrings", () => {
    expect(sourceAcceptsContentType(anthropic, "application/xml; charset=utf-8")).toBeTrue();
    expect(sourceAcceptsContentType(nvidia, "application/rss+xml")).toBeTrue();
    expect(sourceAcceptsContentType(xai, "text/markdown; charset=utf-8")).toBeTrue();
    expect(sourceAcceptsContentType(deepseekApi, "text/html; charset=utf-8")).toBeTrue();
    expect(sourceAcceptsContentType(sourceDefinition("meta-newsroom-index"), "text/plain")).toBeTrue();
    expect(sourceAcceptsContentType(anthropic, "image/not-xml-at-all")).toBeFalse();
    expect(sourceAcceptsContentType(xai, "application/x-not-text/plain-ish")).toBeFalse();
    expect(sourceAcceptsContentType(deepseekApi, "application/xhtml+xml")).toBeFalse();
  });

  test("records exact source-health signals and the machine date's limited meaning", () => {
    const result = observeFirstPartyReleaseSource(
      anthropic,
      fetched(anthropicXml()),
      observedAt,
    );

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.source.health).toMatchObject({
      contentType: "application/xml",
      httpStatus: 200,
      shape: {
        candidateCount: 3,
        canonicalHostEntryCount: anthropic.minimumEntryCount,
        datedEntryCount: anthropic.minimumEntryCount,
        entryCount: anthropic.minimumEntryCount,
        rootElement: "urlset",
      },
      status: "healthy",
    });
    expect(result.value.candidates[0]).toMatchObject({
      canonicalUrl: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
      namedModels: ["Claude Fable 5.1", "Claude Mythos 5.1"],
      sourceModifiedAt: "2026-09-02T13:38:25.952Z",
    });
  });

  test("fails closed on a truncated sitemap, foreign host, or missing lastmod", () => {
    const truncated = sitemap([{
      lastmod: "2026-09-02T00:00:00.000Z",
      url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    }]);
    expect(parseProviderSitemap(anthropic, truncated).ok).toBeFalse();

    const foreign = anthropicXml().replace(
      "https://www.anthropic.com/policy/example-0",
      "https://example.com/policy/example-0",
    );
    expect(parseProviderSitemap(anthropic, foreign).ok).toBeFalse();

    const missingDate = anthropicXml().replace(
      "<lastmod>2026-08-01T00:00:00.000Z</lastmod>",
      "",
    );
    expect(parseProviderSitemap(anthropic, missingDate).ok).toBeFalse();

    const impossibleDate = anthropicXml().replace(
      "2026-08-01T00:00:00.000Z",
      "2026-02-30T00:00:00.000Z",
    );
    expect(parseProviderSitemap(anthropic, impossibleDate).ok).toBeFalse();

    const impossibleRssDate = nvidiaRss().replace(
      "Wed, 02 Sep 2026 15:00:00 +0000",
      "Mon, 30 Feb 2026 15:00:00 +0000",
    );
    expect(parseProviderSitemap(nvidia, impossibleRssDate).ok).toBeFalse();

    const hiddenSitemapRelease = anthropicXml().replace(
      "</urlset>",
      "<url><loc>https://www.anthropic.com/news/claude-never-seen-9</loc></urlset>",
    );
    expect(parseProviderSitemap(anthropic, hiddenSitemapRelease).ok).toBeFalse();

    const hiddenRssRelease = nvidiaRss().replace(
      "</channel>",
      "<item><title>NVIDIA Nemotron 9</title></channel>",
    );
    expect(parseProviderSitemap(nvidia, hiddenRssRelease).ok).toBeFalse();
  });

  test("keeps the newest lastmod for a duplicate provider URL and reports the duplicate", () => {
    const original = anthropicXml();
    const duplicate = original.replace(
      "</urlset>",
      [
        "<url>",
        "<loc>https://www.anthropic.com/policy/example-0</loc>",
        "<lastmod>2026-09-01T00:00:00.000Z</lastmod>",
        "</url>",
        "</urlset>",
      ].join(""),
    );
    const parsed = parseProviderSitemap(anthropic, duplicate);

    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      duplicateEntryCount: 1,
      entryCount: anthropic.minimumEntryCount + 1,
    });
    expect(parsed.value.entries.find(entry => entry.url.endsWith("/policy/example-0")))
      .toMatchObject({ lastModifiedAt: "2026-09-01T00:00:00.000Z" });
  });

  test("accepts Meta research's date-only lastmod values and selects Muse release posts", () => {
    const parsed = parseProviderSitemap(meta, metaXml());
    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.entryCount).toBe(9);
    expect(parsed.value.entries.find(entry => (
      entry.url.endsWith("/blog/introducing-muse-spark-1-3")
    ))).toMatchObject({ lastModifiedAt: "2026-09-02T00:00:00.000Z" });

    const result = observeFirstPartyReleaseSource(meta, fetched(metaXml()), observedAt);
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.source.health.shape.candidateCount).toBe(6);
    expect(result.value.candidates).toContainEqual({
      candidateDateMeaning: "provider-sitemap-lastmod",
      canonicalUrl: "https://research.meta.ai/blog/introducing-muse-spark-1-3",
      namedModels: ["Muse Spark 1.3"],
      sourceModifiedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(result.value.candidates.some(candidate => (
      candidate.canonicalUrl.includes("muse-voice-transcribe")
    ))).toBeFalse();
  });
});

describe("durable first-party candidate ledger", () => {
  test("accepts the legacy three-source schema as migration input and expands it without losing review", () => {
    const historical = deriveFirstPartyReleaseRadar(
      currentObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const legacy: FirstPartyReleaseRadar = {
      ...historical,
      candidates: historical.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, status: "confirmed-release" as const } : candidate
      )),
      schemaVersion: 1,
    };

    expect(parseFirstPartyReleaseRadar(legacy).ok).toBeFalse();
    expect(parsePreviousFirstPartyReleaseRadar(legacy).ok).toBeTrue();

    const migrated = deriveFirstPartyReleaseRadar(
      configuredObservations(),
      legacy,
      "2026-09-03T18:00:00.000Z",
    );
    const previouslyReviewed = legacy.candidates[0];
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.sources).toHaveLength(FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.length);
    expect(migrated.candidates.find(candidate => (
      candidate.canonicalUrl === previouslyReviewed?.canonicalUrl
    ))).toMatchObject({
      firstSeenAt: previouslyReviewed?.firstSeenAt,
      id: previouslyReviewed?.id,
      sourceId: previouslyReviewed?.sourceId,
      status: "confirmed-release",
    });
    expect(parseFirstPartyReleaseRadar(migrated).ok).toBeTrue();
    expect(validateFirstPartyReleaseReplacement(legacy, migrated).ok).toBeTrue();
  });

  test("keeps candidates discovery-only and preserves a manual disposition across refreshes", () => {
    const first = deriveFirstPartyReleaseRadar(
      currentObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const reviewed: FirstPartyReleaseRadar = {
      ...first,
      candidates: first.candidates.map(candidate => (
        candidate.canonicalUrl.includes("claude-fable-and-mythos")
          ? { ...candidate, status: "confirmed-release" as const }
          : candidate
      )),
    };
    const second = deriveFirstPartyReleaseRadar(
      currentObservations(),
      reviewed,
      "2026-09-03T18:00:00.000Z",
    );
    const latest = second.candidates.find(candidate => (
      candidate.canonicalUrl.includes("claude-fable-and-mythos")
    ));

    expect(first.policy).toEqual({
      durableCandidates: true,
      publication: "discovery-only",
      review: "manual-review-required",
    });
    expect(latest).toMatchObject({
      candidateDate: "2026-09-02",
      candidateDateMeaning: "provider-sitemap-lastmod",
      firstSeenAt: observedAt,
      lastChangedAt: observedAt,
      status: "confirmed-release",
    });
    expect(parsePreviousFirstPartyReleaseRadar(second).ok).toBeTrue();
    expect(validateFirstPartyReleaseReplacement(reviewed, second).ok).toBeTrue();
  });

  test("retains a disappeared provider URL and marks the source-presence transition", () => {
    const first = deriveFirstPartyReleaseRadar(
      currentObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const nextAnthropic = observation(anthropic, anthropicXml(false));
    const second = deriveFirstPartyReleaseRadar(
      [nextAnthropic, observation(openai, openAiXml()), observation(meta, metaXml())],
      first,
      "2026-09-03T18:00:00.000Z",
    );
    const retained = second.candidates.find(candidate => (
      candidate.canonicalUrl.includes("claude-fable-and-mythos")
    ));

    expect(retained).toMatchObject({
      firstSeenAt: observedAt,
      lastChangedAt: "2026-09-03T18:00:00.000Z",
      sourcePresence: "missing",
      status: "needs-review",
    });
    expect(parsePreviousFirstPartyReleaseRadar(second).ok).toBeTrue();
    expect(validateFirstPartyReleaseReplacement(first, second).ok).toBeTrue();
  });

  test("keeps literal sitemap presence separate from candidate selection", () => {
    const first = deriveFirstPartyReleaseRadar(
      currentObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const prior: FirstPartyReleaseRadar = {
      ...first,
      candidates: [
        ...first.candidates,
        {
          candidateDate: "2026-08-27",
          candidateDateMeaning: "provider-sitemap-lastmod",
          canonicalUrl: "https://www.anthropic.com/news/claude-for-life-sciences",
          firstSeenAt: observedAt,
          id: "anthropic:/news/claude-for-life-sciences",
          lastChangedAt: observedAt,
          namedModels: ["Unresolved announcement: Claude For Life Sciences"],
          providerId: "anthropic",
          providerName: "Anthropic",
          sourceId: "anthropic-sitemap",
          sourceModifiedAt: "2026-08-27T15:13:34.000Z",
          sourcePresence: "present",
          status: "not-a-release",
        },
      ],
    };
    const next = deriveFirstPartyReleaseRadar(
      currentObservations(),
      prior,
      "2026-09-03T18:00:00.000Z",
    );
    const retained = next.candidates.find(candidate => (
      candidate.canonicalUrl.endsWith("/news/claude-for-life-sciences")
    ));

    expect(retained).toMatchObject({
      lastChangedAt: observedAt,
      sourcePresence: "present",
      status: "not-a-release",
    });
    expect(parsePreviousFirstPartyReleaseRadar(next).ok).toBeTrue();
    expect(validateFirstPartyReleaseReplacement(prior, next).ok).toBeTrue();
  });

  test("keeps mutable source timestamps from rewriting discovery evidence", () => {
    const first = deriveFirstPartyReleaseRadar(
      currentObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const changedLastmod = anthropicXml().replace(
      "2026-09-02T13:38:25.952Z",
      "2026-09-03T13:38:25.952Z",
    );
    const second = deriveFirstPartyReleaseRadar(
      [
        observation(anthropic, changedLastmod),
        observation(openai, openAiXml()),
        observation(meta, metaXml()),
      ],
      first,
      "2026-09-03T18:00:00.000Z",
    );
    const before = first.candidates.find(candidate => (
      candidate.canonicalUrl.includes("claude-fable-and-mythos")
    ));
    const after = second.candidates.find(candidate => (
      candidate.canonicalUrl.includes("claude-fable-and-mythos")
    ));

    expect(after).toMatchObject({
      candidateDate: before?.candidateDate,
      lastChangedAt: before?.lastChangedAt,
      sourceModifiedAt: before?.sourceModifiedAt,
    });
  });

  test("rejects ledger deletion or refresh-driven review-status changes", () => {
    const previous = deriveFirstPartyReleaseRadar(
      currentObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const dropped = { ...previous, candidates: previous.candidates.slice(1) };
    expect(validateFirstPartyReleaseReplacement(previous, dropped).ok).toBeFalse();

    const statusChanged = {
      ...previous,
      candidates: previous.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, status: "not-a-release" as const } : candidate
      )),
    };
    expect(validateFirstPartyReleaseReplacement(previous, statusChanged).ok).toBeFalse();

    const identityChanged = {
      ...previous,
      candidates: previous.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, id: `${candidate.id}-rewritten` } : candidate
      )),
    };
    expect(validateFirstPartyReleaseReplacement(previous, identityChanged).ok).toBeFalse();

    const firstSeenChanged = {
      ...previous,
      candidates: previous.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, firstSeenAt: "2026-09-02T19:00:00.000Z" } : candidate
      )),
    };
    expect(validateFirstPartyReleaseReplacement(previous, firstSeenChanged).ok).toBeFalse();

    const ownershipChanged = {
      ...previous,
      candidates: previous.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, sourceId: openAiSafety.id } : candidate
      )),
    };
    expect(validateFirstPartyReleaseReplacement(previous, ownershipChanged).ok).toBeFalse();

    const sourceModifiedChanged = {
      ...previous,
      candidates: previous.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, sourceModifiedAt: "2026-09-02T19:00:00.001Z" } : candidate
      )),
    };
    expect(validateFirstPartyReleaseReplacement(previous, sourceModifiedChanged).ok).toBeFalse();

    const dateMeaningChanged = {
      ...previous,
      candidates: previous.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, candidateDateMeaning: "provider-index-lastmod" as const } : candidate
      )),
    };
    expect(validateFirstPartyReleaseReplacement(previous, dateMeaningChanged).ok).toBeFalse();

    const candidateDateChanged = {
      ...previous,
      candidates: previous.candidates.map((candidate, index) => (
        index === 0 ? { ...candidate, candidateDate: "2026-09-01" } : candidate
      )),
    };
    expect(validateFirstPartyReleaseReplacement(previous, candidateDateChanged).ok).toBeFalse();
  });

  test("rejects overlap and source-ownership transfer between same-provider feeds", () => {
    const releaseObservation = observation(openai, openAiXml());
    const overlappingSafety = observation(
      openAiSafety,
      openAiSafetyXml().replace(
        "https://openai.com/index/safety-overview-gpt-6-astra/",
        "https://openai.com/index/gpt-5-6/",
      ),
    );

    expect(() => deriveFirstPartyReleaseRadar(
      [releaseObservation, overlappingSafety],
      emptyFirstPartyReleaseRadar(),
      observedAt,
    )).toThrow("overlap candidate https://openai.com/index/gpt-5-6/");

    const previous = deriveFirstPartyReleaseRadar(
      [releaseObservation],
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    expect(() => deriveFirstPartyReleaseRadar(
      [overlappingSafety],
      previous,
      "2026-09-03T18:00:00.000Z",
    )).toThrow("changed source ownership");
  });
});

describe("first-party release refresh transaction", () => {
  test("writes one validated ledger only after every configured source passes", async () => {
    const writes: FirstPartyReleaseRadar[] = [];
    const result = await refreshFirstPartyReleaseRadar({
      fetchSitemap: async definition => {
        const fixture = fixtureFor(definition);
        return ok(fetched(fixture.text, fixture.contentType));
      },
      now: () => observedAt,
      readCommitted: async () => ok(emptyFirstPartyReleaseRadar()),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(writes).toEqual([result.value]);
    expect(result.value.sources.map(source => source.id)).toEqual(
      FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.map(source => source.id),
    );
    expect(result.value.candidates.some(candidate => (
      candidate.namedModels.includes("Claude Mythos 5.1")
    ))).toBeTrue();
    expect(result.value.candidates.some(candidate => (
      candidate.namedModels.includes("GPT-5.6")
    ))).toBeTrue();
    expect(result.value.candidates.some(candidate => (
      candidate.canonicalUrl === "https://research.meta.ai/blog/introducing-muse-spark-1-3"
      && candidate.namedModels.includes("Muse Spark 1.3")
      && candidate.status === "needs-review"
    ))).toBeTrue();
  });

  test("adds newly configured sources without dropping prior review statuses", async () => {
    const historical = deriveFirstPartyReleaseRadar(
      [observation(anthropic, anthropicXml()), observation(openai, openAiXml())],
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const reviewed: FirstPartyReleaseRadar = {
      ...historical,
      candidates: historical.candidates.map(candidate => (
        candidate.canonicalUrl.includes("claude-fable-and-mythos")
          ? { ...candidate, status: "confirmed-release" as const }
          : candidate
      )),
    };
    expect(parseFirstPartyReleaseRadar(reviewed).ok).toBeFalse();
    expect(parsePreviousFirstPartyReleaseRadar(reviewed).ok).toBeTrue();

    const writes: FirstPartyReleaseRadar[] = [];
    const result = await refreshFirstPartyReleaseRadar({
      fetchSitemap: async definition => {
        const fixture = fixtureFor(definition);
        return ok(fetched(fixture.text, fixture.contentType));
      },
      now: () => "2026-09-03T18:00:00.000Z",
      readCommitted: async () => ok(reviewed),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(writes).toEqual([result.value]);
    expect(result.value.sources.map(source => source.id)).toEqual(
      FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.map(source => source.id),
    );
    expect(result.value.candidates.find(candidate => (
      candidate.canonicalUrl.includes("claude-fable-and-mythos")
    ))).toMatchObject({
      firstSeenAt: observedAt,
      status: "confirmed-release",
    });
    expect(result.value.candidates.find(candidate => (
      candidate.canonicalUrl.endsWith("/blog/introducing-muse-spark-1-3")
    ))).toMatchObject({
      namedModels: ["Muse Spark 1.3"],
      status: "needs-review",
    });
    expect(parseFirstPartyReleaseRadar(result.value).ok).toBeTrue();
  });

  test("does not write when a newly configured source has no last-known-good snapshot", async () => {
    const historical = deriveFirstPartyReleaseRadar(
      currentObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const writes: FirstPartyReleaseRadar[] = [];
    const result = await refreshFirstPartyReleaseRadar({
      fetchSitemap: async definition => {
        if (definition.id === "google-deepmind-sitemap") {
          return err(new Error("Google source unavailable"));
        }
        const fixture = fixtureFor(definition);
        return ok(fetched(fixture.text, fixture.contentType));
      },
      now: () => "2026-09-03T18:00:00.000Z",
      readCommitted: async () => ok(historical),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.error.message).toContain("google-deepmind-sitemap");
    expect(writes).toEqual([]);
  });

  test("writes healthy-source discoveries, retains failed-source evidence, and reports degraded", async () => {
    const initial = deriveFirstPartyReleaseRadar(
      configuredObservations(),
      emptyFirstPartyReleaseRadar(),
      observedAt,
    );
    const reviewed: FirstPartyReleaseRadar = {
      ...initial,
      candidates: initial.candidates.map(candidate => (
        candidate.canonicalUrl.includes("claude-fable-and-mythos")
          ? { ...candidate, status: "confirmed-release" as const }
          : candidate
      )),
    };
    expect(parseFirstPartyReleaseRadar(reviewed).ok).toBeTrue();

    const nextObservedAt = "2026-09-03T18:00:00.000Z";
    const newOpenAiUrl = "https://openai.com/index/gpt-6-nova/";
    const openAiWithDiscovery = openAiXml().replace(
      "</urlset>",
      `<url><loc>${newOpenAiUrl}</loc><lastmod>2026-09-03T14:00:00.000Z</lastmod></url></urlset>`,
    );
    const writes: FirstPartyReleaseRadar[] = [];
    const result = await refreshFirstPartyReleaseRadar({
      fetchSitemap: async definition => {
        if (definition.id === anthropic.id) {
          return ok(fetched(sitemap([{
            lastmod: "2026-09-03T00:00:00.000Z",
            url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
          }])));
        }
        if (definition.id === openai.id) return ok(fetched(openAiWithDiscovery));
        const fixture = fixtureFor(definition);
        return ok(fetched(fixture.text, fixture.contentType));
      },
      now: () => nextObservedAt,
      readCommitted: async () => ok(reviewed),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeFalse();
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FirstPartyReleaseRefreshDegradedError);
    const degraded = result.error as FirstPartyReleaseRefreshDegradedError;
    expect(degraded.failedSourceIds).toEqual([anthropic.id]);
    expect(writes).toEqual([degraded.snapshot]);
    expect(parseFirstPartyReleaseRadar(degraded.snapshot).ok).toBeTrue();
    expect(validateFirstPartyReleaseReplacement(reviewed, degraded.snapshot).ok).toBeTrue();
    expect(degraded.snapshot.sources.find(source => source.id === anthropic.id)).toEqual(
      reviewed.sources.find(source => source.id === anthropic.id),
    );
    expect(degraded.snapshot.candidates.filter(candidate => candidate.sourceId === anthropic.id)).toEqual(
      reviewed.candidates.filter(candidate => candidate.sourceId === anthropic.id),
    );
    expect(degraded.snapshot.candidates.find(candidate => candidate.canonicalUrl === newOpenAiUrl)).toMatchObject({
      firstSeenAt: nextObservedAt,
      sourcePresence: "present",
      status: "needs-review",
    });
  });
});

function sourceResponse(text: string, contentType = "application/xml; charset=UTF-8"): Response {
  return new Response(text, { headers: { "content-type": contentType } });
}

function sitemapIndex(childUrls: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...childUrls.map(url => `<sitemap><loc>${url}</loc><lastmod>2026-09-03</lastmod></sitemap>`),
    "</sitemapindex>",
  ].join("\n");
}

describe("first-party release source downloader", () => {
  const tencent = sourceDefinition("tencent-post-sitemaps");

  test("uses each source contract's content type instead of requiring XML", async () => {
    let accept = "";
    const result = await fetchFirstPartyReleaseSource(
      openAiCatalog,
      async (_input, init) => {
        accept = new Headers(init?.headers).get("accept") ?? "";
        return sourceResponse("## Featured models\n", "text/plain; charset=utf-8");
      },
    );

    expect(result.ok).toBeTrue();
    expect(accept).toBe("text/plain,*/*;q=0.9");
    if (result.ok) expect(result.value.contentType).toBe("text/plain");

    let htmlAccept = "";
    const htmlResult = await fetchFirstPartyReleaseSource(
      deepseekApi,
      async (_input, init) => {
        htmlAccept = new Headers(init?.headers).get("accept") ?? "";
        return sourceResponse("<!doctype html><html></html>", "text/html; charset=utf-8");
      },
    );
    expect(htmlResult.ok).toBeTrue();
    expect(htmlAccept).toBe("text/html");
    if (htmlResult.ok) expect(htmlResult.value.contentType).toBe("text/html");
  });

  test("rejects a response whose media type violates the source contract", async () => {
    let attempts = 0;
    const result = await fetchFirstPartyReleaseSource(
      openAiCatalog,
      async () => {
        attempts += 1;
        return sourceResponse("<urlset />");
      },
      async () => {},
    );

    expect(result.ok).toBeFalse();
    expect(attempts).toBe(3);
  });

  test("rejects oversized bodies from headers and stops sitemap shards at the aggregate limit", async () => {
    const firstShard = "https://www.tencent.com/post-sitemap.xml";
    const secondShard = "https://www.tencent.com/post-sitemap2.xml";
    const requests: string[] = [];
    const result = await fetchFirstPartyReleaseSource(
      tencent,
      async input => {
        const url = String(input);
        requests.push(url);
        if (url === tencent.url) return sourceResponse(sitemapIndex([firstShard, secondShard]));
        return new Response("<urlset />", {
          headers: {
            "content-length": "25000000",
            "content-type": "application/xml",
          },
        });
      },
      async () => {},
    );

    expect(result.ok).toBeFalse();
    expect(requests).toEqual([tencent.url, firstShard, firstShard, firstShard]);
    expect(requests).not.toContain(secondShard);
  });

  test("ignores non-post shards and merges every Tencent post shard, including the second", async () => {
    const pageShard = "https://www.tencent.com/page-sitemap.xml";
    const firstShard = "https://www.tencent.com/post-sitemap.xml";
    const secondShard = "https://www.tencent.com/post-sitemap2.xml";
    const firstRelease = "https://www.tencent.com/tencent-hunyuan-t1/";
    const secondRelease = "https://www.tencent.com/tencent-releases-and-open-sources-tencent-hy4-preview/";
    const documents = new Map<string, string>([
      [tencent.url, sitemapIndex([pageShard, firstShard, secondShard])],
      [firstShard, sitemap([{ lastmod: "2026-09-02", url: firstRelease }])],
      [secondShard, sitemap([{ lastmod: "2026-09-03", url: secondRelease }])],
    ]);
    const requests: string[] = [];

    const result = await fetchFirstPartyReleaseSource(tencent, async input => {
      const url = String(input);
      requests.push(url);
      const document = documents.get(url);
      return document === undefined
        ? new Response("missing", { status: 404 })
        : sourceResponse(document);
    });

    expect(result.ok).toBeTrue();
    expect(requests).toEqual([tencent.url, firstShard, secondShard]);
    expect(requests).not.toContain(pageShard);
    if (!result.ok) return;
    expect(result.value.text).toContain(firstRelease);
    expect(result.value.text).toContain(secondRelease);
    expect(result.value.text.match(/<url>/gu)).toHaveLength(2);
    expect(result.value.byteLength).toBe(
      [...documents.values()].reduce(
        (total, document) => total + new TextEncoder().encode(document).byteLength,
        0,
      ),
    );
  });

  test("fails before child fetches for foreign, malformed, empty, duplicate, or excessive post-shard sets", async () => {
    const invalidChildSets = [
      ["https://attacker.example/post-sitemap.xml"],
      ["not a URL"],
      ["https://www.tencent.com/page-sitemap.xml"],
      [
        "https://www.tencent.com/post-sitemap.xml",
        "https://www.tencent.com/post-sitemap.xml",
      ],
      Array.from(
        { length: 26 },
        (_, index) => `https://www.tencent.com/post-sitemap${index + 1}.xml`,
      ),
    ];

    for (const children of invalidChildSets) {
      let requests = 0;
      const result = await fetchFirstPartyReleaseSource(tencent, async () => {
        requests += 1;
        return sourceResponse(sitemapIndex(children));
      });
      expect(result.ok).toBeFalse();
      expect(requests).toBe(1);
    }
  });

  test("rejects unmatched sitemap-index rows and hidden child URLs", async () => {
    const firstShard = "https://www.tencent.com/post-sitemap.xml";
    const hiddenShard = "https://www.tencent.com/post-sitemap2.xml";
    const malformedIndex = sitemapIndex([firstShard]).replace(
      "</sitemapindex>",
      `<sitemap><loc>${hiddenShard}</loc></sitemapindex>`,
    );
    const indexRequests: string[] = [];
    const indexResult = await fetchFirstPartyReleaseSource(tencent, async input => {
      indexRequests.push(String(input));
      return sourceResponse(malformedIndex);
    });
    expect(indexResult.ok).toBeFalse();
    expect(indexRequests).toEqual([tencent.url]);

    const visibleRelease = "https://www.tencent.com/tencent-hunyuan-t1/";
    const hiddenRelease = "https://www.tencent.com/tencent-releases-hidden-hy9-model/";
    const malformedChild = sitemap([{ lastmod: "2026-09-02", url: visibleRelease }]).replace(
      "</urlset>",
      `<url><loc>${hiddenRelease}</loc></urlset>`,
    );
    const childRequests: string[] = [];
    const childResult = await fetchFirstPartyReleaseSource(tencent, async input => {
      const url = String(input);
      childRequests.push(url);
      return sourceResponse(url === tencent.url ? sitemapIndex([firstShard]) : malformedChild);
    });
    expect(childResult.ok).toBeFalse();
    expect(childRequests).toEqual([tencent.url, firstShard]);
  });

  test("fails closed when a selected sitemap-index child is not a non-empty URL set", async () => {
    const childUrl = "https://www.tencent.com/post-sitemap2.xml";
    const malformedChildren = [
      "<sitemapindex></sitemapindex>",
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
      '<!DOCTYPE urlset><urlset><url><loc>https://www.tencent.com/release/</loc></url></urlset>',
    ];

    for (const childDocument of malformedChildren) {
      const result = await fetchFirstPartyReleaseSource(tencent, async input => (
        String(input) === tencent.url
          ? sourceResponse(sitemapIndex([childUrl]))
          : sourceResponse(childDocument)
      ));
      expect(result.ok).toBeFalse();
    }
  });
});
