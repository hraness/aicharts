import deepSweEvidenceData from "@/data/deep-swe-evidence.json";

import {
  parseDeepSweEvidenceSnapshot,
  type DeepSweEvidenceRecord,
} from "./deep-swe-evidence";
import {
  modelReleaseSemanticKey,
  type ModelRelease,
} from "./model-release-data";

const checkedEvidenceInput: unknown = deepSweEvidenceData;
const checkedEvidence = parseDeepSweEvidenceSnapshot(checkedEvidenceInput);
if (!checkedEvidence.ok) {
  throw new Error(
    `Checked direct DeepSWE evidence is invalid: ${checkedEvidence.error.message}`,
    { cause: checkedEvidence.error },
  );
}

export const DIRECT_DEEP_SWE_EVIDENCE = checkedEvidence.value;

function strongestEvidence(
  records: readonly DeepSweEvidenceRecord[],
): DeepSweEvidenceRecord | null {
  return records.reduce<DeepSweEvidenceRecord | null>((strongest, record) => (
    strongest === null
    || record.passAt1 > strongest.passAt1
    || (record.passAt1 === strongest.passAt1 && record.config < strongest.config)
      ? record
      : strongest
  ), null);
}

/** Chooses a single labeled configuration for compact release-radar presentation. */
export function directDeepSweEvidenceForRelease(
  release: ModelRelease,
): DeepSweEvidenceRecord | null {
  return directDeepSweEvidenceForReleaseFrom(
    DIRECT_DEEP_SWE_EVIDENCE.records,
    release,
  );
}

export function directDeepSweEvidenceForReleaseFrom(
  records: readonly DeepSweEvidenceRecord[],
  release: ModelRelease,
): DeepSweEvidenceRecord | null {
  const exact = records.filter(record => (
    record.identity.source === "openrouter"
    && record.identity.modelId === release.id
  ));
  if (exact.length > 0) return strongestEvidence(exact);

  const releaseKey = modelReleaseSemanticKey(release.providerId, release.model);
  return strongestEvidence(records.filter(record => (
    record.identity.source === "artificial-analysis"
    && record.providerId === release.providerId
    && modelReleaseSemanticKey(record.providerId, record.model) === releaseKey
  )));
}
