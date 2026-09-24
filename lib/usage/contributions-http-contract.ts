import { CONTRIBUTION_MAX_BYTES, contributionBodyHash, contributionHash, parseContributionAbandonRequest,
  parseContributionActivationReceipt, parseContributionActivationRequest, parseContributionBatch, parseContributionGrant,
  parseContributionGrantReceipt, parseContributionResult, parseContributionStatus, parseContributionStatusRequest,
  parseContributionTerminal, type ContributionAbandonRequest, type ContributionActivationRequest, type ContributionBatch,
  parseContributionMigrationRequest, parseContributionMigrationReceipt, type ContributionMigrationRequest,
  type ContributionGrant, type ContributionResult, type ContributionStatusRequest } from "./contributions";
import { statsJsonBytes, statsJsonValue } from "./stats-http-contract";
import { parseContributionHeadQuery, parseContributionHeadQueryResult, CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES,
  CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES, type ContributionHeadQuery } from "./contribution-head-query";
import { CONTRIBUTION_CANCEL_REQUEST_BYTES, parseContributionCancelRequest, parseContributionCancelResult,
  type ContributionCancelRequest } from "./contribution-cancel";

export const CONTRIBUTION_UPLOAD_URL = "https://usage.aicharts.io/v3/contributions";
export const CONTRIBUTION_STATUS_URL = "https://usage.aicharts.io/v3/contributions/status";
export const CONTRIBUTION_ABANDON_URL = "https://usage.aicharts.io/v3/contributions/abandon";
export const CONTRIBUTION_CANCEL_URL = "https://usage.aicharts.io/v3/contributions/cancel";
export const CONTRIBUTION_GRANT_URL = "https://usage.aicharts.io/v3/contributions/populations";
export const CONTRIBUTION_ACTIVATE_URL = "https://usage.aicharts.io/v3/contributions/activate";
export const CONTRIBUTION_MIGRATE_URL = "https://usage.aicharts.io/v3/contributions/migrate";
export const CONTRIBUTION_CANCEL_MIGRATION_URL = "https://usage.aicharts.io/v3/contributions/migrate/cancel";
export const CONTRIBUTION_HEAD_QUERY_URL = "https://usage.aicharts.io/v3/contributions/heads";
export const CONTRIBUTION_HTTP_CONTROL_BYTES = 2_048;
export const CONTRIBUTION_HTTP_RESPONSE_BYTES = 4_096;
export type ContributionHttpRequest = Readonly<{ operation: "upload"; request: ContributionBatch }>
  | Readonly<{ operation: "status"; request: ContributionStatusRequest }>
  | Readonly<{ operation: "abandon"; request: ContributionAbandonRequest }>
  | Readonly<{ operation: "cancel"; request: ContributionCancelRequest }>
  | Readonly<{ operation: "grant"; request: ContributionGrant }>
  | Readonly<{ operation: "activate"; request: ContributionActivationRequest }>
  | Readonly<{ operation: "heads"; request: ContributionHeadQuery }>
  | Readonly<{ operation: "migrate" | "cancel-migration"; request: ContributionMigrationRequest }>;
