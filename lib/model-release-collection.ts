import modelReleaseRadarData from "@/data/model-release-radar.json";

import { directDeepSweEvidenceForRelease } from "./deep-swe-evidence-collection";
import { parseModelReleaseRadar, type ModelRelease } from "./model-release-data";

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
export const MODEL_RELEASES_WITH_EARLY_DEEP_SWE = MODEL_RELEASES_AWAITING_BENCHMARK
  .filter(release => directDeepSweEvidenceForRelease(release) !== null);

// Keep the public signal intentionally small; the checked ledger retains the
// broader set while scored cards remain benchmark-only.
const newestAwaitingRelease = MODEL_RELEASES_AWAITING_BENCHMARK[0];
const newestReleaseWithEarlyEvidence = MODEL_RELEASES_WITH_EARLY_DEEP_SWE[0];
const highlightedReleaseIds = new Set<string>();
export const MODEL_RELEASE_RADAR_HIGHLIGHTS = [
  newestAwaitingRelease,
  newestReleaseWithEarlyEvidence,
  ...MODEL_RELEASES_AWAITING_BENCHMARK,
].filter(release => {
  if (release === undefined || highlightedReleaseIds.has(release.id)) return false;
  highlightedReleaseIds.add(release.id);
  return true;
}).filter((release): release is ModelRelease => release !== undefined).slice(0, 2);

export function modelReleaseRadarHighlightsExcluding(
  excludedModels: readonly string[],
  limit = 2,
): readonly ModelRelease[] {
  const excluded = new Set(excludedModels.map(model => model.trim().toLocaleLowerCase("en-US")));
  const includedIds = new Set<string>();
  return [
    ...MODEL_RELEASE_RADAR_HIGHLIGHTS,
    ...MODEL_RELEASES_WITH_EARLY_DEEP_SWE,
    ...MODEL_RELEASES_AWAITING_BENCHMARK,
  ].filter(release => {
    if (
      excluded.has(release.model.trim().toLocaleLowerCase("en-US"))
      || includedIds.has(release.id)
    ) return false;
    includedIds.add(release.id);
    return true;
  }).slice(0, Math.max(0, limit));
}
