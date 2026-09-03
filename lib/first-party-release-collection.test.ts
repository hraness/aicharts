import { describe, expect, test } from "bun:test";

import {
  FIRST_PARTY_RELEASE_RADAR,
  confirmedFirstPartyReleases,
} from "./first-party-release-collection";

describe("first-party release publication", () => {
  test("keeps Meta research discovery in the checked ledger without publishing it", () => {
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
    expect(museSpark.every(candidate => candidate.status === "needs-review")).toBeTrue();
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
});
