import { contributionAccount, contributionHash, contributionIdentity } from "./contributions";
import { contributionCellKey, MAX_CONTRIBUTION_ROLLUP_CELLS, parseContributionCell,
  type ContributionCell, type ContributionCellChange } from "./contribution-rollups";
import { statsInteger, statsOwnRecord, STATS_MAX_DAY, STATS_MAX_DAYS } from "./stats-contract";
import { contributionIndexKey, CONTRIBUTION_INDEX_MAX_KEY_BYTES, CONTRIBUTION_INDEX_MAX_PAGE_CELLS } from "./contribution-index-contract";
export { contributionIndexKey, CONTRIBUTION_INDEX_MAX_KEY_BYTES, CONTRIBUTION_INDEX_MAX_PAGE_CELLS } from "./contribution-index-contract";

export const CONTRIBUTION_INDEX_LEAF_CELLS = 128;
export const CONTRIBUTION_INDEX_BRANCH_CHILDREN = 64;
export const CONTRIBUTION_INDEX_MAX_LEVEL = 6;
export const CONTRIBUTION_INDEX_MAX_NODE_BYTES = 262_144;
export const CONTRIBUTION_INDEX_MAX_CHANGES = 64;
export const CONTRIBUTION_INDEX_MAX_READS = 512;
export const CONTRIBUTION_INDEX_MAX_WRITES = 512;
export const CONTRIBUTION_INDEX_MAX_IO_BYTES = 33_554_432;
// A sparse maximum-height tree needs at most (16 + 2) * 7 checked nodes:
// the cursor path, sixteen returned cells and one lookahead cell. Even at the
// per-node byte ceiling this remains below the shared 32 MiB read budget.
export const CONTRIBUTION_INDEX_SCAN_PAGE_CELLS = 16;

export type ContributionIndexContext = Readonly<{ accountId: string; generation: string }>;
export type ContributionIndexReference = Readonly<{
  hash: string; level: number; first: string; last: string; cells: number; byteLength: number;
}>;
type Leaf = ContributionIndexContext & Readonly<{ schemaVersion: 3; kind: "leaf"; cells: readonly ContributionCell[] }>;
type Branch = ContributionIndexContext & Readonly<{
  schemaVersion: 3; kind: "branch"; level: number; children: readonly ContributionIndexReference[];
}>;
type Node = Leaf | Branch;
export type ContributionIndexObject = Readonly<{ reference: ContributionIndexReference; text: string }>;
export type ContributionIndexStage = ContributionIndexContext & Readonly<{
  root: ContributionIndexReference | null; objects: readonly ContributionIndexObject[];
  readObjects: number; readBytes: number; writeBytes: number;
}>;
export type ContributionIndexCursor = Readonly<{
  rootHash: string; firstUtcDay: number; dayCount: number; afterKey: string;
}>;
export type ContributionIndexPage = Readonly<{
  cells: readonly ContributionCell[]; next: ContributionIndexCursor | null; readObjects: number; readBytes: number;
}>;
export type ContributionIndexScanCursor = Readonly<{
  rootHash: string; afterKey: string; scannedCells: number;
}>;
export type ContributionIndexScanPage = Readonly<{
  cells: readonly ContributionCell[]; next: ContributionIndexScanCursor | null;
  scannedCells: number; readObjects: number; readBytes: number;
}>;
export type ContributionIndexError = "invalid_input" | "invalid_projection" | "conflict" | "capacity" | "storage_unavailable";
type Result<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ContributionIndexError }>;
const ownedStages = new WeakSet<object>();
/** A storage writer accepts only an immutable plan produced by this core. */
export const isOwnedContributionIndexStage = (value: ContributionIndexStage): boolean => ownedStages.has(value);
/** Bind a durable reservation to every emitted object, even when a retry's
 * read counters differ. Copied or caller-assembled plans have no authority. */
export function contributionIndexStageHash(stage: ContributionIndexStage): string | null {
  if (!ownedStages.has(stage)) return null;
  return contributionHash(`aicharts:contribution-index-stage:v3\0${JSON.stringify({ accountId: stage.accountId,
    generation: stage.generation, root: stage.root, objects: stage.objects.map(object => object.reference), writeBytes: stage.writeBytes })}`);
}
/** The storage adapter must bound the body before materializing it and own the
 * read deadline. This core checks exact bytes, context and every traversed edge. */