export function contributionHttpCap(url: string): number | null {
  if (url === CONTRIBUTION_UPLOAD_URL) return CONTRIBUTION_MAX_BYTES;
  if (url === CONTRIBUTION_CANCEL_URL) return CONTRIBUTION_CANCEL_REQUEST_BYTES;
  if (url === CONTRIBUTION_HEAD_QUERY_URL) return CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES;
  return [CONTRIBUTION_STATUS_URL, CONTRIBUTION_ABANDON_URL, CONTRIBUTION_GRANT_URL, CONTRIBUTION_ACTIVATE_URL,
    CONTRIBUTION_MIGRATE_URL, CONTRIBUTION_CANCEL_MIGRATION_URL].includes(url)
    ? CONTRIBUTION_HTTP_CONTROL_BYTES : null;
}
export function decodeContributionHttpRequest(url: string, bytes: Uint8Array): ContributionHttpRequest | null {
  const cap = contributionHttpCap(url);
  if (cap === null) return null;
  const raw = statsJsonValue(bytes, cap);
  if (url === CONTRIBUTION_CANCEL_URL) { const request = parseContributionCancelRequest(raw); return request ? { operation: "cancel", request } : null; }
  if (url === CONTRIBUTION_HEAD_QUERY_URL) { const request = parseContributionHeadQuery(raw); return request ? { operation: "heads", request } : null; }
  if (url === CONTRIBUTION_UPLOAD_URL) { const request = parseContributionBatch(raw); return request ? { operation: "upload", request } : null; }
  if (url === CONTRIBUTION_STATUS_URL) { const request = parseContributionStatusRequest(raw); return request ? { operation: "status", request } : null; }
  if (url === CONTRIBUTION_ABANDON_URL) { const request = parseContributionAbandonRequest(raw); return request ? { operation: "abandon", request } : null; }
  if (url === CONTRIBUTION_GRANT_URL) { const request = parseContributionGrant(raw); return request ? { operation: "grant", request } : null; }
  if (url === CONTRIBUTION_MIGRATE_URL || url === CONTRIBUTION_CANCEL_MIGRATION_URL) {
    const request = parseContributionMigrationRequest(raw);
    return request ? { operation: url === CONTRIBUTION_MIGRATE_URL ? "migrate" : "cancel-migration", request } : null;
  }
  const request = parseContributionActivationRequest(raw); return request ? { operation: "activate", request } : null;
}
/** A valid shape is insufficient: acceptance must name this exact request. */
export function contributionHttpResult(input: ContributionHttpRequest, raw: unknown): ContributionResult<unknown> | null {
  switch (input.operation) {
    case "cancel": return parseContributionCancelResult(input.request, raw);
    case "heads": return parseContributionHeadQueryResult(input.request, raw);
    case "migrate": return parseContributionResult(raw, value => {
      const receipt = parseContributionMigrationReceipt(value), request = input.request;
      return receipt && receipt.operationId === request.operationId && receipt.accountId === request.accountId
        && receipt.generation === request.generation && receipt.deviceId === request.deviceId
        && receipt.expectedRevision === request.expectedRevision && receipt.expectedV1Revision === request.expectedV1Revision
        && receipt.expectedV2Revision === request.expectedV2Revision
        && receipt.bodyHash === contributionHash(`aicharts:contribution-migration:v3\0${JSON.stringify(request)}\0${receipt.manifestHash}`) ? receipt : null;
    });
    case "cancel-migration": return parseContributionResult(raw, value => {
      const terminal = parseContributionTerminal(value), request = input.request;
      return terminal?.outcome === "abandoned" && terminal.operationId === request.operationId
        && terminal.revision === request.expectedRevision + 1 ? terminal : null;
    });
    case "status": return parseContributionResult(raw, value => {
      const status = parseContributionStatus(value), request = input.request;
      if (!status || status.accountId !== request.accountId || status.generation !== request.generation
        || (status.population && (status.population.id !== request.populationId || status.population.generation !== request.generation))
        || (status.operation && status.operation.operationId !== request.operationId)) return null;
      const terminal = status.operation?.terminal;
      if (terminal?.outcome === "committed" && (terminal.receipt.accountId !== request.accountId || terminal.receipt.generation !== request.generation
        || terminal.receipt.deviceId !== request.deviceId || terminal.receipt.populationId !== request.populationId)) return null;
      return status;
    });
    case "upload": case "abandon": return parseContributionResult(raw, value => {
      const terminal = parseContributionTerminal(value), request = input.request;
      if (!terminal) return null;
      const receipt = terminal.outcome === "committed" ? terminal.receipt : terminal;
      const expectedHash = input.operation === "upload" ? contributionBodyHash(input.request) : input.request.bodyHash;
      if (receipt.operationId !== request.operationId || receipt.bodyHash !== expectedHash) return null;
      if (terminal.outcome === "committed") {
        if (terminal.receipt.accountId !== request.accountId || terminal.receipt.generation !== request.generation
          || terminal.receipt.deviceId !== request.deviceId) return null;
        if (input.operation === "upload" && (terminal.receipt.sequence !== input.request.sequence
          || terminal.receipt.revision !== input.request.expectedRevision + 1 || terminal.receipt.populationId !== input.request.populationId
          || terminal.receipt.populationRevision !== input.request.expectedPopulationRevision + 1)) return null;
      }
      return terminal;
    });
    case "grant": return parseContributionResult(raw, value => {
      const receipt = parseContributionGrantReceipt(value), request = input.request;
      return receipt && receipt.operationId === request.operationId && receipt.population.id === request.populationId
        && receipt.population.generation === request.generation && receipt.population.deviceId === request.deviceId
        && receipt.population.writerRevision === request.expectedWriterRevision + 1
        && receipt.revision === request.expectedRevision + (request.abandonOperationId === null ? 1 : 2)
        && receipt.bodyHash === contributionHash(`aicharts:contribution-grant:v3\0${JSON.stringify(request)}`) ? receipt : null;
    });
    case "activate": return parseContributionResult(raw, value => {
      const receipt = parseContributionActivationReceipt(value), request = input.request;
      return receipt && receipt.operationId === request.operationId && receipt.accountId === request.accountId
        && receipt.generation === request.generation && receipt.deviceId === request.deviceId && receipt.mode === request.mode
        && receipt.expectedRevision === request.expectedRevision
        && receipt.bodyHash === contributionHash(`aicharts:contribution-activation:v3\0${JSON.stringify(request)}`) ? receipt : null;
    });
  }
}
export const encodeContributionHttpResult = (input: ContributionHttpRequest, raw: unknown): Uint8Array<ArrayBuffer> | null => {
  const result = contributionHttpResult(input, raw);
  return result ? statsJsonBytes({ schemaVersion: 3, result }, input.operation === "heads"
    ? CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES : CONTRIBUTION_HTTP_RESPONSE_BYTES) : null;
};
