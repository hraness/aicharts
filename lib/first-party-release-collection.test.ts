import { describe, expect, test } from "bun:test";

import {
  FIRST_PARTY_RELEASE_RADAR,
  confirmedFirstPartyReleases,
} from "./first-party-release-collection";

describe("first-party release publication", () => {
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
