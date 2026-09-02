import firstPartyReleaseRadarData from "@/data/first-party-release-radar.json";

import { parseFirstPartyReleaseRadar } from "./first-party-release-data";
import type { FirstPartyReleaseRadar } from "./first-party-release-data";

const checkedInput: unknown = firstPartyReleaseRadarData;
const checkedRadar = parseFirstPartyReleaseRadar(checkedInput);
if (!checkedRadar.ok) {
  throw new Error(
    `Checked first-party release radar is invalid: ${checkedRadar.error.message}`,
    { cause: checkedRadar.error },
  );
}

export const FIRST_PARTY_RELEASE_RADAR = checkedRadar.value;
export function confirmedFirstPartyReleases(radar: FirstPartyReleaseRadar) {
  return radar.candidates.filter(candidate => candidate.status === "confirmed-release");
}

export const CONFIRMED_FIRST_PARTY_RELEASES = confirmedFirstPartyReleases(
  FIRST_PARTY_RELEASE_RADAR,
);
export const FIRST_PARTY_RELEASE_HIGHLIGHTS = CONFIRMED_FIRST_PARTY_RELEASES.slice(0, 2);
