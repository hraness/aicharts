import { describe, expect, test } from "bun:test";

import {
  FIRST_PARTY_RELEASE_RADAR,
  FIRST_PARTY_RELEASE_SOURCE_SUMMARY,
  confirmedFirstPartyReleases,
  summarizeFirstPartyReleaseSources,
} from "./first-party-release-collection";

describe("first-party release publication", () => {
  test("counts distinct labs separately from configured sources", () => {
    const firstSource = FIRST_PARTY_RELEASE_RADAR.sources[0];
    if (firstSource === undefined) throw new Error("Expected a checked first-party source.");

    expect(FIRST_PARTY_RELEASE_SOURCE_SUMMARY).toEqual({
      labCount: new Set(
        FIRST_PARTY_RELEASE_RADAR.sources.map(source => source.providerId),
      ).size,
      sourceCount: FIRST_PARTY_RELEASE_RADAR.sources.length,
    });
    expect(summarizeFirstPartyReleaseSources([
      ...FIRST_PARTY_RELEASE_RADAR.sources,
      firstSource,
    ])).toEqual({
      labCount: FIRST_PARTY_RELEASE_SOURCE_SUMMARY.labCount,
      sourceCount: FIRST_PARTY_RELEASE_SOURCE_SUMMARY.sourceCount + 1,
    });
  });

  test("keeps Meta research discovery in the checked ledger with explicit review states", () => {
    const source = FIRST_PARTY_RELEASE_RADAR.sources.find(item => item.id === "meta-research-sitemap");
    const museSpark = FIRST_PARTY_RELEASE_RADAR.candidates.filter(candidate => (
      candidate.providerId === "meta"
      && candidate.namedModels.some(name => name.startsWith("Muse Spark"))
    ));

    expect(source).toMatchObject({
      providerId: "meta",
      url: "https://research.meta.ai/sitemap.xml",
    });
    expect(museSpark.length).toBeGreaterThan(0);
    expect(museSpark.some(candidate => (
      candidate.canonicalUrl.includes("muse-spark")
    ))).toBeTrue();
    const reviewedMuse = museSpark.find(candidate => (
      candidate.id === "meta:/blog/introducing-muse-spark-1-3"
    ));
    expect(reviewedMuse).toMatchObject({
      status: "confirmed-release",
    });
    expect(Date.parse(reviewedMuse?.lastChangedAt ?? "")).toBeGreaterThan(
      Date.parse(reviewedMuse?.firstSeenAt ?? ""),
    );
  });

  test("publishes the reviewed Gemini and Muse September candidates", () => {
    const publishedIds = new Set(
      confirmedFirstPartyReleases(FIRST_PARTY_RELEASE_RADAR).map(candidate => candidate.id),
    );
    for (const id of [
      "google:/models/model-cards/gemini-3-8-flash/",
      "meta:/blog/introducing-muse-spark-1-3",
    ]) {
      const candidate = FIRST_PARTY_RELEASE_RADAR.candidates.find(item => item.id === id);
      expect(candidate).toMatchObject({ status: "confirmed-release" });
      expect(Date.parse(candidate?.lastChangedAt ?? "")).toBeGreaterThan(
        Date.parse(candidate?.firstSeenAt ?? ""),
      );
      expect(publishedIds.has(id)).toBeTrue();
    }
  });

  test("keeps a reviewed release visible when sitemap membership changes", () => {
    const reviewed = FIRST_PARTY_RELEASE_RADAR.candidates.find(
      candidate => candidate.status === "confirmed-release",
    );
    if (reviewed === undefined) throw new Error("Expected a reviewed release fixture.");

    const radar = {
      ...FIRST_PARTY_RELEASE_RADAR,
      candidates: [{ ...reviewed, sourcePresence: "missing" as const }],
    };

    expect(confirmedFirstPartyReleases(radar)).toEqual(radar.candidates);
  });

  test("orders reviewed releases by immutable source recency, including same-day ties", () => {
    const reviewed = FIRST_PARTY_RELEASE_RADAR.candidates.filter(
      candidate => candidate.status === "confirmed-release",
    ).slice(0, 2);
    const older = reviewed[0];
    const newer = reviewed[1];
    if (older === undefined || newer === undefined) {
      throw new Error("Expected two reviewed release fixtures.");
    }
    const radar = {
      ...FIRST_PARTY_RELEASE_RADAR,
      candidates: [
        {
          ...older,
          candidateDate: "2026-09-02",
          firstSeenAt: "2026-09-03T00:00:00.000Z",
          sourceModifiedAt: "2026-09-02T01:00:00.000Z",
        },
        {
          ...newer,
          candidateDate: "2026-09-02",
          firstSeenAt: "2026-09-01T00:00:00.000Z",
          sourceModifiedAt: "2026-09-02T23:00:00.000Z",
        },
      ],
    };

    expect(confirmedFirstPartyReleases(radar).map(candidate => candidate.id))
      .toEqual([newer.id, older.id]);
  });
});
