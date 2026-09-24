import { contributionBodyHash, contributionHash, CONTRIBUTION_MAX_OPERATIONS, parseContributionBatch,
  parseContributionResult, parseContributionTerminal, type ContributionBatch, type ContributionResult,
  type ContributionTerminal } from "./contributions";
import { statsInteger, statsOwnRecord } from "./stats-contract";
import { statsJsonBytes, statsJsonValue } from "./stats-http-contract";

/** The original canonical batch is included so the receiver computes its exact
 * identity. The envelope's expectedRevision is a fresh cancellation CAS; it
 * never replaces the original batch's account/population predecessor anchors. */
export type ContributionCancelRequest = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; deviceId: string;
  expectedRevision: number; batch: ContributionBatch;
}>;
export type ContributionCancelResult = ContributionResult<ContributionTerminal>;
export const CONTRIBUTION_CANCEL_REQUEST_BYTES = 1_049_088;
export const CONTRIBUTION_CANCEL_RESPONSE_BYTES = 4_096;

export function parseContributionCancelRequest(value: unknown): ContributionCancelRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "deviceId", "expectedRevision", "batch"]);
    const batch = raw ? parseContributionBatch(raw.batch) : null;
    if (!raw || raw.schemaVersion !== 3 || !batch || raw.accountId !== batch.accountId || raw.generation !== batch.generation
      || raw.deviceId !== batch.deviceId || !statsInteger(raw.expectedRevision, 0, CONTRIBUTION_MAX_OPERATIONS)) return null;
    return Object.freeze({ schemaVersion: 3, accountId: batch.accountId, generation: batch.generation, deviceId: batch.deviceId,
      expectedRevision: raw.expectedRevision, batch });
  } catch { return null; }
}

/** Correlation is not authentication. Only the enrolled transport may turn a
 * matching result into authority to settle the exact retained local flight. */
export function parseContributionCancelResult(request: ContributionCancelRequest, value: unknown): ContributionCancelResult | null {
  try {
    const checked = parseContributionCancelRequest(request);
    if (!checked) return null;
    const result = parseContributionResult(value, parseContributionTerminal);
    if (!result || !result.ok) return result;
    const batch = checked.batch, bodyHash = contributionBodyHash(batch), terminal = result.value;
    if (terminal.outcome === "abandoned") {
      return terminal.operationId === batch.operationId && terminal.bodyHash === bodyHash
        && terminal.revision > batch.expectedRevision ? result : null;
    }
    const receipt = terminal.receipt;
    const populationHead = contributionHash(`aicharts:population-history:v3\0${JSON.stringify([batch.expectedPopulationHead, bodyHash])}`);
    return receipt.operationId === batch.operationId && receipt.bodyHash === bodyHash && receipt.accountId === batch.accountId
      && receipt.generation === batch.generation && receipt.deviceId === batch.deviceId && receipt.sequence === batch.sequence
      && receipt.revision === batch.expectedRevision + 1 && receipt.populationId === batch.populationId
      && receipt.populationRevision === batch.expectedPopulationRevision + 1 && receipt.populationHead === populationHead ? result : null;
  } catch { return null; }
}

export const decodeContributionCancelRequest = (bytes: Uint8Array): ContributionCancelRequest | null =>
  bytes.byteLength <= CONTRIBUTION_CANCEL_REQUEST_BYTES ? parseContributionCancelRequest(statsJsonValue(bytes, CONTRIBUTION_CANCEL_REQUEST_BYTES)) : null;
export const encodeContributionCancelResult = (request: ContributionCancelRequest, value: unknown): Uint8Array<ArrayBuffer> | null => {
  const result = parseContributionCancelResult(request, value);
  return result ? statsJsonBytes({ schemaVersion: 3, result }, CONTRIBUTION_CANCEL_RESPONSE_BYTES) : null;
};
