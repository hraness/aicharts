import { describe, expect, test } from "bun:test";

import {
  FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS,
  deriveFirstPartyReleaseRadar,
  emptyFirstPartyReleaseRadar,
  namedModelsForProviderUrl,
  observeFirstPartyReleaseSource,
  parseFirstPartyReleaseRadar,
  parseProviderSitemap,
  releaseCandidateNamesForProviderUrl,
  validateFirstPartyReleaseReplacement,
  type FetchedSitemap,
  type FirstPartyReleaseRadar,
  type FirstPartyReleaseSourceDefinition,
  type FirstPartyReleaseSourceObservation,
} from "../lib/first-party-release-data";
import { err, ok } from "../lib/result";
import { refreshFirstPartyReleaseRadar } from "./refresh-first-party-releases";

const observedAt = "2026-09-02T18:00:00.000Z";
const anthropic = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS[0];
const openai = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS[1];

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
  return [observation(anthropic, anthropicXml()), observation(openai, openAiXml())];
}

describe("first-party release URL recognition", () => {
  test("names both models on Anthropic's combined Fable and Mythos 5.1 release", () => {
    expect(namedModelsForProviderUrl(
      "anthropic",
      "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    )).toEqual(["Claude Fable 5.1", "Claude Mythos 5.1"]);
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
      [nextAnthropic, observation(openai, openAiXml())],
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
  test("writes one validated ledger only after both primary sources pass", async () => {
    const writes: FirstPartyReleaseRadar[] = [];
    const result = await refreshFirstPartyReleaseRadar({
      fetchSitemap: async definition => ok(fetched(
        definition.id === anthropic.id ? anthropicXml() : openAiXml(),
      )),
      now: () => observedAt,
      readCommitted: async () => ok(emptyFirstPartyReleaseRadar()),
      writeCommitted: async snapshot => { writes.push(snapshot); },
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(writes).toEqual([result.value]);
    expect(result.value.sources.map(source => source.providerName)).toEqual(["Anthropic", "OpenAI"]);
    expect(result.value.candidates.some(candidate => (
      candidate.namedModels.includes("Claude Mythos 5.1")
    ))).toBeTrue();
    expect(result.value.candidates.some(candidate => (
      candidate.namedModels.includes("GPT-5.6")
    ))).toBeTrue();
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
