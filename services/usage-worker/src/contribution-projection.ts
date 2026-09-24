import { contributionAccount, contributionHash, contributionIdentity, ContributionFault, isContributionError,
  type ContributionError } from "../../../lib/usage/contributions";
import { CONTRIBUTION_INDEX_MAX_IO_BYTES, CONTRIBUTION_INDEX_MAX_READS, type ContributionIndexLoader } from "../../../lib/usage/contribution-index";
import { statsOwnRecord } from "../../../lib/usage/stats-contract";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "./account-admission";
import { AdmissionFault } from "./admission-policy";
import { readNamespaceAnchor, sameNamespaceAnchor } from "./namespace-anchor";
import { ContributionState } from "./contributions-state";
import { ensureContributionIndexStage, readContributionIndexObject } from "./contribution-index-objects";
import { readCommittedContributionRevision, verifyContributionRevision, loadContributionRevisionChunk,
  type VerifiedContributionRevision } from "./contribution-replay";
import { ContributionProjectionState, planContributionProjectionChunk,
  type ContributionProjectionAuthority, type ContributionProjectionControl, type ContributionProjectionStatus } from "./contribution-projection-state";

export type ContributionProjectionRequest = Readonly<{ schemaVersion: 3; accountId: string; generation: string }>;
export type ContributionProjectionAdvanceResult = Readonly<{ ok: true; value: ContributionProjectionStatus }>
  | Readonly<{ ok: false; error: ContributionError; status: ContributionProjectionStatus | null }>;
const inventories = new WeakMap<object, Readonly<{ sourceHash: string; proof: VerifiedContributionRevision }>>();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const mapped = (error: string): ContributionError => isContributionError(error) ? error : "storage_unavailable";
const failure = (error: unknown): ContributionError => error instanceof ContributionFault ? error.code
  : error instanceof AdmissionFault ? mapped(error.code) : "storage_unavailable";
const authority = (owner: AdmissionOwner, now: number): ContributionProjectionAuthority => ({
  accountId: owner.accountId, generation: owner.generation, observedAtMs: now, active: owner.phase === "active",
});
function parseRequest(value: unknown): ContributionProjectionRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation"]);
    return raw?.schemaVersion === 3 && contributionAccount(raw.accountId) && contributionIdentity(raw.generation)
      ? Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation }) : null;
  } catch { return null; }
}
function samePosition(left: ContributionProjectionControl, right: ContributionProjectionControl): boolean {
  return left.accountId === right.accountId && left.generation === right.generation && left.appliedRevision === right.appliedRevision
    && same(left.appliedRoot, right.appliedRoot) && same(left.source, right.source) && same(left.stagedRoot, right.stagedRoot)
    && left.phase === right.phase && left.cursor === right.cursor;
}

/** Trusted account maintenance only. The caller authenticates the account and
 * retains its execution registration around the entire awaited invocation.
 * Each synchronous continuation re-enters that caller's fresh fence/authority
 * transaction. A failed immutable put owns no later publication callback. */
