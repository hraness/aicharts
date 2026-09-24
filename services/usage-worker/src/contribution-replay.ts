import { createHash } from "node:crypto";
import { contributionHash, contributionIdentity, contributionPayloadHash, ContributionFault, CONTRIBUTION_MAX_BYTES,
  type ContributionDelta, type ContributionReference } from "../../../lib/usage/contributions";
import type { ResolvedContributionDelta } from "../../../lib/usage/contribution-rollups";
import { statsInteger, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { readContributionBody, resolveContributionReference } from "./contributions-objects";
import { CONTRIBUTION_JOURNAL_MAX_ENTRIES, CONTRIBUTION_JOURNAL_PAGE_ENTRIES, readContributionJournalPage, readContributionJournalRoot,
  type ContributionJournalRoot } from "./contributions-journal";
import type { ContributionState } from "./contributions-state";

export const CONTRIBUTION_REPLAY_CHUNK_ENTRIES = 32;
export const CONTRIBUTION_REPLAY_MAX_SOURCE_BYTES = 33_554_432;
export type CommittedContributionRevision = Readonly<{
  accountId: string; generation: string; revision: number; operationId: string; bodyHash: string;
  deltaManifestHash: string | null; deltaCount: number;
}>;
export type VerifiedContributionRevision = Readonly<{ source: CommittedContributionRevision; root: ContributionJournalRoot | null }>;
export type ContributionReplayPhase = "retract" | "add";
export type VerifiedContributionChunk = Readonly<{
  source: CommittedContributionRevision; phase: ContributionReplayPhase; cursor: number; consumed: number;
  entriesHash: string; values: readonly ResolvedContributionDelta[];
}>;
const sources = new WeakSet<object>(), verified = new WeakSet<object>(), chunks = new WeakSet<object>();
export const isVerifiedContributionRevision = (value: VerifiedContributionRevision): boolean => verified.has(value);
export const isVerifiedContributionChunk = (value: VerifiedContributionChunk): boolean => chunks.has(value);
const invariant = (value: unknown): void => { if (!value) throw new ContributionFault("storage_invalid"); };
const admittedNow = (admitted: () => boolean) => { if (!admitted()) throw new ContributionFault("recovery_required"); };

/** The source is a committed SQL terminal, never a discovered content object.
 * Every grant, activation and abandonment is an explicit empty numeric step. */
export function readCommittedContributionRevision(state: Pick<ContributionState, "control" | "journal">,
  afterRevision: number): CommittedContributionRevision | null {
  const control = state.control();
  if (control.phase !== "active" || !statsInteger(afterRevision, 0, control.revision)) throw new ContributionFault("recovery_required");
  const rows = state.journal(afterRevision, 1);
  if (afterRevision === control.revision) { invariant(rows.length === 0); return null; }
  invariant(rows.length === 1);
  const row = rows[0];
  invariant(row.publishedRevision === afterRevision + 1 && row.intent.accountId === control.accountId && row.intent.generation === control.generation);
  const numeric = (row.kind === "batch" && row.outcome === "committed") || (row.kind === "migration" && row.outcome === "migrated");
  const empty = (row.kind === "grant" && row.outcome === "granted") || (row.kind === "activation" && row.outcome === "activated")
    || ((row.kind === "batch" || row.kind === "migration") && row.outcome === "abandoned");
  invariant(numeric || empty);
  if (numeric) invariant(contributionIdentity(row.deltaHash) && statsInteger(row.deltaCount, 0, CONTRIBUTION_JOURNAL_MAX_ENTRIES));
  else invariant(row.deltaHash === null && row.deltaCount === null);
  const source = Object.freeze({ accountId: control.accountId, generation: control.generation, revision: afterRevision + 1,
    operationId: row.intent.operationId, bodyHash: row.intent.bodyHash, deltaManifestHash: row.deltaHash, deltaCount: row.deltaCount ?? 0 });
  sources.add(source); return source;
}

/** Qualify the complete immutable delta inventory once before starting a job.
 * A restarted job repeats this bounded proof. Subsequent chunks still verify
 * their exact page bytes; no stored boolean substitutes for content identity. */
export async function verifyContributionRevision(bucket: R2Bucket, source: CommittedContributionRevision,
  admitted: () => boolean): Promise<VerifiedContributionRevision> {
  if (!sources.has(source)) throw new ContributionFault("invalid_input");
  admittedNow(admitted);
  let root: ContributionJournalRoot | null = null;
  if (source.deltaManifestHash !== null) {
    root = await readContributionJournalRoot(bucket, source.accountId, source.deltaManifestHash); admittedNow(admitted);
    invariant(root.accountId === source.accountId && root.generation === source.generation && root.revision === source.revision
      && root.previousRevision === source.revision - 1 && root.operationId === source.operationId && root.bodyHash === source.bodyHash
      && root.count === source.deltaCount);
    const digest = createHash("sha256").update("["); let previous = "", count = 0;
    for (let index = 0; index < root.pages.length; index++) {
      const page = await readContributionJournalPage(bucket, root, index); admittedNow(admitted);
      for (const entry of page.entries) {
        invariant(entry.id > previous);
        for (const ref of [entry.before, entry.after]) if (ref?.kind === "admission-v1") invariant(ref.generation === source.generation);
        digest.update(`${count ? "," : ""}${JSON.stringify(entry)}`); previous = entry.id; count++;
      }
    }
    invariant(count === root.count && digest.update("]").digest("hex") === root.entriesHash);
  } else invariant(source.deltaCount === 0);
  const result = Object.freeze({ source, root }); verified.add(result); return result;
}

/** A job retracts every predecessor before adding any successor, keeping a
 * partially rebuilt root private until its complete canonical revision is
 * published. Each chunk consumes at most 32 identities and one reference page. */
export async function loadContributionRevisionChunk(bucket: R2Bucket, proof: VerifiedContributionRevision,
  phase: ContributionReplayPhase, cursor: number, admitted: () => boolean): Promise<VerifiedContributionChunk> {
  if (!verified.has(proof) || (phase !== "retract" && phase !== "add") || proof.root === null
    || !statsInteger(cursor, 0, proof.source.deltaCount - 1) || cursor % CONTRIBUTION_REPLAY_CHUNK_ENTRIES !== 0)
    throw new ContributionFault("invalid_input");
  admittedNow(admitted);
  const pageIndex = Math.floor(cursor / CONTRIBUTION_JOURNAL_PAGE_ENTRIES), offset = cursor % CONTRIBUTION_JOURNAL_PAGE_ENTRIES;
  const page = await readContributionJournalPage(bucket, proof.root, pageIndex); admittedNow(admitted);
  const consumed = Math.min(CONTRIBUTION_REPLAY_CHUNK_ENTRIES, proof.source.deltaCount - cursor);
  const entries = page.entries.slice(offset, offset + consumed); invariant(entries.length === consumed);
  const cache = new Map<string, Awaited<ReturnType<typeof readContributionBody>>>();
  const values: ResolvedContributionDelta[] = [];
  let possibleSourceBytes = 0;
  const resolve = async (id: string, ref: ContributionReference): Promise<UsageStatsRow> => {
    // Each distinct input consumes its maximum before object I/O. There are
    // at most 32 such reads, each no larger than the canonical body bound.
    if (ref.kind === "batch-v3") {
      let body = cache.get(ref.bodyHash);
      if (!body) {
        possibleSourceBytes += CONTRIBUTION_MAX_BYTES;
        if (possibleSourceBytes > CONTRIBUTION_REPLAY_MAX_SOURCE_BYTES) throw new ContributionFault("limit");
        body = await readContributionBody(bucket, proof.source.accountId, ref.bodyHash); admittedNow(admitted); cache.set(ref.bodyHash, body);
      }
      if (!body.ok) throw new ContributionFault(body.error);
      const mutation = body.value.batch.mutations[ref.index];
      invariant(body.value.batch.generation === proof.source.generation && mutation?.kind === "put" && mutation.id === id);
      if (!mutation || mutation.kind !== "put" || contributionPayloadHash(mutation.row) !== ref.payloadHash) throw new ContributionFault("storage_invalid");
      return mutation.row;
    }
    invariant(ref.generation === proof.source.generation);
    possibleSourceBytes += CONTRIBUTION_MAX_BYTES;
    if (possibleSourceBytes > CONTRIBUTION_REPLAY_MAX_SOURCE_BYTES) throw new ContributionFault("limit");
    const resolved = await resolveContributionReference(bucket, proof.source.accountId, id, ref); admittedNow(admitted);
    if (!resolved.ok) throw new ContributionFault(resolved.error); return resolved.value;
  };
  for (const entry of entries) {
    const ref = phase === "retract" ? entry.before : entry.after;
    if (ref === null) continue;
    const row = await resolve(entry.id, ref);
    values.push(Object.freeze({ id: entry.id, before: phase === "retract" ? row : null, after: phase === "add" ? row : null }));
  }
  admittedNow(admitted);
  const result = Object.freeze({ source: proof.source, phase, cursor, consumed,
    entriesHash: contributionHash(JSON.stringify(entries as readonly ContributionDelta[])), values: Object.freeze(values) });
  chunks.add(result); return result;
}