export type ContributionIndexLoader = (reference: ContributionIndexReference) => Promise<string | null>;
class Fault extends Error { constructor(readonly code: ContributionIndexError) { super(code); } }
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).byteLength;
const level = (node: Node) => node.kind === "leaf" ? 0 : node.level;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function array(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || !statsInteger(length.value, 0, maximum)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length.value + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < length.value; index++) {
    const item = descriptors[String(index)];
    if (!item || !("value" in item) || !item.enumerable) return null;
    result.push(item.value as unknown);
  }
  return result;
}
function context(value: unknown): ContributionIndexContext {
  const raw = statsOwnRecord(value, ["accountId", "generation"]);
  if (!raw || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)) throw new Fault("invalid_input");
  return Object.freeze({ accountId: raw.accountId, generation: raw.generation });
}
function key(value: unknown): value is string {
  return typeof value === "string" && value.length <= CONTRIBUTION_INDEX_MAX_KEY_BYTES
    && /^[0-9]{8}:\[/u.test(value) && bytes(value) <= CONTRIBUTION_INDEX_MAX_KEY_BYTES;
}
export function parseContributionIndexReference(value: unknown): ContributionIndexReference | null {
  try {
    const raw = statsOwnRecord(value, ["hash", "level", "first", "last", "cells", "byteLength"]);
    return raw && contributionIdentity(raw.hash) && statsInteger(raw.level, 0, CONTRIBUTION_INDEX_MAX_LEVEL)
      && key(raw.first) && key(raw.last) && raw.first <= raw.last
      && statsInteger(raw.cells, 1, MAX_CONTRIBUTION_ROLLUP_CELLS)
      && statsInteger(raw.byteLength, 1, CONTRIBUTION_INDEX_MAX_NODE_BYTES)
      ? Object.freeze({ hash: raw.hash, level: raw.level, first: raw.first, last: raw.last, cells: raw.cells, byteLength: raw.byteLength }) : null;
  } catch { return null; }
}
function reference(node: Node, text: string): ContributionIndexReference {
  const first = node.kind === "leaf" ? contributionIndexKey(node.cells[0]) : node.children[0].first;
  const last = node.kind === "leaf" ? contributionIndexKey(node.cells.at(-1)!) : node.children.at(-1)!.last;
  const cells = node.kind === "leaf" ? node.cells.length : node.children.reduce((sum, item) => sum + item.cells, 0);
  const result = parseContributionIndexReference({ hash: contributionHash(text), level: level(node), first, last, cells, byteLength: bytes(text) });
  if (!result) throw new Fault("capacity"); return result;
}
function parseNode(value: unknown, owner: ContributionIndexContext): Node | null {
  const leaf = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "kind", "cells"]);
  if (leaf?.schemaVersion === 3 && leaf.kind === "leaf" && leaf.accountId === owner.accountId && leaf.generation === owner.generation) {
    const inputs = array(leaf.cells, CONTRIBUTION_INDEX_LEAF_CELLS);
    if (!inputs?.length) return null;
    const cells: ContributionCell[] = []; let previous = "";
    for (const input of inputs) {
      const cell = parseContributionCell(input), next = cell ? contributionIndexKey(cell) : "";
      if (!cell || !key(next) || next <= previous) return null;
      cells.push(cell); previous = next;
    }
    return Object.freeze({ schemaVersion: 3, ...owner, kind: "leaf", cells: Object.freeze(cells) });
  }
  const branch = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "kind", "level", "children"]);
  if (branch?.schemaVersion !== 3 || branch.kind !== "branch" || branch.accountId !== owner.accountId || branch.generation !== owner.generation
    || !statsInteger(branch.level, 1, CONTRIBUTION_INDEX_MAX_LEVEL)) return null;
  const inputs = array(branch.children, CONTRIBUTION_INDEX_BRANCH_CHILDREN);
  if (!inputs?.length) return null;
  const children: ContributionIndexReference[] = []; let previous = "", count = 0;
  for (const input of inputs) {
    const child = parseContributionIndexReference(input);
    if (!child || child.level !== branch.level - 1 || child.first <= previous) return null;
    children.push(child); previous = child.last; count += child.cells;
  }
  if (count > MAX_CONTRIBUTION_ROLLUP_CELLS) return null;
  return Object.freeze({ schemaVersion: 3, ...owner, kind: "branch", level: branch.level, children: Object.freeze(children) });
}
class Reader {
  readonly cache = new Map<string, Readonly<{ node: Node; reference: ContributionIndexReference }>>();
  objects = 0; byteLength = 0;
  constructor(readonly owner: ContributionIndexContext, readonly load: ContributionIndexLoader) {}
  async read(input: ContributionIndexReference): Promise<Node> {
    const ref = parseContributionIndexReference(input);
    if (!ref) throw new Fault("invalid_projection");
    let cached = this.cache.get(ref.hash);
    if (!cached) {
      if (this.objects >= CONTRIBUTION_INDEX_MAX_READS || this.byteLength + ref.byteLength > CONTRIBUTION_INDEX_MAX_IO_BYTES) throw new Fault("capacity");
      this.objects++; this.byteLength += ref.byteLength;
      let text: string | null;
      try { text = await this.load(ref); } catch { throw new Fault("storage_unavailable"); }
      if (typeof text !== "string" || text.length > ref.byteLength || bytes(text) !== ref.byteLength || contributionHash(text) !== ref.hash)
        throw new Fault("invalid_projection");
      let node: Node | null;
      try { node = parseNode(JSON.parse(text) as unknown, this.owner); } catch { throw new Fault("invalid_projection"); }
      if (!node || JSON.stringify(node) !== text) throw new Fault("invalid_projection");
      cached = { node, reference: reference(node, text) }; this.cache.set(ref.hash, cached);
    }
    if (JSON.stringify(cached.reference) !== JSON.stringify(ref)) throw new Fault("invalid_projection");
    return cached.node;
  }
}
type Change = Readonly<{ key: string; before: ContributionCell | null; after: ContributionCell | null }>;
function changes(value: unknown): readonly Change[] {
  const items = array(value, CONTRIBUTION_INDEX_MAX_CHANGES);
  if (!items) throw new Fault("invalid_input");
  const result: Change[] = [], seen = new Set<string>();
  for (const input of items) {
    const raw = statsOwnRecord(input, ["key", "before", "after"]);
    if (!raw) throw new Fault("invalid_input");
    const before = raw.before === null ? null : parseContributionCell(raw.before), after = raw.after === null ? null : parseContributionCell(raw.after);
    if ((raw.before !== null && !before) || (raw.after !== null && !after) || (!before && !after)
      || raw.key !== contributionCellKey((before ?? after)!.dimensions)
      || (before && after && contributionCellKey(before.dimensions) !== contributionCellKey(after.dimensions))) throw new Fault("invalid_input");
    const index = contributionIndexKey((before ?? after)!);
    if (seen.has(index)) throw new Fault("invalid_input");
    seen.add(index); result.push({ key: index, before, after });
  }
  return result.sort((a, b) => compare(a.key, b.key));
}
function rootReference(input: ContributionIndexReference | null): ContributionIndexReference | null {
  const root = input === null ? null : parseContributionIndexReference(input);
  if (input !== null && root === null) throw new Fault("invalid_input"); return root;
}
const failure = (error: unknown): Readonly<{ ok: false; error: ContributionIndexError }> => ({ ok: false, error: error instanceof Fault ? error.code : "invalid_input" });