export class AccountContributionProjection {
  constructor(readonly env: Env, readonly state: ContributionProjectionState, readonly transaction: AdmissionTransaction,
    readonly beforeProgress?: () => Promise<void>) {}
  #run<T>(request: ContributionProjectionRequest, observation: AdmissionObservation, callback: (owner: AdmissionOwner, now: number) => T): T {
    const result = this.transaction(observation, (owner, now) => {
      if (!owner || owner.phase !== "active") throw new ContributionFault("not_enrolled");
      if (owner.accountId !== request.accountId || owner.generation !== request.generation) throw new ContributionFault("unauthorized");
      const control = this.state.control();
      if (control.accountId !== request.accountId || control.generation !== request.generation) throw new ContributionFault("generation_conflict");
      // Rechecking status is pure and binds source revision, clock and any
      // staged descriptor to the current canonical journal on every re-entry.
      this.state.status(now);
      return callback(owner, now);
    });
    if (!result.ok) throw new ContributionFault(mapped(result.error)); return result.value;
  }
  async #before(admitted: () => boolean): Promise<void> {
    await this.beforeProgress?.();
    if (!admitted()) throw new ContributionFault("recovery_required");
  }
  async #publishReady(request: ContributionProjectionRequest, observation: AdmissionObservation, admitted: () => boolean): Promise<ContributionProjectionStatus> {
    const candidate = this.#run(request, observation, (_owner, now) => this.state.status(now));
    if (candidate.nextPublicationAtMs === null || candidate.publicationWait !== null) return candidate;
    await this.#before(admitted);
    return this.#run(request, observation, (owner, now) => {
      const status = this.state.status(now);
      if (status.nextPublicationAtMs !== null && status.nextPublicationAtMs <= now && status.publicationWait === null)
        this.state.publish(authority(owner, now));
      return this.state.status(now);
    });
  }
  async advance(value: unknown, observation: AdmissionObservation): Promise<ContributionProjectionAdvanceResult> {
    const request = parseRequest(value);
    if (!request) return { ok: false, error: "invalid_input", status: null };
    try {
      const anchor = this.#run(request, observation, owner => Object.freeze({ ...owner.anchor }));
      const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      this.#run(request, observation, owner => {
        if (!external || !sameNamespaceAnchor(external, anchor) || !sameNamespaceAnchor(owner.anchor, anchor)) throw new ContributionFault("recovery_required");
      });
      const admitted = () => {
        try { return this.#run(request, observation, owner => sameNamespaceAnchor(owner.anchor, anchor)); } catch { return false; }
      };
      // Publishing the last complete applied root never consumes, invalidates
      // or exposes the next revision's in-flight stage or reservation.
      await this.#publishReady(request, observation, admitted);
      let control = this.#run(request, observation, () => this.state.control());
      // A completed stage survives a crash before advancing the applied
      // frontier without replay or another immutable charge.
      if (control.source && control.phase === "add" && control.cursor === control.source.deltaCount) {
        await this.#before(admitted);
        this.#run(request, observation, (owner, now) => this.state.apply(authority(owner, now)));
        return { ok: true, value: await this.#publishReady(request, observation, admitted) };
      }
      const source = this.#run(request, observation, () => readCommittedContributionRevision(new ContributionState(this.state.storage), control.appliedRevision));
      if (source === null) return { ok: true, value: await this.#publishReady(request, observation, admitted) };
      const sourceHash = contributionHash(JSON.stringify(source)), cached = inventories.get(this.state.storage);
      const proof = cached?.sourceHash === sourceHash ? cached.proof : await verifyContributionRevision(this.env.STAGING, source, admitted);
      if (!admitted()) throw new ContributionFault("recovery_required");
      inventories.set(this.state.storage, Object.freeze({ sourceHash, proof }));
      if (control.source === null) {
        await this.#before(admitted);
        this.#run(request, observation, (owner, now) => this.state.begin(proof, authority(owner, now)));
        control = this.#run(request, observation, () => this.state.control());
      }
      if (!same(control.source, source)) throw new ContributionFault("conflict");
      if (source.deltaCount === 0) {
        await this.#before(admitted);
        this.#run(request, observation, (owner, now) => this.state.apply(authority(owner, now)));
        return { ok: true, value: await this.#publishReady(request, observation, admitted) };
      }
      const expected = control;
      const current = () => {
        try { return this.#run(request, observation, owner => sameNamespaceAnchor(owner.anchor, anchor) && samePosition(expected, this.state.control())); }
        catch { return false; }
      };
      const chunk = await loadContributionRevisionChunk(this.env.STAGING, proof, control.phase!, control.cursor, current);
      if (!current()) throw new ContributionFault("recovery_required");
      // Share a bounded read cache across cell lookup and path-copy planning,
      // so their separate core bounds cannot double the actual object budget.
      const objects = new Map<string, string>(); let readBytes = 0, loaderRefusal: ContributionError | null = null;
      const load: ContributionIndexLoader = async reference => {
        try {
          if (!current()) throw new ContributionFault("recovery_required");
          const cached = objects.get(reference.hash); if (cached !== undefined) return cached;
          if (objects.size >= CONTRIBUTION_INDEX_MAX_READS || readBytes + reference.byteLength > CONTRIBUTION_INDEX_MAX_IO_BYTES)
            throw new ContributionFault("limit");
          readBytes += reference.byteLength;
          const text = await readContributionIndexObject(this.env.STAGING, request, reference);
          if (!current()) throw new ContributionFault("recovery_required"); objects.set(reference.hash, text); return text;
        } catch (error) { loaderRefusal = failure(error); throw error; }
      };
      let plan;
      try { plan = await planContributionProjectionChunk(control, chunk, load); }
      catch (error) { throw loaderRefusal === null ? error : new ContributionFault(loaderRefusal); }
      await this.#before(current);
      this.#run(request, observation, (owner, now) => this.state.reserve(plan, authority(owner, now)));
      const reserved = () => current() && this.#run(request, observation, () => this.state.pending()?.hash === plan.pending.hash);
      const stored = await ensureContributionIndexStage(this.env.STAGING, request, plan.stage, reserved);
      await this.#before(reserved);
      this.#run(request, observation, (owner, now) => this.state.commit(plan, stored, authority(owner, now)));
      // Applying and publication use separate transactions. Waiting for the
      // publication interval or retained cursors cannot roll back completed
      // work or prevent the next canonical revision from being applied.
      const after = this.#run(request, observation, () => this.state.control());
      if (after.source && after.phase === "add" && after.cursor === after.source.deltaCount) {
        await this.#before(admitted);
        this.#run(request, observation, (owner, now) => this.state.apply(authority(owner, now)));
      }
      return { ok: true, value: await this.#publishReady(request, observation, admitted) };
    } catch (error) {
      const code = failure(error); let status: ContributionProjectionStatus | null = null;
      try { status = this.#run(request, observation, (_owner, now) => this.state.status(now, code)); } catch { /* Closed or invalid authority cannot disclose a snapshot. */ }
      return { ok: false, error: code, status };
    }
  }
}
