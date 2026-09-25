import { ContributionFault } from "../../../lib/usage/contributions";
import { CONTRIBUTION_INDEX_MAX_IO_BYTES, CONTRIBUTION_INDEX_MAX_READS, type ContributionIndexLoader } from "../../../lib/usage/contribution-index";
import { CONTRIBUTION_REBUILD_DEADLINE_MS, CONTRIBUTION_REBUILD_MAX_SOURCE_BYTES, CONTRIBUTION_REBUILD_MAX_COMPARISON_READS,
  CONTRIBUTION_REBUILD_MAX_COMPARISON_BYTES, CONTRIBUTION_REBUILD_MAX_READS, CONTRIBUTION_REBUILD_MAX_READ_BYTES,
  isContributionRebuildError, parseContributionRebuildRequest, parseContributionRebuildReadRequest, type ContributionRebuildReadRequest,
  type ContributionRebuildResult, type ContributionRebuildStatusResult, type ContributionRebuildError,
  type ContributionRebuildBudget } from "../../../lib/usage/contribution-rebuild-contract";
import type { ContributionRebuildInput } from "../../../lib/usage/contribution-rebuild";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "./account-admission";
import { AdmissionFault } from "./admission-policy";
import { ContributionRebuildFault, ContributionRebuildState, type ContributionRebuildAuthority } from "./contribution-rebuild-state";
import { readContributionBody } from "./contributions-objects";
import { ensureContributionIndexStage, readContributionIndexObject } from "./contribution-index-objects";

const mapped = (value: string): ContributionRebuildError => isContributionRebuildError(value) ? value : "storage_unavailable";
const failure = (value: unknown): ContributionRebuildError => value instanceof ContributionRebuildFault ? value.code
  : value instanceof ContributionFault ? value.code : value instanceof AdmissionFault ? mapped(value.code) : "storage_unavailable";
const authority = (owner: AdmissionOwner, now: number): ContributionRebuildAuthority => ({ accountId: owner.accountId,
  generation: owner.generation, observedAtMs: now, active: owner.phase === "active" });

/** Trusted foreground diagnostic. The caller owns external namespace/fence
 * validation and retains actual provider-write custody after an outward timeout.
 * Its supplied transaction and bucket may retire this invocation earlier. Every
 * controller continuation checks retirement before entering SQL or new I/O. */
