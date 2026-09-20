import { admissionHex, equalAdmissionBytes, type AdmissionBatch } from "../../../lib/usage/admission";
import { ensureAdmissionBatchObject, ensureAdmissionJournalObject, type AdmissionObjectError } from "./admission-objects";
import { ADMISSION_POLICY_V1, AdmissionFault, batchAccount, timestampsAtMost, type AdmissionFailure } from "./admission-policy";
import { AdmissionState, type AdmissionAuthority, type AdmissionPending } from "./admission-state";
import { enrollmentTime } from "./enrollment-contract";
import type { EnrollmentResult } from "./enrollment";
import { readNamespaceAnchor, sameNamespaceAnchor, type NamespaceAnchor } from "./namespace-anchor";
import { uploadSecretCommitment } from "./pairing";
import type { FenceObservation } from "./restore-fence";

// `committed` is a mutable, request-scoped cell: the owning account transaction
// sets it when it durably writes, so the restore-fence lease can be released
// with the exact commit outcome. `fence` is null for a non-mutating read.
export type AdmissionObservation = { generation: string; observed: number; fence: FenceObservation | null; committed: boolean };
export type AdmissionOwner = AdmissionAuthority & { anchor: NamespaceAnchor };
export type AdmissionTransaction = <T>(observation: AdmissionObservation, run: (state: AdmissionOwner | null, now: number) => T) => EnrollmentResult<T>;
type Flight = { kind: "pending"; pending: AdmissionPending } | { kind: "settled"; bytes: Uint8Array };

