import { expect, test } from "bun:test";
import { contributionHash } from "./contributions";
import { contributionCellKey, parseContributionCell, type ContributionCell, type ContributionCellChange } from "./contribution-rollups";
import { CONTRIBUTION_INDEX_MAX_CHANGES, CONTRIBUTION_INDEX_MAX_PAGE_CELLS, contributionIndexKey,
  CONTRIBUTION_INDEX_SCAN_PAGE_CELLS, CONTRIBUTION_INDEX_MAX_LEVEL, CONTRIBUTION_INDEX_MAX_NODE_BYTES,
  CONTRIBUTION_INDEX_MAX_READS, CONTRIBUTION_INDEX_MAX_IO_BYTES,
  parseContributionIndexReference, readContributionIndexCells, readContributionIndexPage, readContributionIndexScanPage, stageContributionIndex,
  type ContributionIndexContext, type ContributionIndexCursor, type ContributionIndexReference, type ContributionIndexScanCursor } from "./contribution-index";
import { ContributionIndexComparison } from "./contribution-index-compare";

const owner: ContributionIndexContext = { accountId: `acct_${"1".repeat(32)}`, generation: "2".repeat(64) };
function cell(day: number, amount = String(day + 1)): ContributionCell {
  const result = parseContributionCell({ schemaVersion: 3, dimensions: { utcDay: day, client: "codex", provider: null,
    model: null, tokenBasis: "reported", breakdownCoverage: "complete", costKind: "none", timed: false }, observations: 1,
    tokens: { input: amount, cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    costMicrousd: null, durationMs: null, timedTokens: "0" });
  if (!result) throw new Error("invalid synthetic cell"); return result;
}
const change = (before: ContributionCell | null, after: ContributionCell | null): ContributionCellChange => ({
  key: contributionCellKey((before ?? after)!.dimensions), before, after,
});
function fixture() {
  const objects = new Map<string, string>(); let root: ContributionIndexReference | null = null, reads = 0;
  const load = async (ref: ContributionIndexReference) => { reads++; return objects.get(ref.hash) ?? null; };
  const apply = async (values: readonly ContributionCellChange[]) => {
    const staged = await stageContributionIndex(owner, root, values, load);
    if (!staged.ok) throw new Error(staged.error);
    expect(staged.value.writeBytes).toBe(staged.value.objects.reduce((sum, item) => sum + new TextEncoder().encode(item.text).byteLength, 0));
    for (const item of staged.value.objects) {
      expect(contributionHash(item.text)).toBe(item.reference.hash);
      if (objects.has(item.reference.hash)) expect(objects.get(item.reference.hash)).toBe(item.text);
      objects.set(item.reference.hash, item.text);
    }
    root = staged.value.root; return staged.value;
  };
  const add = async (cells: readonly ContributionCell[]) => {
    for (let offset = 0; offset < cells.length; offset += CONTRIBUTION_INDEX_MAX_CHANGES)
      await apply(cells.slice(offset, offset + CONTRIBUTION_INDEX_MAX_CHANGES).map(value => change(null, value)));
  };
  return { objects, load, apply, add, get root() { return root; }, get reads() { return reads; } };
}
const query = (firstUtcDay: number, dayCount: number, limit = 256, cursor: ContributionIndexCursor | null = null) => ({ firstUtcDay, dayCount, limit, cursor });

test("immutable publication retains old snapshots and pages exactly conserve their pinned range", async () => {
  const f = fixture(), values = Array.from({ length: 300 }, (_, day) => cell(day)); await f.add(values);
  const original = f.root; let cursor: ContributionIndexCursor | null = null; const observed: ContributionCell[] = [];
  do {
    const page = await readContributionIndexPage(owner, original, query(20, 250, 37, cursor), f.load);
    if (!page.ok) throw new Error(page.error);
    observed.push(...page.value.cells); cursor = page.value.next;
    if (cursor && observed.length === 37) {
      await f.apply([change(values[100], cell(100, "999")), change(values[200], null)]);
      expect(f.root?.hash).not.toBe(original?.hash);
    }
  } while (cursor);
  expect(observed).toEqual(values.slice(20, 270));
  const latest = await readContributionIndexPage(owner, f.root, query(100, 101), f.load);
  if (!latest.ok) throw new Error(latest.error);
  expect(latest.value.cells).toHaveLength(100); expect(latest.value.cells[0].tokens.input).toBe("999");
  const first = await readContributionIndexPage(owner, original, query(20, 250, 1), f.load);
  if (!first.ok) throw new Error(first.error);
  expect(await readContributionIndexPage(owner, f.root, query(20, 250, 1, first.value.next), f.load))
    .toEqual({ ok: false, error: "invalid_input" });
  expect(await readContributionIndexPage(owner, original, query(21, 250, 1, first.value.next), f.load))
    .toEqual({ ok: false, error: "invalid_input" });
});

test("a deep index reads only the selected path and changes only that path", async () => {
  const f = fixture(); await f.add(Array.from({ length: 8_400 }, (_, day) => cell(day)));
  expect(f.root!.level).toBeGreaterThanOrEqual(2);
  const before = f.reads, page = await readContributionIndexPage(owner, f.root, query(4_200, 1, 1), f.load);
  if (!page.ok) throw new Error(page.error);
  expect(page.value.cells).toEqual([cell(4_200)]); expect(page.value.next).toBeNull();
  expect(f.reads - before).toBe(f.root!.level + 1);
  const stage = await f.apply([change(cell(4_200), cell(4_200, "9007199254740993"))]);
  expect(stage.readObjects).toBe(f.root!.level + 1); expect(stage.objects.length).toBe(f.root!.level + 1);
  const lookup = await readContributionIndexCells(owner, f.root, [contributionIndexKey(cell(4_200)), contributionIndexKey(cell(9_000))], f.load);
  if (!lookup.ok) throw new Error(lookup.error);
  expect(lookup.value.cells.get(contributionIndexKey(cell(4_200)))!.tokens.input).toBe("9007199254740993");
  expect(lookup.value.cells.get(contributionIndexKey(cell(9_000)))).toBeNull();
  expect(lookup.value.readObjects).toBe(f.root!.level + 1);
});

test("corrections, new gaps, extrema and deletions agree with an independent ordered map", async () => {
  for (const seed of [719, 89123, 2147483629]) {
    const f = fixture(), expected = new Map<number, ContributionCell>(); let state = seed;
    const next = () => state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    for (let step = 0; step < 160; step++) {
      const edits: ContributionCellChange[] = [], used = new Set<number>();
      for (let index = 0; index < 8; index++) {
        const day = next() % 366;
        if (used.has(day)) continue; used.add(day);
        const before = expected.get(day) ?? null, after = before && next() % 3 === 0 ? null : cell(day, String(next()));
        edits.push(change(before, after)); if (after) expected.set(day, after); else expected.delete(day);
      }
      await f.apply(edits);
      const actual: ContributionCell[] = []; let cursor: ContributionIndexCursor | null = null;
      do {
        const page = await readContributionIndexPage(owner, f.root, query(0, 366, 71, cursor), f.load);
        if (!page.ok) throw new Error(page.error); actual.push(...page.value.cells); cursor = page.value.next;
      } while (cursor);
      expect(actual).toEqual([...expected].sort(([a], [b]) => a - b).map(([, value]) => value));
      expect(f.root?.cells ?? 0).toBe(expected.size);
    }
    for (const batch of [...expected.values()].reduce<ContributionCell[][]>((result, value, index) => {
      const slot = Math.floor(index / 64); (result[slot] ??= []).push(value); return result;
    }, [])) await f.apply(batch.map(value => change(value, null)));
    expect(f.root).toBeNull();
  }
}, 30_000);

test("invalid predecessors and inputs never produce writable objects or change the caller's store", async () => {
  const f = fixture(); await f.add([cell(1), cell(3)]);
  const root = f.root, snapshot = [...f.objects];
  for (const patch of [[change(null, cell(1))], [change(cell(1, "9"), null)], [change(cell(9), null)]])
    expect(await stageContributionIndex(owner, root, patch, f.load)).toEqual({ ok: false, error: "conflict" });
  for (const patch of [[change(null, cell(2)), change(null, cell(2))], Array(65).fill(change(null, cell(2))),
    [{ ...change(null, cell(2)), key: "foreign-key" }]])
    expect(await stageContributionIndex(owner, root, patch, f.load)).toEqual({ ok: false, error: "invalid_input" });
  let accessed = 0; const hostile: unknown[] = [];
  Object.defineProperty(hostile, "0", { enumerable: true, get() { accessed++; return change(null, cell(2)); } });
  expect(await stageContributionIndex(owner, root, hostile as ContributionCellChange[], f.load)).toEqual({ ok: false, error: "invalid_input" });
  expect(accessed).toBe(0); expect(f.root).toEqual(root); expect([...f.objects]).toEqual(snapshot);
  const noOp = await f.apply([change(cell(1), cell(1))]); expect(noOp.objects).toHaveLength(0); expect(noOp.root).toEqual(root);
});

test("object integrity binds exact context, bytes, edges and metadata", async () => {
  const f = fixture(); await f.add(Array.from({ length: 260 }, (_, day) => cell(day))); const root = f.root!;
  const scan = (ref = root, load = f.load, scope = owner) => readContributionIndexPage(scope, ref, query(0, 20), load);
  expect(await scan(root, async () => null)).toEqual({ ok: false, error: "invalid_projection" });
  expect(await scan(root, async () => { throw new Error("offline"); })).toEqual({ ok: false, error: "storage_unavailable" });
  expect(await scan({ ...root, cells: root.cells + 1 })).toEqual({ ok: false, error: "invalid_projection" });
  expect(await scan(root, f.load, { ...owner, generation: "3".repeat(64) })).toEqual({ ok: false, error: "invalid_projection" });
  const text = f.objects.get(root.hash)!;
  expect(await scan(root, async () => `${text} `)).toEqual({ ok: false, error: "invalid_projection" });
  const invalid = JSON.parse(text) as { children: ContributionIndexReference[] };
  invalid.children[1] = invalid.children[0];
  const corrupt = JSON.stringify(invalid), forged = { ...root, hash: contributionHash(corrupt), byteLength: new TextEncoder().encode(corrupt).byteLength };
  expect(await scan(forged, async () => corrupt)).toEqual({ ok: false, error: "invalid_projection" });
  expect(parseContributionIndexReference({ ...root, unexpected: true })).toBeNull();
  expect(parseContributionIndexReference({ ...root, level: 7 })).toBeNull();
  expect(parseContributionIndexReference({ ...root, byteLength: 262_145 })).toBeNull();
});

test("empty and maximum UTC-day ranges, cursor limits and sparse reads remain explicit", async () => {
  const f = fixture(); await f.add([cell(0), cell(99_999_998), cell(99_999_999)]);
  const final = await readContributionIndexPage(owner, f.root, query(99_999_999, 1, 1), f.load);
  if (!final.ok) throw new Error(final.error); expect(final.value.cells).toEqual([cell(99_999_999)]); expect(final.value.next).toBeNull();
  const empty = await readContributionIndexPage(owner, null, query(0, 1), f.load);
  expect(empty).toEqual({ ok: true, value: { cells: [], next: null, readObjects: 0, readBytes: 0 } });
  for (const q of [query(99_999_999, 2), query(0, 367), query(-0, 1), query(0, 1, CONTRIBUTION_INDEX_MAX_PAGE_CELLS + 1)])
    expect(await readContributionIndexPage(owner, f.root, q, f.load)).toEqual({ ok: false, error: "invalid_input" });
});
test("disjoint ranges and no-op stages authenticate root metadata and account context before pruning", async () => {
  const f = fixture(); await f.add([cell(10)]);
  const root = f.root!, foreign = { ...owner, generation: "3".repeat(64) };
  const forged = { ...root, first: contributionIndexKey(cell(90)), last: contributionIndexKey(cell(90)) };
  expect(await readContributionIndexPage(owner, forged, query(10, 1), f.load)).toEqual({ ok: false, error: "invalid_projection" });
  expect(await readContributionIndexCells(owner, forged, [contributionIndexKey(cell(10))], f.load))
    .toEqual({ ok: false, error: "invalid_projection" });
  expect(await readContributionIndexPage(foreign, root, query(90, 1), f.load)).toEqual({ ok: false, error: "invalid_projection" });
  expect(await readContributionIndexCells(foreign, root, [], f.load)).toEqual({ ok: false, error: "invalid_projection" });
  expect(await stageContributionIndex(foreign, root, [], f.load)).toEqual({ ok: false, error: "invalid_projection" });
});

test("maintenance scan covers the whole key space with exact ordered prefix counts", async () => {
  const f = fixture(), values = [...Array.from({ length: 70 }, (_, day) => cell(day * 20_000)), cell(99_999_999)];
  await f.add(values);
  const root = f.root; let cursor: ContributionIndexScanCursor | null = null;
  const actual: ContributionCell[] = [];
  do {
    const page = await readContributionIndexScanPage(owner, root, { limit: 13, cursor }, f.load);
    if (!page.ok) throw new Error(page.error);
    actual.push(...page.value.cells); expect(page.value.scannedCells).toBe(actual.length);
    expect(page.value.cells.length).toBeLessThanOrEqual(13);
    cursor = page.value.next;
    if (cursor) expect(cursor.scannedCells).toBe(actual.length);
  } while (cursor);
  expect(actual).toEqual(values);
  expect(await readContributionIndexScanPage(owner, null, { limit: 16, cursor: null }, f.load))
    .toEqual({ ok: true, value: { cells: [], next: null, scannedCells: 0, readObjects: 0, readBytes: 0 } });
});

test("scan continuations reject wrong roots, missing keys and fabricated prefix ordinals", async () => {
  const f = fixture(); await f.add(Array.from({ length: 40 }, (_, day) => cell(day * 2)));
  const root = f.root!, first = await readContributionIndexScanPage(owner, root, { limit: 16, cursor: null }, f.load);
  if (!first.ok || !first.value.next) throw new Error("missing synthetic continuation");
  const cursor = first.value.next;
  for (const bad of [{ ...cursor, scannedCells: 15 }, { ...cursor, scannedCells: 17 },
    { ...cursor, afterKey: contributionIndexKey(cell(31)) }, { ...cursor, afterKey: root.last },
    { ...cursor, rootHash: "4".repeat(64) }, { ...cursor, unexpected: true }]) {
    expect(await readContributionIndexScanPage(owner, root, { limit: 16, cursor: bad }, f.load))
      .toEqual({ ok: false, error: "invalid_input" });
  }
  let accessed = 0;
  const hostile = { ...cursor }; Object.defineProperty(hostile, "afterKey", { enumerable: true, get() { accessed++; return cursor.afterKey; } });
  expect(await readContributionIndexScanPage(owner, root, { limit: 16, cursor: hostile }, f.load))
    .toEqual({ ok: false, error: "invalid_input" });
  expect(accessed).toBe(0);
  expect(await readContributionIndexScanPage(owner, root, { limit: 17, cursor: null }, f.load))
    .toEqual({ ok: false, error: "invalid_input" });
  await f.apply([change(null, cell(99))]);
  expect(await readContributionIndexScanPage(owner, f.root, { limit: 16, cursor }, f.load))
    .toEqual({ ok: false, error: "invalid_input" });
  expect(await readContributionIndexScanPage({ ...owner, generation: "7".repeat(64) }, root, { limit: 16, cursor }, f.load))
    .toEqual({ ok: false, error: "invalid_projection" });
});

test("maximum-height sparse scans fit the independent worst-case object and byte envelope", async () => {
  const objects = new Map<string, string>();
  const leaf = (value: ContributionCell): ContributionIndexReference => {
    const text = JSON.stringify({ schemaVersion: 3, ...owner, kind: "leaf", cells: [value] });
    const ref = { hash: contributionHash(text), level: 0, first: contributionIndexKey(value), last: contributionIndexKey(value),
      cells: 1, byteLength: new TextEncoder().encode(text).byteLength };
    objects.set(ref.hash, text); return ref;
  };
  const branch = (children: ContributionIndexReference[]): ContributionIndexReference => {
    const level = children[0].level + 1, text = JSON.stringify({ schemaVersion: 3, ...owner, kind: "branch", level, children });
    const ref = { hash: contributionHash(text), level, first: children[0].first, last: children.at(-1)!.last,
      cells: children.reduce((sum, item) => sum + item.cells, 0), byteLength: new TextEncoder().encode(text).byteLength };
    objects.set(ref.hash, text); return ref;
  };
  const values = Array.from({ length: 33 }, (_, day) => cell(day));
  const children = values.map(value => {
    let ref = leaf(value);
    for (let level = 1; level < CONTRIBUTION_INDEX_MAX_LEVEL; level++) ref = branch([ref]);
    return ref;
  });
  const root = branch(children), maximumObjects = (CONTRIBUTION_INDEX_SCAN_PAGE_CELLS + 2) * (CONTRIBUTION_INDEX_MAX_LEVEL + 1);
  expect(maximumObjects).toBeLessThanOrEqual(CONTRIBUTION_INDEX_MAX_READS);
  expect(maximumObjects * CONTRIBUTION_INDEX_MAX_NODE_BYTES).toBeLessThanOrEqual(CONTRIBUTION_INDEX_MAX_IO_BYTES);
  let cursor: ContributionIndexScanCursor | null = null; const actual: ContributionCell[] = [];
  do {
    const page = await readContributionIndexScanPage(owner, root, { limit: 16, cursor }, async ref => objects.get(ref.hash) ?? null);
    if (!page.ok) throw new Error(page.error);
    expect(page.value.readObjects).toBeLessThanOrEqual(maximumObjects);
    expect(page.value.readBytes).toBeLessThanOrEqual(CONTRIBUTION_INDEX_MAX_IO_BYTES);
    actual.push(...page.value.cells); cursor = page.value.next;
  } while (cursor);
  expect(actual).toEqual(values);
});

const comparison = (left: ContributionIndexReference | null, right: ContributionIndexReference | null) => {
  const value = ContributionIndexComparison.create(owner, left, right);
  if (!value.ok) throw new Error(value.error); return value.value;
};
test("whole-index comparison matches semantic cells across different insertion histories and all days", async () => {
  const a = fixture(), b = fixture(), values = Array.from({ length: 300 }, (_, day) => cell(day * 100_000));
  await a.add(values); await b.add([...values].reverse());
  expect(a.root!.hash).not.toBe(b.root!.hash);
  const check = comparison(a.root, b.root); let previous = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await check.step(a.load, b.load);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.difference).toBeNull(); expect(result.value.checkedCells).toBeGreaterThan(previous);
    previous = result.value.checkedCells;
    if (result.value.verdict === "match") break;
    expect(result.value.verdict).toBe("continue");
  }
  expect(previous).toBe(300);
  const noIo = async () => { throw new Error("terminal comparison dispatched a read"); };
  expect(await check.step(noIo)).toEqual({ ok: true, value: { verdict: "match", checkedCells: 300,
    difference: null, readObjects: 0, readBytes: 0 } });
});