export class AccountContributionRebuild {
  constructor(readonly env: Pick<Env, "STAGING">, readonly state: ContributionRebuildState, readonly transaction: AdmissionTransaction) {}
  #run<T>(request: ContributionRebuildReadRequest, observation: AdmissionObservation, live: () => void,
    callback: (owner: AdmissionOwner, now: number) => T): T {
    live();
    const result = this.transaction(observation, (owner, now) => {
      live();
      if (!owner || owner.phase !== "active") throw new ContributionRebuildFault("not_enrolled");
      if (owner.accountId !== request.accountId) throw new ContributionRebuildFault("unauthorized");
      if (owner.generation !== request.generation) throw new ContributionRebuildFault("generation_conflict");
      this.state.assertAuthority(authority(owner, now)); return callback(owner, now);
    });
    if (!result.ok) throw new ContributionRebuildFault(mapped(result.error)); return result.value;
  }
  status(input: unknown, observation: AdmissionObservation): ContributionRebuildStatusResult {
    const request = parseContributionRebuildReadRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    try { return { ok: true, value: this.#run(request, observation, () => undefined, (owner, now) => {
      const value = this.state.status(request.jobId, authority(owner, now));
      if (value && (value.receipt.accountId !== request.accountId || value.receipt.generation !== request.generation))
        throw new ContributionRebuildFault("storage_invalid");
      if (value && value.receipt.completedAtMs > now) throw new ContributionRebuildFault("clock_regressed");
      return value;
    }) }; }
    catch (error) { return { ok: false, error: failure(error) }; }
  }
  async execute(input: unknown, observation: AdmissionObservation): Promise<ContributionRebuildResult> {
    const request = parseContributionRebuildRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    let retired = false;
    const deadline = performance.now() + CONTRIBUTION_REBUILD_DEADLINE_MS;
    const live = () => { if (retired || performance.now() >= deadline) throw new ContributionRebuildFault("deadline"); };
    let lastObserved = 0;
    const run = <T>(callback: (owner: AdmissionOwner, now: number) => T) => this.#run(request, observation, live, (owner, now) => {
      if (now < lastObserved) throw new ContributionRebuildFault("clock_regressed");
      lastObserved = now; return callback(owner, now);
    });
    const work = async (): Promise<ContributionRebuildResult> => {
      // Diagnostic execution never publishes. The cutover has its own entry.
      if (request.action === "publish") return { ok: false, error: "invalid_input" };
      if (request.action === "begin") return { ok: true, value: run((owner, now) => this.state.begin(request.jobId, request.expectedRevision, authority(owner, now))) };
      if (request.action === "abort") return { ok: true, value: run((owner, now) => this.state.abort(request.jobId, request.expectedVersion, authority(owner, now))) };
      const repeated = run((owner, now) => this.state.retry(request.jobId, request.expectedVersion, "advance", authority(owner, now)));
      if (repeated) return { ok: true, value: repeated };
      const job = run((owner, now) => this.state.checked(request.jobId, request.expectedVersion, authority(owner, now)));
      const current = () => run((owner, now) => this.state.assertPosition(job, authority(owner, now)));
      const cache = new Map<string, string>(); let indexBytes = 0, sourceBytes = 0, sourceObjects = 0;
      let loaderError: ContributionRebuildError | null = null;
      const comparing = job.receipt.phase === "comparing";
      const readLimit = comparing ? CONTRIBUTION_REBUILD_MAX_COMPARISON_READS : CONTRIBUTION_INDEX_MAX_READS;
      const byteLimit = comparing ? CONTRIBUTION_REBUILD_MAX_COMPARISON_BYTES : CONTRIBUTION_INDEX_MAX_IO_BYTES;
      const load: ContributionIndexLoader = async reference => {
        try {
          current(); const cached = cache.get(reference.hash); if (cached !== undefined) return cached;
          if (cache.size >= readLimit || indexBytes + reference.byteLength > byteLimit) throw new ContributionRebuildFault("limit");
          indexBytes += reference.byteLength;
          const text = await readContributionIndexObject(this.env.STAGING, request, reference);
          current(); cache.set(reference.hash, text); return text;
        } catch (error) { loaderError = failure(error); throw error; }
      };
      if (comparing) {
        let plan;
        try { plan = await this.state.planComparison(job, load); }
        catch (error) { throw loaderError ? new ContributionRebuildFault(loaderError) : error; }
        current();
        const budget: ContributionRebuildBudget = { sourceObjects: 0, sourceBytes: 0, indexObjects: cache.size, indexBytes, writeObjects: 0, writeBytes: 0 };
        return { ok: true, value: run((owner, now) => this.state.commitComparison(plan, budget, authority(owner, now))) };
      }
      const chunk = run((owner, now) => this.state.headChunk(job, authority(owner, now))), values: ContributionRebuildInput[] = [];
      for (const head of chunk.heads) {
        if (head.deleted || head.members === 0) continue;
        current();
        if (sourceObjects >= 16 || sourceBytes + 1_048_576 > CONTRIBUTION_REBUILD_MAX_SOURCE_BYTES) throw new ContributionRebuildFault("limit");
        if (head.reference?.kind !== "batch-v3") throw new ContributionRebuildFault("legacy_unresolved");
        sourceObjects++;
        const loaded = await readContributionBody(this.env.STAGING, request.accountId, head.reference.bodyHash);
        current(); if (!loaded.ok) throw new ContributionRebuildFault(loaded.error);
        sourceBytes += loaded.value.verified.byteLength;
        values.push(run((owner, now) => this.state.resolveHead(chunk, head.id, loaded.value.batch, loaded.value.verified, authority(owner, now))));
      }
      let plan;
      try { plan = await this.state.planHeadStep(job, chunk, values, load); }
      catch (error) { throw loaderError ? new ContributionRebuildFault(loaderError) : error; }
      current();
      // Pre-admit every possible stage readback before the first put. Repeated
      // puts may leave charged immutable orphans; they cannot grow this budget.
      if (sourceObjects + cache.size + plan.stage.objects.length > CONTRIBUTION_REBUILD_MAX_READS
        || sourceBytes + indexBytes + plan.stage.writeBytes > CONTRIBUTION_REBUILD_MAX_READ_BYTES)
        throw new ContributionRebuildFault("limit");
      run((owner, now) => this.state.reserveHeadStep(plan, authority(owner, now)));
      let guardError: ContributionRebuildError | null = null;
      const reserved = () => {
        try { run((owner, now) => this.state.reserved(plan, authority(owner, now))); return true; }
        catch (error) { guardError = failure(error); return false; }
      };
      let stored;
      try { stored = await ensureContributionIndexStage(this.env.STAGING, request, plan.stage, reserved); }
      catch (error) { throw guardError ? new ContributionRebuildFault(guardError) : error; }
      current();
      const budget: ContributionRebuildBudget = { sourceObjects, sourceBytes, indexObjects: cache.size + plan.stage.objects.length,
        indexBytes: indexBytes + plan.stage.writeBytes, writeObjects: plan.stage.objects.length, writeBytes: plan.stage.writeBytes };
      return { ok: true, value: run((owner, now) => this.state.commitHeadStep(plan, stored, budget, authority(owner, now))) };
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ContributionRebuildResult>(resolve => {
      timer = setTimeout(() => { retired = true; resolve({ ok: false, error: "deadline" }); }, CONTRIBUTION_REBUILD_DEADLINE_MS);
    });
    try { return await Promise.race([work().catch(error => ({ ok: false as const, error: failure(error) })), timeout]); }
    finally { retired = true; clearTimeout(timer); }
  }
  /** Separately reviewed repair cutover. Accepts only an explicit `publish`
   * request; every other action is refused here, exactly as `publish` is
   * refused by `execute`. The step is one SQL transaction with no object I/O. */
  publish(input: unknown, observation: AdmissionObservation): ContributionRebuildResult {
    const request = parseContributionRebuildRequest(input);
    if (!request || request.action !== "publish") return { ok: false, error: "invalid_input" };
    try { return { ok: true, value: this.#run(request, observation, () => undefined,
      (owner, now) => this.state.publish(request.jobId, request.expectedVersion, authority(owner, now))) }; }
    catch (error) { return { ok: false, error: failure(error) }; }
  }
}