/** Path-copy a bounded set of cells. Only immutable bytes are returned. The
 * caller reserves all resulting bytes before R2 writes, verifies them, and
 * conditionally publishes a complete revision in its owned transaction. */
export async function stageContributionIndex(owner: ContributionIndexContext, input: ContributionIndexReference | null,
  values: readonly ContributionCellChange[], load: ContributionIndexLoader): Promise<Result<ContributionIndexStage>> {
  try {
    const scope = context(owner), root = rootReference(input), edits = changes(values), reader = new Reader(scope, load);
    if (root) await reader.read(root);
    const created = new Map<string, Readonly<{ object: ContributionIndexObject; node: Node }>>();
    let writeBytes = 0;
    const make = (node: Node): ContributionIndexReference => {
      const text = JSON.stringify(node), ref = reference(node, text);
      if (!created.has(ref.hash) && !reader.cache.has(ref.hash)) {
        if (created.size >= CONTRIBUTION_INDEX_MAX_WRITES || writeBytes + ref.byteLength > CONTRIBUTION_INDEX_MAX_IO_BYTES) throw new Fault("capacity");
        created.set(ref.hash, { object: Object.freeze({ reference: ref, text }), node }); writeBytes += ref.byteLength;
      }
      return ref;
    };
    const leaves = (cells: readonly ContributionCell[]) => {
      const refs: ContributionIndexReference[] = [];
      for (let offset = 0; offset < cells.length; offset += CONTRIBUTION_INDEX_LEAF_CELLS)
        refs.push(make({ schemaVersion: 3, ...scope, kind: "leaf", cells: cells.slice(offset, offset + CONTRIBUTION_INDEX_LEAF_CELLS) }));
      return refs;
    };
    const branches = (children: readonly ContributionIndexReference[], height: number) => {
      if (height > CONTRIBUTION_INDEX_MAX_LEVEL) throw new Fault("capacity");
      const refs: ContributionIndexReference[] = [];
      for (let offset = 0; offset < children.length; offset += CONTRIBUTION_INDEX_BRANCH_CHILDREN)
        refs.push(make({ schemaVersion: 3, ...scope, kind: "branch", level: height,
          children: children.slice(offset, offset + CONTRIBUTION_INDEX_BRANCH_CHILDREN) }));
      return refs;
    };
    const visit = async (ref: ContributionIndexReference | null, patch: readonly Change[]): Promise<readonly ContributionIndexReference[]> => {
      if (patch.length === 0) return ref ? [ref] : [];
      const node = ref ? await reader.read(ref) : null;
      if (node === null || node.kind === "leaf") {
        const cells = new Map((node?.cells ?? []).map(cell => [contributionIndexKey(cell), cell]));
        for (const edit of patch) {
          if (JSON.stringify(cells.get(edit.key) ?? null) !== JSON.stringify(edit.before)) throw new Fault("conflict");
          if (edit.after) cells.set(edit.key, edit.after); else cells.delete(edit.key);
        }
        return leaves([...cells].sort(([a], [b]) => compare(a, b)).map(([, cell]) => cell));
      }
      const byChild = new Map<number, Change[]>();
      for (const edit of patch) {
        // Gaps and new extreme keys belong to exactly one adjacent child.
        let index = node.children.findIndex(child => edit.key <= child.last);
        if (index === -1) index = node.children.length - 1;
        const group = byChild.get(index) ?? []; group.push(edit); byChild.set(index, group);
      }
      const children: ContributionIndexReference[] = [];
      for (let index = 0; index < node.children.length; index++) {
        const patch = byChild.get(index);
        children.push(...(patch ? await visit(node.children[index], patch) : [node.children[index]]));
      }
      return branches(children, node.level);
    };
    let roots = await visit(root, edits);
    while (roots.length > 1) roots = branches(roots, roots[0].level + 1);
    let next = roots[0] ?? null;
    while (next && next.level > 0) {
      const node = created.get(next.hash)?.node ?? await reader.read(next);
      if (node.kind !== "branch" || node.children.length !== 1) break;
      next = node.children[0];
    }
    const retained = new Set<string>(), objects: ContributionIndexObject[] = [];
    const retain = (ref: ContributionIndexReference) => {
      if (retained.has(ref.hash)) return; retained.add(ref.hash);
      const item = created.get(ref.hash);
      if (item) {
        if (item.node.kind === "branch") for (const child of item.node.children) retain(child);
        objects.push(item.object);
      }
    };
    if (next) retain(next);
    const stage = Object.freeze({ ...scope, root: next, objects: Object.freeze(objects), readObjects: reader.objects,
      readBytes: reader.byteLength, writeBytes: objects.reduce((sum, object) => sum + object.reference.byteLength, 0) });
    ownedStages.add(stage); return { ok: true, value: stage };
  } catch (error) { return failure(error); }
}

