import modelReleaseRadarData from "@/data/model-release-radar.json";

import { parseModelReleaseRadar } from "./model-release-data";

const checkedRadarInput: unknown = modelReleaseRadarData;
const checkedRadar = parseModelReleaseRadar(checkedRadarInput);
if (!checkedRadar.ok) {
  throw new Error(
    `Checked model-release radar is invalid: ${checkedRadar.error.message}`,
    { cause: checkedRadar.error },
  );
}

export const MODEL_RELEASE_RADAR = checkedRadar.value;
export const MODEL_RELEASES_AWAITING_BENCHMARK = MODEL_RELEASE_RADAR.releases
  .filter(release => release.status === "awaiting-benchmark");

// Keep the public signal intentionally small; the checked ledger retains the
// broader set while scored cards remain benchmark-only.
export const MODEL_RELEASE_RADAR_HIGHLIGHTS =
  MODEL_RELEASES_AWAITING_BENCHMARK.slice(0, 2);
