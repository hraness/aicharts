import { contributionHash, contributionIdentity, contributionPayloadHash, ContributionFault } from "../../../lib/usage/contributions";
import { contributionIndexKey, readContributionIndexCells } from "../../../lib/usage/contribution-index";
import { ContributionCellScrubFold, CONTRIBUTION_SCRUB_DEADLINE_MS, CONTRIBUTION_SCRUB_MAX_HEADS,
  CONTRIBUTION_SCRUB_MAX_INDEX_READS, CONTRIBUTION_SCRUB_MAX_READ_BYTES, CONTRIBUTION_SCRUB_MAX_READS, CONTRIBUTION_SCRUB_MAX_SOURCE_BYTES,
  parseContributionScrubRequest, parseContributionScrubReceipt, type ContributionScrubError, type ContributionScrubResult } from "../../../lib/usage/contribution-scrub";
import { statsInteger } from "../../../lib/usage/stats-contract";
import { readContributionIndexObject } from "./contribution-index-objects";
import { readContributionBody } from "./contributions-objects";
import { readCommittedContributionRevision } from "./contribution-replay";
import type { ContributionState } from "./contributions-state";
import type { ContributionProjectionState } from "./contribution-projection-state";

/** Synchronous trusted owned-state read: check current stored account authority,
 * account/generation and clock. It does not query remote authority. The RPC
 * owner separately fences the invocation and validates the external namespace
 * before and after it, then admits the result only if that authority survives. */
export type ContributionScrubObservation = Readonly<{ accountId: string; generation: string; active: boolean; observedAtMs: number }>;
class Fault extends Error { constructor(readonly code: ContributionScrubError) { super(code); } }
const require = (condition: unknown, code: ContributionScrubError = "storage_invalid"): void => { if (!condition) throw new Fault(code); };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** One scoped read, not a repair, from-genesis SQL audit or a whole-account
 * certificate. Scope counters exclude outer authorization/namespace I/O.
 * The temporary envelope refuses legacy and larger accounts without scanning
 * a prefix and calling it complete. No table, object, quota or alarm is changed. */