test("comparison finds changed and missing cells at either side of a page boundary", async () => {
  for (const [leftCount, rightCount, changed] of [[16, 17, false], [17, 16, false], [17, 17, true], [0, 1, false], [1, 0, false]] as const) {
    const a = fixture(), b = fixture();
    await a.add(Array.from({ length: leftCount }, (_, day) => cell(day)));
    await b.add(Array.from({ length: rightCount }, (_, day) => cell(day, changed && day === 16 ? "999" : String(day + 1))));
    const check = comparison(a.root, b.root);
    let found = false;
    for (let step = 0; step < 3; step++) {
      const result = await check.step(a.load, b.load);
      if (!result.ok) throw new Error(result.error);
      if (result.value.verdict === "continue") continue;
      expect(result.value.verdict).toBe("mismatch");
      const day = leftCount === 0 || rightCount === 0 ? 0 : 16;
      expect(result.value.checkedCells).toBe(day);
      expect(result.value.difference).toEqual({ key: contributionIndexKey(cell(day)),
        left: leftCount > day ? cell(day) : null,
        right: rightCount > day ? cell(day, changed ? "999" : String(day + 1)) : null });
      found = true; break;
    }
    expect(found).toBe(true);
  }
});

test("a failed second-side read preserves the entire comparison prefix for an exact retry", async () => {
  const a = fixture(), b = fixture(), values = Array.from({ length: 40 }, (_, day) => cell(day));
  await a.add(values); await b.add(values);
  const check = comparison(a.root, b.root), first = await check.step(a.load, b.load);
  if (!first.ok) throw new Error(first.error);
  expect(first.value.checkedCells).toBe(16);
  expect(await check.step(a.load, async () => { throw new Error("unavailable"); }))
    .toEqual({ ok: false, error: "storage_unavailable" });
  const retry = await check.step(a.load, b.load);
  if (!retry.ok) throw new Error(retry.error);
  expect(retry.value.verdict).toBe("continue"); expect(retry.value.checkedCells).toBe(32);
  const final = await check.step(a.load, b.load);
  if (!final.ok) throw new Error(final.error);
  expect(final.value.verdict).toBe("match"); expect(final.value.checkedCells).toBe(40);
});

