import { expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import { mergeRichFactReports, summarizeRichFacts } from "./rich-facts";
import { richFact, richId, richOwner, richReport, richSelection, richUsage } from "./rich-fact-fixtures";

test("property: observation sums and nearest-rank statistics use the independent sorted multiset", () => {
  assertProperty(fc.property(fc.array(fc.bigInt({ min: 0n, max: 999_999_999_999_999_999_999_999n }), { maxLength: 100 }), values => {
    const report = richReport(values.map((value, i) => richFact(i + 1, richUsage(i + 1, String(value)))));
    const result = summarizeRichFacts(report, richSelection);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.tokens === null) throw new Error("direct totals must remain eligible");
    const observed = result.value.tokens.total;
    expect(observed.sum).toBe(values.reduce((sum, value) => sum + value, 0n));
    expect(observed.measured).toBe(values.length);
    const sorted = [...values].sort((a, b) => a === b ? 0 : a > b ? 1 : -1);
    for (const [percent, value] of [[50, observed.median], [90, observed.p90], [95, observed.p95], [99, observed.p99]] as const) {
      if (value === null) expect(values).toHaveLength(0);
      else {
        const rank = (values.length * percent + 99) / 100 | 0;
        expect(sorted[rank - 1]).toBe(value);
        expect(values.filter(item => item <= value).length).toBeGreaterThanOrEqual(rank);
      }
    }
  }));
});

test("property: corrections, retractions, duplication and permutation preserve the reference latest-head sum", () => {
  assertProperty(fc.property(fc.array(fc.record({ first: fc.integer({ min: 0, max: 10_000 }), last: fc.integer({ min: 0, max: 10_000 }), retract: fc.boolean() }), { maxLength: 80 }), values => {
    const events = values.flatMap((value, i) => {
      const old = richFact(i + 1, richUsage(i + 1, String(value.first)));
      const latest = richFact(i + 1, richUsage(i + 1, String(value.last)), { revision: 3, ...(value.retract ? { value: null } : {}) });
      return [latest, old, latest];
    });
    const report = richReport(events), result = summarizeRichFacts(report, richSelection);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.tokens === null) throw new Error("direct totals must remain eligible");
    expect(result.value.tokens.total.sum).toBe(values.reduce((sum, item) => sum + (item.retract ? 0n : BigInt(item.last)), 0n));
    expect(summarizeRichFacts(richReport(events.toReversed()), richSelection)).toEqual(result);
    const replayed = mergeRichFactReports(report, report);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(summarizeRichFacts(replayed.value, richSelection)).toEqual(result);
  }));
});

test("property: inclusive sums exist exactly for an antichain in the independently constructed execution forest", () => {
  assertProperty(fc.property(fc.array(fc.record({ parentChoice: fc.nat(100), selected: fc.boolean(), amount: fc.nat(10_000) }), { minLength: 1, maxLength: 40 }), nodes => {
    const ancestors: number[][] = [];
    const facts = nodes.map((node, index) => {
      const parent = index === 0 || node.parentChoice === 0 ? null : node.parentChoice % index;
      ancestors.push(parent === null ? [] : [parent, ...ancestors[parent]!]);
      return richFact(index + 1, richUsage(index + 1, String(node.amount), { tokenScope: node.selected ? "inclusive" : "direct" }), {
        owner: { ...richOwner, executionId: richId(index + 1), lineage: parent === null ? "root" : "child", parentExecutionId: parent === null ? null : richId(parent + 1) },
      });
    });
    const overlap = nodes.some((node, index) => node.selected && ancestors[index]!.some(ancestor => nodes[ancestor]!.selected));
    const selected = { ...richSelection, tokenScope: "inclusive" as const };
    const result = summarizeRichFacts(richReport(facts), selected);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokenAggregation.eligible).toBe(!overlap);
    if (overlap) expect(result.value.tokens).toBeNull();
    else expect(result.value.tokens?.total.sum).toBe(nodes.reduce((sum, node) => sum + (node.selected ? BigInt(node.amount) : 0n), 0n));
    expect(summarizeRichFacts(richReport(facts.toReversed()), selected)).toEqual(result);
  }));
});
