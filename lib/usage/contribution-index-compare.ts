import { contributionAccount, contributionIdentity } from "./contribution-contract";
import { CONTRIBUTION_INDEX_SCAN_PAGE_CELLS, contributionIndexKey, parseContributionIndexReference, readContributionIndexScanPage,
  type ContributionIndexContext, type ContributionIndexError, type ContributionIndexLoader, type ContributionIndexReference,
  type ContributionIndexScanCursor, type ContributionIndexScanPage } from "./contribution-index";
import type { ContributionCell } from "./contribution-rollups";
import { statsOwnRecord } from "./stats-contract";

export type ContributionIndexComparisonStep = Readonly<{
  verdict: "continue" | "match" | "mismatch"; checkedCells: number;
  difference: Readonly<{ key: string; left: ContributionCell | null; right: ContributionCell | null }> | null;
  readObjects: number; readBytes: number;
}>;
type Result<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ContributionIndexError }>;

/** Bounded semantic comparison of two immutable roots. Equal roots are still
 * traversed: an available root object does not attest its descendants. The
 * private continuation prevents a caller-supplied cursor from skipping a bad
 * prefix and obtaining a whole-index match. This in-memory session restarts at
 * zero after process loss; durable maintenance owns a separate recovery layer.
 * A match is relative to these objects, not proof of canonical source truth or
 * permission to publish either root. The loader owns authority and deadlines. */
export class ContributionIndexComparison {
  readonly #owner: ContributionIndexContext;
  readonly #left: ContributionIndexReference | null;
  readonly #right: ContributionIndexReference | null;
  #leftCursor: ContributionIndexScanCursor | null = null;
  #rightCursor: ContributionIndexScanCursor | null = null;
  #checkedCells = 0;
  #leftDone = false;
  #rightDone = false;
  #busy = false;
  #terminal: ContributionIndexComparisonStep | null = null;
  private constructor(owner: ContributionIndexContext, left: ContributionIndexReference | null, right: ContributionIndexReference | null) {
    this.#owner = owner; this.#left = left; this.#right = right;
  }
  static create(owner: ContributionIndexContext, left: ContributionIndexReference | null,
    right: ContributionIndexReference | null): Result<ContributionIndexComparison> {
    try {
      const scope = statsOwnRecord(owner, ["accountId", "generation"]);
      const first = left === null ? null : parseContributionIndexReference(left), second = right === null ? null : parseContributionIndexReference(right);
      if (!scope || !contributionAccount(scope.accountId) || !contributionIdentity(scope.generation)
        || (left !== null && !first) || (right !== null && !second)) return { ok: false, error: "invalid_input" };
      return { ok: true, value: new ContributionIndexComparison(Object.freeze({ accountId: scope.accountId, generation: scope.generation }), first, second) };
    } catch { return { ok: false, error: "invalid_input" }; }
  }
  async step(leftLoad: ContributionIndexLoader, rightLoad: ContributionIndexLoader = leftLoad): Promise<Result<ContributionIndexComparisonStep>> {
    if (this.#busy) return { ok: false, error: "conflict" };
    if (this.#terminal) return { ok: true, value: Object.freeze({ ...this.#terminal, readObjects: 0, readBytes: 0 }) };
    this.#busy = true;
    try {
      const exhausted: Result<ContributionIndexScanPage> = { ok: true, value: { cells: [], next: null,
        scannedCells: this.#checkedCells, readObjects: 0, readBytes: 0 } };
      const left = this.#leftDone ? exhausted : await readContributionIndexScanPage(this.#owner, this.#left,
        { limit: CONTRIBUTION_INDEX_SCAN_PAGE_CELLS, cursor: this.#leftCursor }, leftLoad);
      if (!left.ok) return left;
      const right = this.#rightDone ? exhausted : await readContributionIndexScanPage(this.#owner, this.#right,
        { limit: CONTRIBUTION_INDEX_SCAN_PAGE_CELLS, cursor: this.#rightCursor }, rightLoad);
      if (!right.ok) return right;
      const work = { readObjects: left.value.readObjects + right.value.readObjects, readBytes: left.value.readBytes + right.value.readBytes };
      // Neither prefix moves until both reads succeed. A failed second read
      // therefore retries the exact same pair instead of hiding an omission.
      if (left.value.scannedCells !== this.#checkedCells + left.value.cells.length
        || right.value.scannedCells !== this.#checkedCells + right.value.cells.length)
        return { ok: false, error: "invalid_projection" };
      for (let index = 0; index < Math.max(left.value.cells.length, right.value.cells.length); index++) {
        const a = left.value.cells[index] ?? null, b = right.value.cells[index] ?? null;
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        const aKey = a ? contributionIndexKey(a) : null, bKey = b ? contributionIndexKey(b) : null;
        const key = aKey === null ? bKey! : bKey === null ? aKey : aKey < bKey ? aKey : bKey;
        const result = Object.freeze({ verdict: "mismatch" as const, checkedCells: this.#checkedCells + index,
          difference: Object.freeze({ key, left: aKey === key ? a : null, right: bKey === key ? b : null }), ...work });
        this.#terminal = result;
        return { ok: true, value: result };
      }
      const checkedCells = left.value.scannedCells;
      const complete = left.value.next === null && right.value.next === null;
      const result = Object.freeze({ verdict: complete ? "match" as const : "continue" as const,
        checkedCells, difference: null, ...work });
      this.#checkedCells = checkedCells;
      this.#leftCursor = left.value.next; this.#rightCursor = right.value.next;
      this.#leftDone = left.value.next === null; this.#rightDone = right.value.next === null;
      if (result.verdict === "match") this.#terminal = result;
      return { ok: true, value: result };
    } finally { this.#busy = false; }
  }
}
