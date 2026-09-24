import { contributionAccount, contributionHash, contributionIdentity, ContributionFault } from "../../../lib/usage/contributions";
import { contributionIndexStageHash, isOwnedContributionIndexStage, parseContributionIndexReference,
  type ContributionIndexContext, type ContributionIndexReference, type ContributionIndexStage } from "../../../lib/usage/contribution-index";
import { enrollmentStorageCall } from "./namespace-anchor";

const MEDIA = "application/vnd.aicharts.contribution-index-v3+json";
const verified = new WeakSet<object>();
export type VerifiedContributionIndex = Readonly<{
  accountId: string; generation: string; root: ContributionIndexReference | null; writeBytes: number; stageHash: string;
}>;
export const isVerifiedContributionIndex = (value: VerifiedContributionIndex): boolean => verified.has(value);
export function contributionIndexObjectKey(owner: ContributionIndexContext, hash: string): string {
  if (!contributionAccount(owner.accountId) || !contributionIdentity(owner.generation) || !contributionIdentity(hash))
    throw new ContributionFault("invalid_input");
  return `usage-projections/v3/${owner.accountId}/${owner.generation}/nodes/${hash}.json`;
}
const discard = (body: ReadableStream<Uint8Array>) => { void body.cancel().catch(() => undefined); };
/** A read owns one bounded response and whole-stream deadline. It performs no
 * writes, lookup repairs, initialization or backfill. Hash/edge/context parsing
 * is repeated by the index core before any cell is admitted. */
export async function readContributionIndexObject(bucket: R2Bucket, owner: ContributionIndexContext,
  reference: ContributionIndexReference): Promise<string> {
  const ref = parseContributionIndexReference(reference);
  if (!ref) throw new ContributionFault("invalid_input");
  const object = await enrollmentStorageCall(bucket.get(contributionIndexObjectKey(owner, ref.hash)), value => { if (value) discard(value.body); });
  if (object === null) throw new ContributionFault("storage_invalid");
  const forbidden = ["contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"];
  const http = object.httpMetadata, custom = object.customMetadata, checksum = object.checksums.sha256;
  if (object.size !== ref.byteLength || !http || http.contentType !== MEDIA || checksum === undefined
    || forbidden.some(name => (http as Record<string, unknown>)[name] !== undefined)
    || Object.keys(http).some(name => name !== "contentType" && !forbidden.includes(name))
    || !custom || custom.schemaVersion !== "3" || Object.keys(custom).length !== 1) {
    discard(object.body); throw new ContributionFault("storage_invalid");
  }
  const reader = object.body.getReader(), bytes = new Uint8Array(ref.byteLength); let offset = 0, complete = false;
  try {
    await enrollmentStorageCall((async () => {
      for (;;) {
        const item = await reader.read();
        if (item.done) { complete = true; if (offset !== bytes.length) throw new ContributionFault("storage_invalid"); return; }
        if (!(item.value instanceof Uint8Array) || !item.value.length || item.value.length > bytes.length - offset)
          throw new ContributionFault("storage_invalid");
        bytes.set(item.value, offset); offset += item.value.length;
      }
    })());
  } finally { if (!complete) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const hash = [...new Uint8Array(checksum)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (contributionHash(bytes) !== ref.hash || hash !== ref.hash) throw new ContributionFault("storage_invalid");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

/** The mutation owner durably reserves stage.writeBytes before this call and
 * keeps its execution registration through every provider continuation. A
 * timeout can leave a charged immutable orphan, never an untracked publication. */
export async function ensureContributionIndexStage(bucket: R2Bucket, owner: ContributionIndexContext,
  stage: ContributionIndexStage, admitted: () => boolean): Promise<VerifiedContributionIndex> {
  if (!isOwnedContributionIndexStage(stage) || stage.accountId !== owner.accountId || stage.generation !== owner.generation)
    throw new ContributionFault("invalid_input");
  const stageHash = contributionIndexStageHash(stage);
  if (stageHash === null) throw new ContributionFault("invalid_input");
  const guard = () => { if (!admitted()) throw new ContributionFault("recovery_required"); };
  guard();
  for (const object of stage.objects) {
    // Bind the pure plan's owner again before any external write.
    const parsed = JSON.parse(object.text) as { accountId?: unknown; generation?: unknown };
    if (parsed.accountId !== owner.accountId || parsed.generation !== owner.generation) throw new ContributionFault("invalid_input");
  }
  for (const object of stage.objects) {
    guard();
    await enrollmentStorageCall(bucket.put(contributionIndexObjectKey(owner, object.reference.hash), object.text, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      sha256: Uint8Array.from(object.reference.hash.match(/../gu)!.map(value => Number.parseInt(value, 16))).buffer,
      httpMetadata: { contentType: MEDIA }, customMetadata: { schemaVersion: "3" },
    }));
    guard();
    if (await readContributionIndexObject(bucket, owner, object.reference) !== object.text) throw new ContributionFault("storage_invalid");
    guard();
  }
  const result = Object.freeze({ ...owner, root: stage.root, writeBytes: stage.writeBytes, stageHash }); verified.add(result); return result;
}