export async function readContributionIndexCells(owner: ContributionIndexContext, input: ContributionIndexReference | null,
  inputs: readonly string[], load: ContributionIndexLoader): Promise<Result<Readonly<{ cells: ReadonlyMap<string, ContributionCell | null>; readObjects: number; readBytes: number }>>> {
  try {
    const reader = new Reader(context(owner), load), root = rootReference(input), keys = array(inputs, CONTRIBUTION_INDEX_MAX_CHANGES);
    if (!keys || keys.some(value => !key(value)) || new Set(keys).size !== keys.length) throw new Fault("invalid_input");
    if (root) await reader.read(root);
    const result = new Map<string, ContributionCell | null>();
    for (const item of keys as readonly string[]) {
      let ref = root, found: ContributionCell | null = null;
      while (ref && item >= ref.first && item <= ref.last) {
        const node = await reader.read(ref);
        if (node.kind === "leaf") { found = node.cells.find(cell => contributionIndexKey(cell) === item) ?? null; break; }
        ref = node.children.find(child => item >= child.first && item <= child.last) ?? null;
      }
      result.set(item, found);
    }
    return { ok: true, value: Object.freeze({ cells: result, readObjects: reader.objects, readBytes: reader.byteLength }) };
  } catch (error) { return failure(error); }
}