// Both commitments are validated 32-byte hex. Never compare secret preimages or
// use the short-lived enrollment grant as routine upload authority.
function sameCommitment(left: string, right: string): boolean {
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/** Internal composition only. No public route, request-controlled policy or hooks. */
export class AccountAdmission {
  constructor(readonly env: Env, readonly state: AdmissionState, readonly transaction: AdmissionTransaction) {}

  #run<T>(observation: AdmissionObservation, batch: AdmissionBatch, run: (authority: AdmissionOwner, now: number) => T): T {
    const result = this.transaction(observation, (authority, now) => {
      if (!authority || authority.phase !== "active") throw new AdmissionFault("not_enrolled");
      if (authority.accountId !== batchAccount(batch)) throw new AdmissionFault("unauthorized");
      if (this.state.control().quarantined) throw new AdmissionFault("recovery_required");
      return run(authority, now);
    });
    if (!result.ok) {
      switch (result.error) {
        case "invalid_input": case "unauthorized": case "not_enrolled": case "revoked": case "conflict": case "profile_superseded":
        case "recovery_required": case "clock_regressed": case "storage_invalid": case "storage_unavailable": case "limit":
          throw new AdmissionFault(result.error);
        default: throw new AdmissionFault();
      }
    }
    return result.value;
  }

  #locate(observation: AdmissionObservation, batch: AdmissionBatch): Flight {
    return this.#run(observation, batch, authority => {
      const progress = this.state.progress(batch.deviceId, authority);
      if (progress.batch && progress.journal && equalAdmissionBytes(progress.batch.bytes, batch.bytes)) {
        return { kind: "settled", bytes: Uint8Array.from(progress.journal.bytes) };
      }
      const pending = this.state.pending(authority);
      if (!pending || !equalAdmissionBytes(pending.batch.bytes, batch.bytes)) throw new AdmissionFault("conflict");
      return { kind: "pending", pending };
    });
  }

  async #resume(observation: AdmissionObservation, batch: AdmissionBatch): Promise<Uint8Array> {
    let flight = this.#locate(observation, batch);
    if (flight.kind === "settled") return flight.bytes;
    // Only these two phases, never an account-wide async mutex. Revocation can
    // commit while the object helper is awaiting its immutable readback.
    for (const phase of [1, 2] as const) {
      if (flight.kind === "settled") return flight.bytes;
      if (flight.pending.phase !== phase) continue;
      const original = flight.pending;
      let fenceFailure: AdmissionFailure | null = null;
      const fence = () => {
        try {
          const current = this.#locate(observation, batch);
          return current.kind === "pending" && current.pending.phase === phase
            && (phase === 1 || (current.pending.journal !== null && original.journal !== null
              && equalAdmissionBytes(current.pending.journal.bytes, original.journal.bytes)));
        } catch (error) {
          fenceFailure = error instanceof AdmissionFault ? error.code : "storage_invalid";
          return false;
        }
      };
      const result = phase === 1
        ? await ensureAdmissionBatchObject(this.env.STAGING, batch.bytes, ADMISSION_POLICY_V1, fence)
        : await ensureAdmissionJournalObject(this.env.CONTROL, original.journal!.bytes, batch.bytes, ADMISSION_POLICY_V1, fence);
      // Reconcile identity before interpreting a delayed response, including a
      // failure. Another exact retry may already have frozen or published it.
      flight = this.#locate(observation, batch);
      if (fenceFailure !== null) throw new AdmissionFault(fenceFailure);
      if (flight.kind === "settled") return flight.bytes;
      if (flight.pending.phase !== phase) continue;
      if (!result.ok) {
        this.#objectFailure(observation, batch, phase, result.error);
      }
      flight = this.#run(observation, batch, (authority, now): Flight => {
        const progress = this.state.progress(batch.deviceId, authority);
        if (progress.batch && progress.journal && equalAdmissionBytes(progress.batch.bytes, batch.bytes)) {
          return { kind: "settled", bytes: Uint8Array.from(progress.journal.bytes) };
        }
        const pending = this.state.pending(authority);
        if (!pending || !equalAdmissionBytes(pending.batch.bytes, batch.bytes)) throw new AdmissionFault("conflict");
        if (phase === 1) return { kind: "pending", pending: this.state.freeze(pending, authority, now) };
        if (pending.phase !== 2 || !pending.journal || !original.journal || !equalAdmissionBytes(pending.journal.bytes, original.journal.bytes)) throw new AdmissionFault();
        return { kind: "settled", bytes: this.state.publish(pending, authority) };
      });
    }
    if (flight.kind !== "settled") throw new AdmissionFault("storage_unavailable");
    return Uint8Array.from(flight.bytes);
  }

  #objectFailure(observation: AdmissionObservation, batch: AdmissionBatch, phase: 1 | 2, error: AdmissionObjectError): never {
    if (error === "storage_conflict") {
      this.#run(observation, batch, authority => {
        const pending = this.state.pending(authority);
        if (!pending || pending.phase !== phase || !equalAdmissionBytes(pending.batch.bytes, batch.bytes)) throw new AdmissionFault("conflict");
        this.state.quarantine();
      });
      throw new AdmissionFault("storage_invalid");
    }
    throw new AdmissionFault(error === "invalid_input" ? "storage_invalid" : "storage_unavailable");
  }

  /** `request` is the owned, fully decoded admission request the caller parsed
   * before the restore-fence lease await — decoding here instead would re-read a
   * mutable `input.batch` after the await and break mutation resistance. */
  async admit(request: { uploadSecret: string; batch: AdmissionBatch }, fence: FenceObservation | null): Promise<EnrollmentResult<Uint8Array>> {
    try {
      const { uploadSecret, batch } = request;
      const observed = Date.now();
      if (!enrollmentTime(observed)) throw new AdmissionFault("clock_regressed");
      const observation = { generation: admissionHex(batch.generation), observed, fence, committed: false };
      const original = this.#run(observation, batch, authority => {
        const device = authority.devices.find(device => device.deviceId === admissionHex(batch.deviceId));
        if (!device) throw new AdmissionFault("unauthorized");
        return { intentId: device.reservation.intentId, commitment: device.reservation.uploadCommitment, anchor: { ...authority.anchor } };
      });
      const commitment = await uploadSecretCommitment(original.intentId, uploadSecret);
      if (!commitment.ok || !sameCommitment(original.commitment, commitment.value)) throw new AdmissionFault("unauthorized");
      this.#run(observation, batch, authority => {
        const device = authority.devices.find(device => device.deviceId === admissionHex(batch.deviceId));
        if (!device || device.reservation.intentId !== original.intentId || !sameCommitment(device.reservation.uploadCommitment, commitment.value)) throw new AdmissionFault("unauthorized");
      });
      const external = await readNamespaceAnchor(this.env.CONTROL, batchAccount(batch));
      this.#run(observation, batch, authority => {
        if (!external || !sameNamespaceAnchor(external, original.anchor) || !sameNamespaceAnchor(authority.anchor, original.anchor)) throw new AdmissionFault("recovery_required");
      });
      const selected = this.#run(observation, batch, (authority, now) => {
        const progress = this.state.progress(batch.deviceId, authority);
        if (progress.batch && progress.journal && equalAdmissionBytes(progress.batch.bytes, batch.bytes)) return { settled: Uint8Array.from(progress.journal.bytes), pending: null };
        const pending = this.state.pending(authority);
        if (pending && equalAdmissionBytes(pending.batch.bytes, batch.bytes)) return { settled: null, pending };
        const device = authority.devices.find(device => device.deviceId === admissionHex(batch.deviceId));
        if (!device) throw new AdmissionFault("unauthorized");
        if (device.revokedAtMs !== null) throw new AdmissionFault("revoked");
        if (batch.firstSequence !== progress.sequence + 1) throw new AdmissionFault("conflict");
        try { timestampsAtMost(batch, now); }
        catch { throw new AdmissionFault("invalid_input"); }
        return { settled: null, pending };
      });
      if (selected.settled) return { ok: true, value: selected.settled };
      if (selected.pending && equalAdmissionBytes(selected.pending.batch.bytes, batch.bytes)) {
        return { ok: true, value: await this.#resume(observation, batch) };
      }
      // Help at most one already-authenticated predecessor, never return its
      // receipt to this device and never promise an unbounded drain loop.
      if (selected.pending) await this.#resume(observation, selected.pending.batch);
      const reserved = this.#run(observation, batch, (authority, now) => {
        const progress = this.state.progress(batch.deviceId, authority);
        if (progress.batch && progress.journal && equalAdmissionBytes(progress.batch.bytes, batch.bytes)) return false;
        const pending = this.state.pending(authority);
        if (pending) {
          if (equalAdmissionBytes(pending.batch.bytes, batch.bytes)) return true;
          throw new AdmissionFault("conflict");
        }
        const device = authority.devices.find(device => device.deviceId === admissionHex(batch.deviceId));
        if (!device) throw new AdmissionFault("unauthorized");
        if (device.revokedAtMs !== null) throw new AdmissionFault("revoked");
        if (batch.firstSequence !== progress.sequence + 1) throw new AdmissionFault("conflict");
        try { timestampsAtMost(batch, now); }
        catch { throw new AdmissionFault("invalid_input"); }
        this.state.reserve(batch, authority, now);
        return true;
      });
      // The locate path also handles a concurrent exact publication after the
      // reservation transaction; a boolean is not itself an admission receipt.
      void reserved;
      return { ok: true, value: await this.#resume(observation, batch) };
    } catch (error) {
      return { ok: false, error: error instanceof AdmissionFault ? error.code : "storage_unavailable" };
    }
  }
}
