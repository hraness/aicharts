import { contributionAccount, contributionHash, contributionIdentity, ContributionFault,
  CONTRIBUTION_MAX_OPERATIONS, parseContributionDelta, type ContributionDelta } from "../../../lib/usage/contributions";
import { statsInteger, statsOwnRecord } from "../../../lib/usage/stats-contract";
import { enrollmentStorageCall } from "./namespace-anchor";

export const CONTRIBUTION_JOURNAL_PAGE_ENTRIES = 256;
export const CONTRIBUTION_JOURNAL_PAGE_BYTES = 262_144;
// A sealed legacy account may carry up to CONTRIBUTION_MAX_HEADS retained
// heads, so a migration journal can span ~1,024 pages; the root bound covers
// that descriptor list (~75KB worst case) rather than the old 33-page cap.
export const CONTRIBUTION_JOURNAL_ROOT_BYTES = 131_072;
export const CONTRIBUTION_JOURNAL_MAX_ENTRIES = 262_144;
export type ContributionJournalBinding = Readonly<{
  accountId: string; generation: string; operationId: string; bodyHash: string; previousRevision: number; revision: number;
}>;
export type ContributionJournalRoot = ContributionJournalBinding & Readonly<{
  schemaVersion: 3; kind: "contribution-deltas"; count: number; entriesHash: string;
  pages: readonly Readonly<{ hash: string; bytes: number; count: number }>[];
}>;
export type ContributionJournalPage = Readonly<{ schemaVersion: 3; kind: "contribution-delta-page";
  accountId: string; generation: string; entries: readonly ContributionDelta[] }>;
export type ContributionArtifact = Readonly<{ hash: string; text: string; bytes: number }>;
export type ContributionJournalBundle = Readonly<{ root: ContributionJournalRoot; artifact: ContributionArtifact;
  pages: Iterable<ContributionArtifact>; byteLength: number }>;