/** Snapshot pagination returns complete cells and an explicit continuation,
 * never a partial total. A cursor cannot be reused across root or range changes. */
export async function readContributionIndexPage(owner: ContributionIndexContext, input: ContributionIndexReference | null,
  query: Readonly<{ firstUtcDay: number; dayCount: number; limit: number; cursor: ContributionIndexCursor | null }>,
  load: ContributionIndexLoader): Promise<Result<ContributionIndexPage>> {
  try {
    const reader = new Reader(context(owner), load), root = rootReference(input);
    const raw = statsOwnRecord(query, ["firstUtcDay", "dayCount", "limit", "cursor"]);
    if (!raw || !statsInteger(raw.firstUtcDay, 0, STATS_MAX_DAY) || !statsInteger(raw.dayCount, 1, STATS_MAX_DAYS)
      || raw.firstUtcDay + raw.dayCount - 1 > STATS_MAX_DAY || !statsInteger(raw.limit, 1, CONTRIBUTION_INDEX_MAX_PAGE_CELLS)) throw new Fault("invalid_input");
    const lower = `${String(raw.firstUtcDay).padStart(8, "0")}:`, upper = `${String(raw.firstUtcDay + raw.dayCount).padStart(8, "0")}:`;
    // The largest valid day needs a lexical sentinel wider than its own key.
    const ceiling = raw.firstUtcDay + raw.dayCount > STATS_MAX_DAY ? ":" : upper;
    let after = "";
    if (raw.cursor !== null) {
      const cursor = statsOwnRecord(raw.cursor, ["rootHash", "firstUtcDay", "dayCount", "afterKey"]);
      if (!cursor || !root || cursor.rootHash !== root.hash || cursor.firstUtcDay !== raw.firstUtcDay || cursor.dayCount !== raw.dayCount
        || !key(cursor.afterKey) || cursor.afterKey < lower || cursor.afterKey >= ceiling) throw new Fault("invalid_input");
      after = cursor.afterKey;
    }
    // Even a disjoint range must authenticate the root's context and pruning
    // metadata. Child references are then trusted only via that checked parent.
    if (root) await reader.read(root);
    const limit = raw.limit, cells: ContributionCell[] = [];
    const visit = async (ref: ContributionIndexReference): Promise<void> => {
      if (cells.length > limit || ref.last < lower || ref.first >= ceiling || ref.last <= after) return;
      const node = await reader.read(ref);
      if (node.kind === "leaf") {
        for (const cell of node.cells) {
          const index = contributionIndexKey(cell);
          if (index >= lower && index < ceiling && index > after) cells.push(cell);
          if (cells.length > limit) break;
        }
      } else for (const child of node.children) {
        await visit(child); if (cells.length > limit) break;
      }
    };
    if (root) await visit(root);
    const more = cells.length > limit; if (more) cells.pop();
    const next: ContributionIndexCursor | null = more ? Object.freeze({ rootHash: root!.hash, firstUtcDay: raw.firstUtcDay,
      dayCount: raw.dayCount, afterKey: contributionIndexKey(cells.at(-1)!) }) : null;
    return { ok: true, value: Object.freeze({ cells: Object.freeze(cells), next, readObjects: reader.objects, readBytes: reader.byteLength }) };
  } catch (error) { return failure(error); }
}