export async function scrubContributionCell(bucket: R2Bucket, input: unknown, canonical: ContributionState,
  projection: ContributionProjectionState, observe: () => ContributionScrubObservation): Promise<ContributionScrubResult> {
  const request = parseContributionScrubRequest(input);
  if (!request) return { ok: false, error: "invalid_input" };
  let retired = false, lastObserved = 0;
  let finalRefresh: (() => void) | null = null;
  const started = performance.now(), deadline = started + CONTRIBUTION_SCRUB_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const live = () => {
    // Retirement precedes SQL, observe(), and every newly dispatched get.
    if (retired || performance.now() >= deadline) throw new Fault("deadline");
  };
  const readPosition = () => {
    live();
    const authority = observe();
    require(authority.active && authority.accountId === request.accountId, "unauthorized");
    require(authority.generation === request.generation, "generation_conflict");
    require(statsInteger(authority.observedAtMs, lastObserved, 8_640_000_000_000_000), "clock_regressed");
    lastObserved = authority.observedAtMs;
    const source = canonical.control(), control = projection.control();
    require(source.accountId === request.accountId && control.accountId === request.accountId, "unauthorized");
    require(source.generation === request.generation && control.generation === request.generation, "generation_conflict");
    require(source.phase === "active", "recovery_required");
    require(source.revision === request.expectedRevision, "conflict");
    require(source.legacySeal === null, "legacy_unresolved");
    require(source.headCount <= CONTRIBUTION_SCRUB_MAX_HEADS, "scope_limit");
    require(control.appliedRevision === source.revision && control.publishedRevision === source.revision
      && control.source === null && projection.pending() === null, "not_caught_up");
    const publication = projection.publication(source.revision, authority.observedAtMs);
    require(publication.expiresAtMs === null && same(publication.root, control.publishedRoot));
    return { source, root: publication.root };
  };
  const run = async (): Promise<ContributionScrubResult> => {
    const original = readPosition();
    const refresh = () => {
      const current = readPosition();
      require(current.source.headCount === original.source.headCount && same(current.root, original.root), "conflict");
    };
    finalRefresh = refresh;
    // Even an empty numeric state needs a committed SQL revision boundary.
    require(original.source.revision > 0);
    require(readCommittedContributionRevision(canonical, original.source.revision - 1)?.revision === original.source.revision);
    const ids = canonical.sql.exec("SELECT id FROM usage_contribution_heads WHERE id > ? ORDER BY id LIMIT ?", "", CONTRIBUTION_SCRUB_MAX_HEADS + 1).toArray();
    require(ids.length === original.source.headCount && ids.length <= CONTRIBUTION_SCRUB_MAX_HEADS);
    let prior = "";
    for (const item of ids) { require(contributionIdentity(item.id, 32) && item.id > prior); prior = item.id as string; }
    const fold = new ContributionCellScrubFold(request.dimensions);
    let sourceObjects = 0, indexObjects = 0, sourceBytes = 0, indexBytes = 0, liveHeads = 0, matchingHeads = 0;
    const budget = (maximum: number, kind: "source" | "index") => {
      live();
      require(sourceObjects + indexObjects < CONTRIBUTION_SCRUB_MAX_READS, "limit");
      require(sourceBytes + indexBytes + maximum <= CONTRIBUTION_SCRUB_MAX_READ_BYTES, "limit");
      if (kind === "source") {
        require(sourceObjects < CONTRIBUTION_SCRUB_MAX_HEADS && sourceBytes + maximum <= CONTRIBUTION_SCRUB_MAX_SOURCE_BYTES, "limit");
        sourceObjects++;
      } else { require(indexObjects < CONTRIBUTION_SCRUB_MAX_INDEX_READS, "limit"); indexObjects++; }
    };
    for (const item of ids) {
      refresh();
      const id = item.id as string, head = canonical.head(id); require(head !== null);
      if (!head) throw new Fault("storage_invalid");
      // Such flags/references require the sealed legacy inventory, which this
      // deliberately narrow fresh-account scrub does not certify.
      require(!head.legacySupport && !head.suppressedLegacy, "legacy_unresolved");
      if (head.deleted || head.members === 0) continue;
      const reference = head.reference; require(reference?.kind === "batch-v3");
      if (reference?.kind !== "batch-v3") throw new Fault("storage_invalid");
      liveHeads++; budget(1_048_576, "source");
      const loaded = await readContributionBody(bucket, request.accountId, reference.bodyHash);
      refresh();
      if (!loaded.ok) throw new Fault(loaded.error);
      sourceBytes += loaded.value.verified.byteLength;
      const body = loaded.value.batch, mutation = body.mutations[reference.index], operation = canonical.operation(body.operationId);
      require(body.accountId === request.accountId && body.generation === request.generation && mutation?.kind === "put" && mutation.id === id);
      if (mutation?.kind !== "put") throw new Fault("storage_invalid");
      require(contributionPayloadHash(mutation.row) === head.payloadHash && reference.payloadHash === head.payloadHash
        && head.headHash === contributionHash(`aicharts:contribution-head:v3\0${JSON.stringify([body.accountId, body.generation, body.operationId, id, head.payloadHash])}`));
      require(operation?.kind === "batch" && operation.outcome === "committed");
      if (!operation || !operation.terminal || !("outcome" in operation.terminal) || operation.terminal.outcome !== "committed") throw new Fault("storage_invalid");
      const intent = operation.intent, receipt = operation.terminal.receipt;
      require(intent.operationId === body.operationId && intent.bodyHash === reference.bodyHash && intent.byteLength === loaded.value.verified.byteLength
        && intent.accountId === body.accountId && intent.generation === body.generation && intent.deviceId === body.deviceId
        && intent.populationId === body.populationId && intent.sequence === body.sequence && intent.expectedRevision === body.expectedRevision
        && operation.publishedRevision === body.expectedRevision + 1 && operation.publishedRevision <= original.source.revision
        && receipt.populationRevision === body.expectedPopulationRevision + 1
        && receipt.populationHead === contributionHash(`aicharts:population-history:v3\0${JSON.stringify([body.expectedPopulationHead, reference.bodyHash])}`));
      if (fold.add(mutation.row)) matchingHeads++;
    }
    const expected = fold.cell();
    // The index key depends only on dimensions, including for an empty fold.
    const indexKey = `${String(request.dimensions.utcDay).padStart(8, "0")}:${JSON.stringify([request.dimensions.utcDay,
      request.dimensions.client, request.dimensions.provider, request.dimensions.model, request.dimensions.tokenBasis,
      request.dimensions.breakdownCoverage, request.dimensions.costKind, request.dimensions.timed])}`;
    if (expected) require(contributionIndexKey(expected) === indexKey);
    let guardError: ContributionScrubError | null = null;
    const found = await readContributionIndexCells({ accountId: request.accountId, generation: request.generation }, original.root, [indexKey], async reference => {
      try {
        refresh(); budget(reference.byteLength, "index");
        const text = await readContributionIndexObject(bucket, request, reference);
        refresh(); indexBytes += reference.byteLength; return text;
      } catch (cause) {
        guardError = cause instanceof Fault || cause instanceof ContributionFault ? cause.code : "storage_unavailable";
        throw cause;
      }
    });
    refresh();
    if (!found.ok) throw new Fault(guardError ?? (found.error === "capacity" ? "limit" : found.error === "storage_unavailable" ? "storage_unavailable" : "storage_invalid"));
    require(found.value.readObjects === indexObjects && found.value.readBytes === indexBytes);
    const published = found.value.cells.get(indexKey) ?? null;
    const receipt = parseContributionScrubReceipt(request, { schemaVersion: 3, profile: "canonical-cell-scrub-v3", scope: "single-cell",
      accountId: request.accountId, generation: request.generation, revision: request.expectedRevision, rootHash: original.root?.hash ?? null,
      dimensions: request.dimensions, verdict: same(expected, published) ? "match" : "mismatch", expected, published,
      checkedHeads: ids.length, liveHeads, matchingHeads, sourceObjects, indexObjects, sourceBytes, indexBytes, readBytes: sourceBytes + indexBytes });
    require(receipt !== null);
    return { ok: true, value: receipt! };
  };
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { retired = true; reject(new Fault("deadline")); }, CONTRIBUTION_SCRUB_DEADLINE_MS);
    });
    const result = await Promise.race([run(), timeout]);
    live();
    if (finalRefresh) (finalRefresh as () => void)();
    return result;
  } catch (cause) { return { ok: false, error: cause instanceof Fault || cause instanceof ContributionFault ? cause.code : "storage_unavailable" }; }
  finally { retired = true; clearTimeout(timer); }
}