function array(value: unknown, max: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) return null; result.push(d.value as unknown);
  }
  return result;
}
export function parseContributionJournalRoot(value: unknown): ContributionJournalRoot | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "kind", "accountId", "generation", "operationId", "bodyHash", "previousRevision", "revision", "count", "entriesHash", "pages"]);
    if (raw?.schemaVersion !== 3 || raw.kind !== "contribution-deltas" || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)
      || !contributionIdentity(raw.operationId) || !contributionIdentity(raw.bodyHash) || !statsInteger(raw.previousRevision, 0, CONTRIBUTION_MAX_OPERATIONS - 1)
      || raw.revision !== raw.previousRevision + 1 || !statsInteger(raw.count, 0, CONTRIBUTION_JOURNAL_MAX_ENTRIES) || !contributionIdentity(raw.entriesHash)) return null;
    const input = array(raw.pages, Math.ceil(CONTRIBUTION_JOURNAL_MAX_ENTRIES / CONTRIBUTION_JOURNAL_PAGE_ENTRIES));
    if (!input) return null;
    const pages: { hash: string; bytes: number; count: number }[] = [];
    for (const item of input) {
      const page = statsOwnRecord(item, ["hash", "bytes", "count"]);
      if (!page || !contributionIdentity(page.hash) || !statsInteger(page.bytes, 1, CONTRIBUTION_JOURNAL_PAGE_BYTES)
        || !statsInteger(page.count, 1, CONTRIBUTION_JOURNAL_PAGE_ENTRIES)) return null;
      pages.push({ hash: page.hash, bytes: page.bytes, count: page.count });
    }
    if (pages.reduce((sum, page) => sum + page.count, 0) !== raw.count || pages.some((page, i) => i + 1 < pages.length && page.count !== CONTRIBUTION_JOURNAL_PAGE_ENTRIES)) return null;
    return Object.freeze({ schemaVersion: 3, kind: "contribution-deltas", accountId: raw.accountId, generation: raw.generation,
      operationId: raw.operationId, bodyHash: raw.bodyHash, previousRevision: raw.previousRevision, revision: raw.revision,
      count: raw.count, entriesHash: raw.entriesHash, pages: Object.freeze(pages.map(page => Object.freeze(page))) });
  } catch { return null; }
}
export function parseContributionJournalPage(value: unknown): ContributionJournalPage | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "kind", "accountId", "generation", "entries"]);
    if (raw?.schemaVersion !== 3 || raw.kind !== "contribution-delta-page" || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)) return null;
    const input = array(raw.entries, CONTRIBUTION_JOURNAL_PAGE_ENTRIES); if (!input || !input.length) return null;
    const entries: ContributionDelta[] = [];
    for (const item of input) {
      const entry = parseContributionDelta(item);
      if (!entry || (entries.length && entries[entries.length - 1].id >= entry.id)) return null;
      entries.push(entry);
    }
    return Object.freeze({ schemaVersion: 3, kind: "contribution-delta-page", accountId: raw.accountId, generation: raw.generation, entries: Object.freeze(entries) });
  } catch { return null; }
}
export function contributionArtifact(value: unknown, max = CONTRIBUTION_JOURNAL_PAGE_BYTES): ContributionArtifact {
  const text = JSON.stringify(value), bytes = new TextEncoder().encode(text).length;
  if (bytes < 1 || bytes > max) throw new ContributionFault("limit");
  return Object.freeze({ text, hash: contributionHash(text), bytes });
}
export function contributionDeltaBundle(binding: ContributionJournalBinding, input: readonly ContributionDelta[]): ContributionJournalBundle {
  if (input.length > CONTRIBUTION_JOURNAL_MAX_ENTRIES) throw new ContributionFault("invalid_input");
  const entries = input.map(value => {
    const parsed = parseContributionDelta(value); if (!parsed) throw new ContributionFault("invalid_input"); return parsed;
  }).sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1);
  if (entries.some((entry, i) => i > 0 && entry.id === entries[i - 1].id)) throw new ContributionFault("invalid_input");
  const pages: ContributionArtifact[] = [], descriptors: { hash: string; bytes: number; count: number }[] = [];
  for (let index = 0; index < entries.length; index += CONTRIBUTION_JOURNAL_PAGE_ENTRIES) {
    const selected = entries.slice(index, index + CONTRIBUTION_JOURNAL_PAGE_ENTRIES);
    const page = contributionArtifact({ schemaVersion: 3, kind: "contribution-delta-page", accountId: binding.accountId, generation: binding.generation, entries: selected });
    pages.push(page); descriptors.push({ hash: page.hash, bytes: page.bytes, count: selected.length });
  }
  const root = parseContributionJournalRoot({ schemaVersion: 3, kind: "contribution-deltas", ...binding, count: entries.length,
    entriesHash: contributionHash(JSON.stringify(entries)), pages: descriptors });
  if (!root) throw new ContributionFault("invalid_input");
  const artifact = contributionArtifact(root, CONTRIBUTION_JOURNAL_ROOT_BYTES);
  return Object.freeze({ root, artifact, pages: Object.freeze(pages), byteLength: artifact.bytes + pages.reduce((sum, page) => sum + page.bytes, 0) });
}
export function contributionArtifactKey(accountId: string, hash: string): string {
  if (!contributionAccount(accountId) || !contributionIdentity(hash)) throw new ContributionFault("invalid_input");
  return `usage-contributions/v3/${accountId}/artifacts/${hash}.json`;
}
const MEDIA = "application/vnd.aicharts.contribution-artifact-v3+json";
const verified = new WeakSet<object>();
export type VerifiedContributionJournal = Readonly<{ accountId: string; hash: string; count: number; byteLength: number }>;
export const isVerifiedContributionJournal = (value: VerifiedContributionJournal): boolean => verified.has(value);
/** Exact immutable artifact read with one nonrenewable whole-stream deadline. */
export async function readContributionArtifact(bucket: R2Bucket, accountId: string, hash: string,
  max = CONTRIBUTION_JOURNAL_PAGE_BYTES): Promise<string> {
  const object = await enrollmentStorageCall(bucket.get(contributionArtifactKey(accountId, hash)), value => { if (value) void value.body.cancel().catch(() => undefined); });
  if (!object) throw new ContributionFault("storage_invalid");
  if (!statsInteger(object.size, 1, max) || object.httpMetadata?.contentType !== MEDIA || object.httpMetadata.contentEncoding !== undefined
    || object.customMetadata?.schemaVersion !== "3" || Object.keys(object.customMetadata).length !== 1 || object.checksums.sha256 === undefined) {
    void object.body.cancel().catch(() => undefined); throw new ContributionFault("storage_invalid");
  }
  const reader = object.body.getReader(), bytes = new Uint8Array(object.size); let offset = 0, complete = false;
  try {
    await enrollmentStorageCall((async () => {
      for (;;) {
        const item = await reader.read();
        if (item.done) { complete = true; if (offset !== bytes.length) throw new ContributionFault("storage_invalid"); return; }
        if (!(item.value instanceof Uint8Array) || !item.value.length || item.value.length > bytes.length - offset) throw new ContributionFault("storage_invalid");
        bytes.set(item.value, offset); offset += item.value.length;
      }
    })());
  } finally { if (!complete) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const checksum = [...new Uint8Array(object.checksums.sha256)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (contributionHash(bytes) !== hash || checksum !== hash) throw new ContributionFault("storage_invalid");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
/** The owner reserved every possible byte before invoking this function. */
export async function ensureContributionArtifact(bucket: R2Bucket, accountId: string, artifact: ContributionArtifact, admitted: () => boolean): Promise<void> {
  if (artifact.bytes !== new TextEncoder().encode(artifact.text).length || artifact.bytes < 1 || artifact.bytes > CONTRIBUTION_JOURNAL_PAGE_BYTES
    || contributionHash(artifact.text) !== artifact.hash) throw new ContributionFault("invalid_input");
  if (!admitted()) throw new ContributionFault("recovery_required");
  const key = contributionArtifactKey(accountId, artifact.hash);
  // Conditional immutable writes may leave an exactly charged orphan after a
  // timeout; no SQL continuation is attached to the provider promise itself.
  const existing = await enrollmentStorageCall(bucket.head(key));
  if (!admitted()) throw new ContributionFault("recovery_required");
  if (existing === null) await enrollmentStorageCall(bucket.put(key, artifact.text, { onlyIf: new Headers({ "if-none-match": "*" }),
      sha256: Uint8Array.from(artifact.hash.match(/../gu)!.map(byte => Number.parseInt(byte, 16))).buffer,
      httpMetadata: { contentType: MEDIA }, customMetadata: { schemaVersion: "3" } }));
  if (!admitted()) throw new ContributionFault("recovery_required");
  if (await readContributionArtifact(bucket, accountId, artifact.hash) !== artifact.text) throw new ContributionFault("storage_invalid");
  if (!admitted()) throw new ContributionFault("recovery_required");
}
export async function ensureContributionJournal(bucket: R2Bucket, bundle: ContributionJournalBundle, admitted: () => boolean): Promise<VerifiedContributionJournal> {
  // A capability means every exact referenced page exists, not merely that a
  // caller supplied a root hash. Verify the envelope before any provider I/O;
  // entries stream through their parsed form so large journals stay bounded.
  const root = parseContributionJournalRoot(bundle.root);
  if (!root) throw new ContributionFault("invalid_input");
  const entryParts: string[] = []; let index = 0, previous = "";
  for (const artifact of bundle.pages) {
    const descriptor = root.pages[index]; let page: ContributionJournalPage | null;
    try { page = parseContributionJournalPage(JSON.parse(artifact.text) as unknown); } catch { page = null; }
    if (!page || page.accountId !== root.accountId || page.generation !== root.generation || JSON.stringify(page) !== artifact.text
      || !descriptor || descriptor.hash !== artifact.hash || descriptor.bytes !== artifact.bytes || descriptor.count !== page.entries.length)
      throw new ContributionFault("invalid_input");
    for (const entry of page.entries) {
      const parsed = parseContributionDelta(entry);
      if (!parsed || (entryParts.length !== 0 && parsed.id <= previous)) throw new ContributionFault("invalid_input");
      previous = parsed.id; entryParts.push(JSON.stringify(parsed));
    }
    index += 1;
  }
  if (index !== root.pages.length || entryParts.length !== root.count
    || contributionHash(`[${entryParts.join(",")}]`) !== root.entriesHash) throw new ContributionFault("invalid_input");
  const artifact = contributionArtifact(root, CONTRIBUTION_JOURNAL_ROOT_BYTES);
  if (artifact.text !== bundle.artifact.text || artifact.hash !== bundle.artifact.hash || artifact.bytes !== bundle.artifact.bytes
    || artifact.bytes + root.pages.reduce((sum, page) => sum + page.bytes, 0) !== bundle.byteLength)
    throw new ContributionFault("invalid_input");
  for (const page of bundle.pages) await ensureContributionArtifact(bucket, bundle.root.accountId, page, admitted);
  await ensureContributionArtifact(bucket, bundle.root.accountId, bundle.artifact, admitted);
  return sealVerifiedContributionJournal(bundle);
}
/** Seal a journal whose every artifact was already stored exactly — the
 * staged migration uploads each page under its own durable ensure cursor, so
 * the final seal only re-verifies the bundle's internal consistency. */
export function sealVerifiedContributionJournal(bundle: ContributionJournalBundle): VerifiedContributionJournal {
  const root = parseContributionJournalRoot(bundle.root);
  if (!root) throw new ContributionFault("invalid_input");
  const artifact = contributionArtifact(root, CONTRIBUTION_JOURNAL_ROOT_BYTES);
  if (artifact.text !== bundle.artifact.text || artifact.hash !== bundle.artifact.hash || artifact.bytes !== bundle.artifact.bytes
    || artifact.bytes + root.pages.reduce((sum, page) => sum + page.bytes, 0) !== bundle.byteLength)
    throw new ContributionFault("invalid_input");
  const result = Object.freeze({ accountId: root.accountId, hash: bundle.artifact.hash, count: root.count, byteLength: bundle.byteLength });
  verified.add(result); return result;
}
export async function readContributionJournalRoot(bucket: R2Bucket, accountId: string, hash: string): Promise<ContributionJournalRoot> {
  const text = await readContributionArtifact(bucket, accountId, hash, CONTRIBUTION_JOURNAL_ROOT_BYTES);
  let root: ContributionJournalRoot | null;
  try { root = parseContributionJournalRoot(JSON.parse(text) as unknown); } catch { root = null; }
  if (!root || root.accountId !== accountId || JSON.stringify(root) !== text) throw new ContributionFault("storage_invalid"); return root;
}
export async function readContributionJournalPage(bucket: R2Bucket, root: ContributionJournalRoot, index: number): Promise<ContributionJournalPage> {
  const parsed = parseContributionJournalRoot(root);
  if (!parsed || !statsInteger(index, 0, parsed.pages.length - 1)) throw new ContributionFault("invalid_input");
  const descriptor = parsed.pages[index], text = await readContributionArtifact(bucket, parsed.accountId, descriptor.hash);
  let page: ContributionJournalPage | null;
  try { page = parseContributionJournalPage(JSON.parse(text) as unknown); } catch { page = null; }
  if (!page || page.accountId !== parsed.accountId || page.generation !== parsed.generation || page.entries.length !== descriptor.count
    || new TextEncoder().encode(text).length !== descriptor.bytes || JSON.stringify(page) !== text) throw new ContributionFault("storage_invalid"); return page;
}