/** Internal maintenance pagination across the entire retained key space. Each
 * cursor binds both its exact last cell and its ordinal to the authenticated
 * tree; it cannot silently resume in a gap or beyond the claimed prefix.
 * A cursor alone does not certify that its prefix was compared. The owner must
 * begin at null and retain only continuations returned by its checked job.
 * Public date-range queries keep their independent 366-day restriction. */
export async function readContributionIndexScanPage(owner: ContributionIndexContext, input: ContributionIndexReference | null,
  query: Readonly<{ limit: number; cursor: ContributionIndexScanCursor | null }>,
  load: ContributionIndexLoader): Promise<Result<ContributionIndexScanPage>> {
  try {
    const reader = new Reader(context(owner), load), root = rootReference(input);
    const raw = statsOwnRecord(query, ["limit", "cursor"]);
    if (!raw || !statsInteger(raw.limit, 1, CONTRIBUTION_INDEX_SCAN_PAGE_CELLS)) throw new Fault("invalid_input");
    let after = "", prefix = 0;
    if (raw.cursor !== null) {
      const cursor = statsOwnRecord(raw.cursor, ["rootHash", "afterKey", "scannedCells"]);
      if (!cursor || !root || cursor.rootHash !== root.hash || !key(cursor.afterKey)
        || cursor.afterKey < root.first || cursor.afterKey >= root.last
        || !statsInteger(cursor.scannedCells, 1, root.cells - 1)) throw new Fault("invalid_input");
      after = cursor.afterKey; prefix = cursor.scannedCells;
    }
    if (root) await reader.read(root);
    if (after) {
      let ref = root!, rank = 0;
      for (;;) {
        const node = await reader.read(ref);
        if (node.kind === "leaf") {
          const index = node.cells.findIndex(cell => contributionIndexKey(cell) === after);
          if (index < 0 || rank + index + 1 !== prefix) throw new Fault("invalid_input");
          break;
        }
        let child: ContributionIndexReference | null = null;
        for (const candidate of node.children) {
          if (candidate.last < after) rank += candidate.cells;
          else { if (candidate.first <= after) child = candidate; break; }
        }
        if (!child) throw new Fault("invalid_input");
        ref = child;
      }
    }
    const cells: ContributionCell[] = [], limit = raw.limit;
    const visit = async (ref: ContributionIndexReference): Promise<void> => {
      if (cells.length > limit || ref.last <= after) return;
      const node = await reader.read(ref);
      if (node.kind === "leaf") {
        for (const cell of node.cells) {
          if (contributionIndexKey(cell) > after) cells.push(cell);
          if (cells.length > limit) break;
        }
      } else for (const child of node.children) {
        await visit(child); if (cells.length > limit) break;
      }
    };
    if (root) await visit(root);
    const more = cells.length > limit;
    if (more) cells.pop();
    const scannedCells = prefix + cells.length;
    if (more ? scannedCells >= root!.cells : scannedCells !== (root?.cells ?? 0)) throw new Fault("invalid_projection");
    const next = more ? Object.freeze({ rootHash: root!.hash, afterKey: contributionIndexKey(cells.at(-1)!), scannedCells }) : null;
    return { ok: true, value: Object.freeze({ cells: Object.freeze(cells), next, scannedCells,
      readObjects: reader.objects, readBytes: reader.byteLength }) };
  } catch (error) { return failure(error); }
}
