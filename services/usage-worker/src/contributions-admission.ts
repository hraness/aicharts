import { contributionBodyHash, contributionHex, ContributionFault, isContributionError, parseContributionAbandonRequest, parseContributionBatch,
  parseContributionGrant, parseContributionStatusRequest, parseContributionActivationRequest, type ContributionAbandonRequest, type ContributionAuthority,
  type ContributionBatch, type ContributionError, type ContributionGrant, type ContributionResult, type ContributionStatus,
  type ContributionStatusRequest, type ContributionTerminal, type ContributionActivationRequest, type ContributionActivationReceipt,
  parseContributionMigrationRequest, type ContributionMigrationRequest, type ContributionMigrationReceipt } from "../../../lib/usage/contributions";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "./account-admission";
import { AdmissionFault } from "./admission-policy";
import { ensureContributionBody } from "./contributions-objects";
import { ensureContributionJournal } from "./contributions-journal";
import { captureContributionMigration, ensureContributionMigration } from "./contributions-migration";
import { ContributionState, type ContributionGrantReceipt } from "./contributions-state";
import { readNamespaceAnchor, sameNamespaceAnchor } from "./namespace-anchor";
import { uploadSecretCommitment } from "./pairing";
import { parseContributionHeadQuery, type ContributionHeadQuery, type ContributionHeadQueryResult } from "../../../lib/usage/contribution-head-query";
import { queryContributionHeads } from "./contribution-head-query";
import { parseContributionCancelRequest, type ContributionCancelRequest, type ContributionCancelResult } from "../../../lib/usage/contribution-cancel";