test("comparison owns its inputs, excludes concurrent steps and never trusts equal root hashes alone", async () => {
  const f = fixture(); await f.add(Array.from({ length: 260 }, (_, day) => cell(day)));
  const callerRoot = { ...f.root! }, callerOwner = { ...owner }, made = ContributionIndexComparison.create(callerOwner, callerRoot, callerRoot);
  if (!made.ok) throw new Error(made.error);
  callerRoot.hash = "8".repeat(64); callerOwner.generation = "9".repeat(64);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const pending = made.value.step(async ref => { await held; return f.load(ref); }, f.load);
  expect(await made.value.step(f.load)).toEqual({ ok: false, error: "conflict" });
  release(); const first = await pending;
  if (!first.ok) throw new Error(first.error);
  expect(first.value.verdict).toBe("continue"); expect(first.value.checkedCells).toBe(16);
  const check = comparison(f.root, f.root);
  expect(await check.step(async ref => ref.level === 0 ? null : f.load(ref)))
    .toEqual({ ok: false, error: "invalid_projection" });
  const empty = await comparison(null, null).step(async () => { throw new Error("unexpected read"); });
  expect(empty).toEqual({ ok: true, value: { verdict: "match", checkedCells: 0, difference: null, readObjects: 0, readBytes: 0 } });
});
