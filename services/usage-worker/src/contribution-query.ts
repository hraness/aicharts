import { ContributionFault, CONTRIBUTION_MAX_OPERATIONS } from "../../../lib/usage/contributions";
import { parseContributionIndexReference, readContributionIndexPage, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { parseContributionQuery, parseContributionQueryPage, type ContributionQuery, type ContributionQueryError,
  type ContributionQueryResult } from "../../../lib/usage/contribution-query";
import { statsInteger } from "../../../lib/usage/stats-contract";
import { readContributionIndexObject } from "./contribution-index-objects";

export class ContributionQueryFault extends Error { constructor(readonly code: ContributionQueryError) { super(code); } }
/** Supplied by the account's read-only fenced transaction. Null selects the
 * current publication; a revision selects a retained committed publication.
 * This callback must recheck authority, time and reference expiry each time. */
export type ContributionQuerySnapshot = Readonly<{
  accountId: string; generation: string; sourceRevision: number; latestAppliedRevision: number; latestPublishedRevision: number;
  revision: number; root: ContributionIndexReference | null; unresolvedLegacyBodies: number; observedAtMs: number;
}>;
type Snapshot = (revision: number | null) => ContributionQuerySnapshot;
function failure(cause: unknown): ContributionQueryError {
  return cause instanceof ContributionFault || cause instanceof ContributionQueryFault ? cause.code : "storage_unavailable";
}
/** Reads only an explicitly authorized immutable publication. The query never
 * initializes, rebuilds, expires, prunes, repairs or publishes persistent state. */
export async function queryContributionPage(bucket: R2Bucket, input: ContributionQuery, snapshot: Snapshot): Promise<ContributionQueryResult> {
  try {
    const query = parseContributionQuery(input);
    if (!query) return { ok: false, error: "invalid_input" };
    let current = snapshot(query.cursor?.revision ?? null);
    const original = current, pinned = current.revision, root = current.root;
    const owner = { accountId: current.accountId, generation: current.generation };
    const admitted = (value: ContributionQuerySnapshot): void => {
      if (value.accountId !== query.accountId || value.accountId !== original.accountId || value.generation !== original.generation
        || !statsInteger(value.sourceRevision, 0, CONTRIBUTION_MAX_OPERATIONS)
        || !statsInteger(value.latestAppliedRevision, 0, value.sourceRevision)
        || !statsInteger(value.latestPublishedRevision, 0, value.latestAppliedRevision) || !statsInteger(value.revision, 0, value.latestPublishedRevision)
        || value.revision !== pinned || value.sourceRevision < current.sourceRevision || value.latestPublishedRevision < current.latestPublishedRevision
        || value.latestAppliedRevision < current.latestAppliedRevision
        || !statsInteger(value.observedAtMs, current.observedAtMs, query.sessionExpiresAtMs - 1)
        || value.unresolvedLegacyBodies !== original.unresolvedLegacyBodies || !statsInteger(value.unresolvedLegacyBodies, 0, 65_536)
        || (value.root !== null && !parseContributionIndexReference(value.root))
        || JSON.stringify(value.root) !== JSON.stringify(root) || (pinned === 0 && root !== null)) throw new ContributionQueryFault("recovery_required");
      current = value;
    };
    admitted(current);
    if (query.cursor && (query.cursor.generation !== owner.generation || query.cursor.revision !== pinned
      || query.cursor.rootHash !== root?.hash)) return { ok: false, error: "snapshot_expired" };
    if (!query.cursor && pinned !== current.latestPublishedRevision) throw new ContributionQueryFault("storage_invalid");
    const refresh = () => admitted(snapshot(pinned));
    let guardFailure: ContributionQueryError | null = null;
    const page = await readContributionIndexPage(owner, root, { firstUtcDay: query.firstUtcDay, dayCount: query.dayCount, limit: query.limit,
      cursor: query.cursor ? { rootHash: query.cursor.rootHash, firstUtcDay: query.firstUtcDay, dayCount: query.dayCount, afterKey: query.cursor.afterKey } : null },
    async reference => {
      try {
        refresh();
        const text = await readContributionIndexObject(bucket, owner, reference);
        refresh(); return text;
      } catch (cause) { guardFailure = failure(cause); throw cause; }
    });
    if (!page.ok) return { ok: false, error: guardFailure ?? (page.error === "invalid_input" ? "invalid_input"
      : page.error === "capacity" ? "limit" : page.error === "storage_unavailable" ? "storage_unavailable" : "storage_invalid") };
    refresh();
    const result = parseContributionQueryPage(query, { schemaVersion: 3, profile: "contribution-cells-v3", coverage: "observed-only",
      accountId: owner.accountId, generation: owner.generation, observedAtMs: current.observedAtMs,
      sourceRevision: current.sourceRevision, latestAppliedRevision: current.latestAppliedRevision, latestPublishedRevision: current.latestPublishedRevision,
      appliedLag: current.sourceRevision - current.latestAppliedRevision, publishedLag: current.sourceRevision - current.latestPublishedRevision, snapshotRevision: pinned,
      snapshotLag: current.sourceRevision - pinned, rootHash: root?.hash ?? null, unresolvedLegacyBodies: current.unresolvedLegacyBodies,
      firstUtcDay: query.firstUtcDay, dayCount: query.dayCount, cells: page.value.cells,
      next: page.value.next ? { schemaVersion: 3, accountId: owner.accountId, generation: owner.generation, revision: pinned,
        rootHash: page.value.next.rootHash, firstUtcDay: query.firstUtcDay, dayCount: query.dayCount, limit: query.limit,
        afterKey: page.value.next.afterKey } : null });
    return result ? { ok: true, value: result } : { ok: false, error: "storage_invalid" };
  } catch (cause) { return { ok: false, error: failure(cause) }; }
}