type Identity = Pick<ContributionBatch, "accountId" | "generation" | "deviceId">;
const sameSecret = (left: string, right: string): boolean => {
  if (!contributionHex(left) || !contributionHex(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};
const authority = (owner: AdmissionOwner, deviceId: string, now: number): ContributionAuthority => ({
  accountId: owner.accountId, generation: owner.generation, deviceId, observedAtMs: now, active: true, allowAccountTombstone: false,
});
function mappedError(error: string): ContributionError {
  return isContributionError(error) ? error : "storage_unavailable";
}
function failure(error: unknown): ContributionResult<never> {
  return { ok: false, error: error instanceof ContributionFault ? error.code : error instanceof AdmissionFault ? mappedError(error.code) : "storage_unavailable" };
}
/** AccountEnrollment owns the execution registration and asynchronous external
 * fence checks around this helper. Every continuation re-enters the same owner
 * transaction; no authentication, revocation, namespace or writer decision is
 * inferred from an earlier successful await. Numeric content stays in R2. */
export class AccountContributions {
  constructor(readonly env: Env, readonly state: ContributionState, readonly transaction: AdmissionTransaction,
    readonly beforeCommit?: () => Promise<void>) {}
  async #before(observation: AdmissionObservation, identity: Identity): Promise<void> {
    await this.beforeCommit?.();
    this.#run(observation, identity, () => {});
  }
  #run<T>(observation: AdmissionObservation, identity: Identity, run: (owner: AdmissionOwner, now: number) => T): T {
    const result = this.transaction(observation, (owner, now) => {
      if (!owner || owner.phase !== "active") throw new ContributionFault("not_enrolled");
      if (owner.accountId !== identity.accountId || owner.generation !== identity.generation) throw new ContributionFault("unauthorized");
      const device = owner.devices.find(candidate => candidate.deviceId === identity.deviceId);
      if (!device) throw new ContributionFault("unauthorized");
      if (device.revokedAtMs !== null) throw new ContributionFault("revoked");
      return run(owner, now);
    });
    if (!result.ok) throw new ContributionFault(mappedError(result.error));
    return result.value;
  }
  async #authenticate(observation: AdmissionObservation, identity: Identity, secret: string): Promise<void> {
    const original = this.#run(observation, identity, owner => {
      const device = owner.devices.find(candidate => candidate.deviceId === identity.deviceId)!;
      return { intentId: device.reservation.intentId, commitment: device.reservation.uploadCommitment, anchor: { ...owner.anchor } };
    });
    const commitment = await uploadSecretCommitment(original.intentId, secret);
    if (!commitment.ok || !sameSecret(commitment.value, original.commitment)) throw new ContributionFault("unauthorized");
    this.#run(observation, identity, owner => {
      const device = owner.devices.find(candidate => candidate.deviceId === identity.deviceId)!;
      if (device.reservation.intentId !== original.intentId || !sameSecret(device.reservation.uploadCommitment, commitment.value))
        throw new ContributionFault("unauthorized");
    });
    const anchor = await readNamespaceAnchor(this.env.CONTROL, identity.accountId);
    this.#run(observation, identity, owner => {
      if (!anchor || !sameNamespaceAnchor(anchor, original.anchor) || !sameNamespaceAnchor(owner.anchor, original.anchor))
        throw new ContributionFault("recovery_required");
    });
  }
  async status(value: ContributionStatusRequest, secret: string, observation: AdmissionObservation): Promise<ContributionResult<ContributionStatus>> {
    try {
      const request = parseContributionStatusRequest(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      return { ok: true, value: this.#run(observation, request, () => {
        const control = this.state.control(), population = this.state.population(request.populationId);
        const operation = request.operationId === null ? null : this.state.operation(request.operationId);
        if (control.accountId !== request.accountId || control.generation !== request.generation) throw new ContributionFault("generation_conflict");
        if (operation && (operation.kind !== "batch" || operation.intent.deviceId !== request.deviceId
          || operation.intent.populationId !== request.populationId || operation.intent.generation !== request.generation))
          throw new ContributionFault("conflict");
        return { schemaVersion: 3, accountId: control.accountId, generation: control.generation, revision: control.revision,
          nextSequence: this.state.sequence(request.generation, request.deviceId) + 1, population,
          phase: control.phase, activationHash: control.activationHash, migrationManifestHash: control.migrationManifestHash,
          operation: operation ? { operationId: operation.intent.operationId, bodyHash: operation.intent.bodyHash,
            outcome: operation.outcome as "pending" | "committed" | "abandoned", terminal: operation.terminal as ContributionTerminal | null } : null,
          legacyResolution: "not_evaluated" };
      }) };
    } catch (error) { return failure(error); }
  }
  async heads(value: ContributionHeadQuery, secret: string, observation: AdmissionObservation): Promise<ContributionHeadQueryResult> {
    try {
      const request = parseContributionHeadQuery(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      return this.#run(observation, request, (owner, now) => queryContributionHeads(this.state, request, authority(owner, request.deviceId, now)));
    } catch (error) { return failure(error); }
  }
  async grant(value: ContributionGrant, secret: string, observation: AdmissionObservation): Promise<ContributionResult<ContributionGrantReceipt>> {
    try {
      const request = parseContributionGrant(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      await this.#before(observation, request);
      return { ok: true, value: this.#run(observation, request, (owner, now) => this.state.grantPopulation(request, {
        ...authority(owner, request.deviceId, now), previousWriterRevoked: request.previousDeviceId !== null
          && owner.devices.some(device => device.deviceId === request.previousDeviceId && device.revokedAtMs !== null),
      })) };
    } catch (error) { return failure(error); }
  }
  async activate(value: ContributionActivationRequest, secret: string, observation: AdmissionObservation,
    legacyIsEmpty: () => boolean): Promise<ContributionResult<ContributionActivationReceipt>> {
    try {
      const request = parseContributionActivationRequest(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      await this.#before(observation, request);
      return { ok: true, value: this.#run(observation, request, (owner, now) =>
        this.state.activateFresh(request, authority(owner, request.deviceId, now), legacyIsEmpty)) };
    } catch (error) { return failure(error); }
  }
  async migrate(value: ContributionMigrationRequest, secret: string, observation: AdmissionObservation): Promise<ContributionResult<ContributionMigrationReceipt>> {
    try {
      const request = parseContributionMigrationRequest(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      const locate = (): ContributionMigrationReceipt | null => this.#run(observation, request, () => {
        const operation = this.state.operation(request.operationId);
        if (!operation) return null;
        if (operation.kind !== "migration" || operation.intent.deviceId !== request.deviceId || operation.intent.generation !== request.generation
          || operation.intent.expectedRevision !== request.expectedRevision || operation.outcome === "abandoned") throw new ContributionFault("conflict");
        if (operation.outcome !== "migrated") return null;
        const receipt = operation.terminal as ContributionMigrationReceipt;
        if (receipt.expectedV1Revision !== request.expectedV1Revision || receipt.expectedV2Revision !== request.expectedV2Revision)
          throw new ContributionFault("conflict");
        return receipt;
      });
      const terminal = locate(); if (terminal) return { ok: true, value: terminal };
      const bundle = this.#run(observation, request, (owner, now) => this.state.reserveMigration(request,
        captureContributionMigration(this.state.sql, owner), authority(owner, request.deviceId, now)));
      const admitted = () => { try {
        return this.#run(observation, request, () => {
          const control = this.state.control(), operation = this.state.operation(request.operationId);
          return control.phase === "prepared" && control.revision === request.expectedRevision && control.pendingOperation === request.operationId
            && operation?.outcome === "pending" && operation.intent.bodyHash === bundle.bodyHash;
        });
      } catch { return false; } };
      let proof;
      try { proof = await ensureContributionMigration(this.env, bundle, admitted); }
      catch (error) { const result = locate(); if (result) return { ok: true, value: result }; throw error; }
      const after = locate(); if (after) return { ok: true, value: after };
      await this.#before(observation, request);
      const final = locate(); if (final) return { ok: true, value: final };
      return { ok: true, value: this.#run(observation, request, (owner, now) => this.state.commitMigration(bundle, proof,
        authority(owner, request.deviceId, now), () => captureContributionMigration(this.state.sql, owner))) };
    } catch (error) { return failure(error); }
  }
  /** Explicit cancellation of the same migration request is available even
   * when source revisions changed while its immutable evidence was in flight. */
  async cancelMigration(value: ContributionMigrationRequest, secret: string, observation: AdmissionObservation): Promise<ContributionResult<ContributionTerminal>> {
    try {
      const request = parseContributionMigrationRequest(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      await this.#before(observation, request);
      return { ok: true, value: this.#run(observation, request, (owner, now) => {
        const operation = this.state.operation(request.operationId);
        if (!operation || operation.kind !== "migration") throw new ContributionFault("not_started");
        const metadata = this.state.sql.exec("SELECT metadata FROM usage_contribution_operations WHERE id=?", request.operationId).one().metadata;
        if (typeof metadata !== "string" || JSON.stringify((JSON.parse(metadata) as { request: unknown }).request) !== JSON.stringify(request))
          throw new ContributionFault("conflict");
        return this.state.abandon(request.operationId, operation.intent.bodyHash, authority(owner, request.deviceId, now));
      }) };
    } catch (error) { return failure(error); }
  }
  async abandon(value: ContributionAbandonRequest, secret: string, observation: AdmissionObservation): Promise<ContributionResult<ContributionTerminal>> {
    try {
      const request = parseContributionAbandonRequest(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      await this.#before(observation, request);
      return { ok: true, value: this.#run(observation, request, (owner, now) =>
        this.state.abandon(request.operationId, request.bodyHash, authority(owner, request.deviceId, now))) };
    } catch (error) { return failure(error); }
  }
  async cancel(value: ContributionCancelRequest, secret: string, observation: AdmissionObservation): Promise<ContributionCancelResult> {
    try {
      const request = parseContributionCancelRequest(value);
      if (!request) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, request, secret);
      const terminal = this.#run(observation, request, (owner, now) =>
        this.state.cancellationTerminal(request, authority(owner, request.deviceId, now)));
      if (terminal) return { ok: true, value: terminal };
      await this.#before(observation, request);
      return { ok: true, value: this.#run(observation, request, (owner, now) =>
        this.state.cancelBatch(request, authority(owner, request.deviceId, now))) };
    } catch (error) { return failure(error); }
  }
  async admit(value: ContributionBatch, secret: string, observation: AdmissionObservation): Promise<ContributionResult<ContributionTerminal>> {
    try {
      const batch = parseContributionBatch(value);
      if (!batch) throw new ContributionFault("invalid_input");
      await this.#authenticate(observation, batch, secret);
      const settled = this.#run(observation, batch, (owner, now) => {
        if (batch.mutations.some(mutation => mutation.kind === "put" && mutation.row.utcDay > Math.floor(now / 86_400_000)))
          throw new ContributionFault("invalid_input");
        return this.state.reserve(batch, authority(owner, batch.deviceId, now)).terminal;
      });
      if (settled) return { ok: true, value: settled };
      const bodyHash = contributionBodyHash(batch);
      const locate = (): ContributionTerminal | null => this.#run(observation, batch, (owner, now) => {
        const operation = this.state.operation(batch.operationId);
        if (!operation || operation.kind !== "batch" || operation.intent.bodyHash !== bodyHash) throw new ContributionFault("conflict");
        if (operation.terminal) return operation.terminal as ContributionTerminal;
        this.state.check(batch, authority(owner, batch.deviceId, now)); return null;
      });
      const body = await ensureContributionBody(this.env.STAGING, batch, () => { try { return locate() === null; } catch { return false; } });
      // Lost replies or another exact retry can have settled this operation.
      // Reconcile before interpreting either success or failure of the await.
      const terminal = locate();
      if (terminal) return { ok: true, value: terminal };
      if (!body.ok) return body;
      const bundle = this.#run(observation, batch, (owner, now) => this.state.deltaBundle(batch, authority(owner, batch.deviceId, now)));
      const journal = await ensureContributionJournal(this.env.STAGING, bundle, () => { try { return locate() === null; } catch { return false; } });
      const afterJournal = locate(); if (afterJournal) return { ok: true, value: afterJournal };
      await this.#before(observation, batch);
      const final = locate(); if (final) return { ok: true, value: final };
      return { ok: true, value: this.#run(observation, batch, (owner, now) =>
        this.state.commit(batch, body.value, authority(owner, batch.deviceId, now), journal)) };
    } catch (error) { return failure(error); }
  }
}
