import { statsHex, type StatsReceipt, type StatsResult, type StatsStatus, type StatsStatusRequest, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import type { StatsAbandonRequest, StatsAbandonment } from "../../../lib/usage/stats-http-contract";
import { AdmissionFault } from "./admission-policy";
import type { AdmissionObservation, AdmissionOwner } from "./account-admission";
import type { EnrollmentResult } from "./enrollment";
import { readNamespaceAnchor, sameNamespaceAnchor } from "./namespace-anchor";
import { uploadSecretCommitment } from "./pairing";
import { ensureStatsReceipt, ensureStatsSnapshot } from "./stats-objects";
import { StatsFault, StatsState, statsHash, statsUploadText } from "./stats-state";

export type StatsTransaction = <T>(observation: AdmissionObservation, run: (owner: AdmissionOwner | null, now: number) => T) => EnrollmentResult<T>;
const sameSecret = (left: string, right: string) => {
  if (!statsHex(left) || !statsHex(right)) return false;
  let difference = 0; for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};
type Identity = Pick<StatsUpload, "accountId" | "deviceId" | "generation">;

/** No independent authority cache: each step re-enters the owning account
 * transaction, including the final post-R2 revocation and restore check. */
export class AccountStats {
  constructor(readonly env: Env, readonly state: StatsState, readonly transaction: StatsTransaction) {}
  #run<T>(observation: AdmissionObservation, identity: Identity, run: (owner: AdmissionOwner, now: number) => T): T {
    const result = this.transaction(observation, (owner, now) => {
      if (!owner || owner.phase !== "active") throw new StatsFault("not_enrolled");
      if (owner.accountId !== identity.accountId || owner.generation !== identity.generation) throw new StatsFault("unauthorized");
      const device = owner.devices.find(item => item.deviceId === identity.deviceId);
      if (!device) throw new StatsFault("unauthorized");
      if (device.revokedAtMs !== null) throw new StatsFault("revoked");
      if (this.state.control().quarantined) throw new StatsFault("recovery_required");
      return run(owner, now);
    });
    if (!result.ok) throw new StatsFault(result.error === "not_reserved" || result.error === "unavailable" || result.error === "handle_unavailable" || result.error === "publishing_full" ? "storage_unavailable" : result.error);
    return result.value;
  }
  async #authenticate(observation: AdmissionObservation, identity: Identity, secret: string): Promise<void> {
    const original = this.#run(observation, identity, owner => {
      const device = owner.devices.find(item => item.deviceId === identity.deviceId)!;
      return { intentId: device.reservation.intentId, commitment: device.reservation.uploadCommitment, anchor: { ...owner.anchor } };
    });
    const commitment = await uploadSecretCommitment(original.intentId, secret);
    if (!commitment.ok || !sameSecret(commitment.value, original.commitment)) throw new StatsFault("unauthorized");
    this.#run(observation, identity, owner => {
      const device = owner.devices.find(item => item.deviceId === identity.deviceId)!;
      if (device.reservation.intentId !== original.intentId || !sameSecret(device.reservation.uploadCommitment, commitment.value)) throw new StatsFault("unauthorized");
    });
    const anchor = await readNamespaceAnchor(this.env.CONTROL, identity.accountId);
    this.#run(observation, identity, owner => {
      if (!anchor || !sameNamespaceAnchor(anchor, original.anchor) || !sameNamespaceAnchor(owner.anchor, original.anchor)) throw new StatsFault("recovery_required");
    });
  }
  async status(request: StatsStatusRequest, secret: string, observation: AdmissionObservation): Promise<StatsResult<StatsStatus>> {
    try {
      await this.#authenticate(observation, request, secret);
      return { ok: true, value: this.#run(observation, request, owner => this.state.status(owner, request.deviceId, request.client, request)) };
    } catch (error) { return { ok: false, error: error instanceof StatsFault || error instanceof AdmissionFault ? error.code : "storage_unavailable" }; }
  }
  async abandon(request: StatsAbandonRequest, secret: string, observation: AdmissionObservation): Promise<StatsResult<StatsAbandonment>> {
    try {
      await this.#authenticate(observation, request, secret);
      return { ok: true, value: this.#run(observation, request, (_owner, now) => this.state.abandon(request, now)) };
    } catch (error) { return { ok: false, error: error instanceof StatsFault || error instanceof AdmissionFault ? error.code : "storage_unavailable" }; }
  }
  async admit(request: StatsUpload, secret: string, observation: AdmissionObservation): Promise<StatsResult<StatsReceipt>> {
    try {
      await this.#authenticate(observation, request, secret);
      const bodyHash = statsHash(statsUploadText(request));
      const locate = (): StatsReceipt | null => this.#run(observation, request, owner => {
        const progress = this.state.progress(request.deviceId);
        if (progress.receipt?.bodyHash === bodyHash && progress.receipt.sequence === request.sequence && progress.receipt.operationId === request.operationId) return progress.receipt;
        const pending = this.state.pending();
        if (!pending || pending.bodyHash !== bodyHash || pending.deviceId !== request.deviceId) throw new StatsFault("conflict");
        this.state.check(request, owner);
        return null;
      });
      const settled = this.#run(observation, request, (owner, now) => {
        if (request.report.generatedAtMs > now || request.report.firstUtcDay + request.report.dayCount - 1 > Math.floor(now / 86_400_000)) throw new StatsFault("invalid_input");
        const progress = this.state.progress(request.deviceId);
        if (progress.receipt?.bodyHash === bodyHash && progress.receipt.sequence === request.sequence && progress.receipt.operationId === request.operationId) return progress.receipt;
        const pending = this.state.pending();
        if (pending) {
          if (pending.deviceId !== request.deviceId) throw new StatsFault("conflict");
          if (pending.bodyHash === bodyHash) { this.state.check(request, owner); return null; }
          // A different body has no authority to erase the retained intent.
          // Explicit abandon first advances the durable predecessor revision;
          // a delayed A can then neither displace B nor reserve/charge again.
          throw new StatsFault("conflict");
        }
        this.state.reserve(request, owner, now);
        return null;
      });
      if (settled) return { ok: true, value: settled };
      const admitted = () => { try { return locate() === null; } catch { return false; } };
      const snapshot = await ensureStatsSnapshot(this.env.STAGING, request, admitted);
      const afterSnapshot = locate();
      if (afterSnapshot) return { ok: true, value: afterSnapshot };
      if (!snapshot.ok) {
        if (snapshot.error === "storage_conflict") this.#run(observation, request, () => this.state.quarantine());
        throw new StatsFault(snapshot.error === "storage_conflict" ? "storage_invalid" : "storage_unavailable");
      }
      const receipt = this.#run(observation, request, (owner, now) => this.state.freeze(request, owner, now));
      const retained = await ensureStatsReceipt(this.env.CONTROL, request, receipt, admitted);
      const afterReceipt = locate();
      if (afterReceipt) return { ok: true, value: afterReceipt };
      if (!retained.ok) {
        if (retained.error === "storage_conflict") this.#run(observation, request, () => this.state.quarantine());
        throw new StatsFault(retained.error === "storage_conflict" ? "storage_invalid" : "storage_unavailable");
      }
      return { ok: true, value: this.#run(observation, request, owner => this.state.publish(request, owner)) };
    } catch (error) { return { ok: false, error: error instanceof StatsFault || error instanceof AdmissionFault ? error.code : "storage_unavailable" }; }
  }
}
