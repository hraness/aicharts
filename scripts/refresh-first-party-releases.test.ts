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
  validateFirstPartyReleaseReplacement,
  type FetchedSitemap,
  type FirstPartyReleaseRadar,
  type FirstPartyReleaseSourceDefinition,
  type FirstPartyReleaseSourceObservation,
} from "../lib/first-party-release-data";
import { assertProperty, fc } from "../lib/property-test";
import { err, ok } from "../lib/result";
import { refreshFirstPartyReleaseRadar } from "./refresh-first-party-releases";

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

function sitemap(entries: readonly Readonly<{ lastmod: string; url: string }>[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(entry => (
      `<url><loc>${entry.url.replaceAll("&", "&amp;")}</loc><lastmod>${entry.lastmod}</lastmod></url>`
    )),
    "</urlset>",
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

function xmlFor(definition: FirstPartyReleaseSourceDefinition): string {
  if (definition.id === anthropic.id) return anthropicXml();
  if (definition.id === openai.id) return openAiXml();
  return metaXml();
}

function fetched(text: string): FetchedSitemap {
  return {
    byteLength: new TextEncoder().encode(text).byteLength,
    contentType: "application/xml",
    httpStatus: 200,
    text,
  };
}

function observation(
  definition: FirstPartyReleaseSourceDefinition,
  xml: string,
): FirstPartyReleaseSourceObservation {
  const result = observeFirstPartyReleaseSource(definition, fetched(xml), observedAt);
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

describe("first-party release URL recognition", () => {
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
    )).toEqual(["Unresolved announcement: Claude Lyric 6 0"]);
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
    )).toEqual(["Unresolved announcement: Introducing Muse Lyric 2 0"]);
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

describe("provider sitemap shape guards", () => {
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
    expect(parseFirstPartyReleaseRadar(second).ok).toBeTrue();
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
    expect(parseFirstPartyReleaseRadar(second).ok).toBeTrue();
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
    expect(parseFirstPartyReleaseRadar(next).ok).toBeTrue();
    expect(validateFirstPartyReleaseReplacement(prior, next).ok).toBeTrue();
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
  });
});

describe("first-party release refresh transaction", () => {
  test("writes one validated ledger only after every configured source passes", async () => {
    const writes: FirstPartyReleaseRadar[] = [];
    const result = await refreshFirstPartyReleaseRadar({
      fetchSitemap: async definition => ok(fetched(xmlFor(definition))),
      now: () => observedAt,
      readCommitted: async () => ok(emptyFirstPartyReleaseRadar()),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(writes).toEqual([result.value]);
    expect(result.value.sources.map(source => source.providerName)).toEqual([
      "Anthropic",
      "OpenAI",
      "Meta",
    ]);
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

  test("adds a newly configured Meta source without dropping prior review statuses", async () => {
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
      fetchSitemap: async definition => ok(fetched(xmlFor(definition))),
      now: () => "2026-09-03T18:00:00.000Z",
      readCommitted: async () => ok(reviewed),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(writes).toEqual([result.value]);
    expect(result.value.sources.map(source => source.id)).toEqual([
      "anthropic-sitemap",
      "openai-release-sitemap",
      "meta-research-sitemap",
    ]);
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

  test("does not write a partial ledger when either provider source fails", async () => {
    const writes: FirstPartyReleaseRadar[] = [];
    const result = await refreshFirstPartyReleaseRadar({
      fetchSitemap: async definition => (
        definition.id === anthropic.id
          ? ok(fetched(anthropicXml()))
          : err(new Error("OpenAI source unavailable"))
      ),
      now: () => observedAt,
      readCommitted: async () => ok(emptyFirstPartyReleaseRadar()),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeFalse();
    expect(writes).toEqual([]);
  });
});
