import { expect, test } from "bun:test";
import { RICH_FACT_MAX_BYTES, RICH_FACT_MAX_COUNTER, RICH_FACT_MAX_EXECUTIONS, RICH_FACT_MAX_LINEAGE_DEPTH, RICH_FACT_MAX_RECORDS, type RichFactReport, type RichRequest, type RichSelection } from "./rich-fact-contract";
import { decodeRichFactReport, mergeRichFactReports, parseRichFactReport, summarizeRichFacts } from "./rich-facts";
import { richFact, richId, richOwner, richReport, richSelection, richUsage } from "./rich-fact-fixtures";

function summary(report: RichFactReport, selection: RichSelection = richSelection) {
  const result = summarizeRichFacts(report, selection);
  if (!result.ok) throw new Error(result.error);
  if (result.value.tokens === null) throw new Error(result.value.tokenAggregation.reason ?? "ineligible_tokens");
  return { ...result.value, tokens: result.value.tokens };
}
const terminal = (index: number, change: Partial<RichRequest> = {}): RichRequest => ({ kind: "request", observationId: richId(index), stage: "terminal", outcome: "success",
  requestedAtMs: 100, dispatchedAtMs: 110, firstTokenAtMs: 120, lastTokenAtMs: 190, terminalAtMs: 200, clockUncertaintyMs: 0, retryOf: null, ...change });

test("rich facts preserve exact counters, inclusive reasoning and unknown cache TTL", () => {
  const u = richUsage();
  const report = richReport([richFact(1, { ...u, tokens: { ...u.tokens, inputUncached: "5", cacheRead: "3", cacheWriteUnknown: "7", output: "20", reasoning: "8" } })]);
  const result = summary(report);
  expect(result.tokens.total.sum).toBe(35n);
  expect(result.tokens.output.sum).toBe(20n);
  expect(result.tokens.reasoning.sum).toBe(8n);
  expect(result.tokens.cacheWriteUnknown.sum).toBe(7n);
  expect(result.observedOnly).toBe(true);
  expect(parseRichFactReport(richReport([richFact(1, richUsage(1, String(RICH_FACT_MAX_COUNTER)))])).ok).toBe(true);
  expect(parseRichFactReport(richReport([richFact(1, richUsage(1, String(RICH_FACT_MAX_COUNTER + 1n)))])).ok).toBe(false);
  for (const reasoning of ["21", "-0", "00", "private-content"]) {
    expect(parseRichFactReport(richReport([richFact(1, { ...u, tokens: { ...u.tokens, output: "20", reasoning } })])).ok).toBe(false);
  }
});

test("direct and inclusive views never count the same lineage twice", () => {
  const report = richReport([
    richFact(1, richUsage(1, "80")),
    richFact(2, richUsage(1, "100", { tokenScope: "inclusive" })),
    richFact(3, richUsage(3, "20"), { owner: { ...richOwner, executionId: richId(2_000), lineage: "child", parentExecutionId: richOwner.executionId } }),
    richFact(4, richUsage(4, "999"), { owner: { ...richOwner, executionId: richId(3_000), lineage: "unknown" } }),
  ]);
  expect(summary(report).tokens.total.sum).toBe(1_099n);
  expect(summary(report, { ...richSelection, tokenScope: "inclusive" }).tokens.total.sum).toBe(100n);
  const root = summary(report, { ...richSelection, lineage: "root" });
  expect(root.tokens.total.sum).toBe(80n);
  expect(root.excludedUnknownLineage).toBe(1);
  expect(summary(report, { ...richSelection, lineage: "child" }).tokens.total.sum).toBe(20n);
});

test("inclusive ancestor overlap removes token aggregates while preserving independent metrics", () => {
  const parent = richFact(1, richUsage(1, "100", { tokenScope: "inclusive" }));
  const child = richFact(2, richUsage(2, "20", { tokenScope: "inclusive" }), {
    owner: { ...richOwner, executionId: richId(2_000), lineage: "child", parentExecutionId: richOwner.executionId },
  });
  const report = richReport([parent, child, richFact(3, terminal(3))]);
  const result = summarizeRichFacts(report, { ...richSelection, tokenScope: "inclusive" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({ tokenAggregation: { eligible: false, reason: "overlapping_executions" }, tokens: null });
  expect(result.value.requests.success).toBe(1);
  expect(result.value.requests.latencyMs.observedMean).toEqual({ numerator: 90n, denominator: 1n });
  const selected = summary(report, { ...richSelection, tokenScope: "inclusive", executionId: richOwner.executionId });
  expect(selected.tokens.total.sum).toBe(100n);
  expect(selected.tokenAggregation).toEqual({ eligible: true, reason: null });
});

test("inclusive disjointness cannot be inferred from omitted or unknown parents", () => {
  const root = richFact(1, richUsage(1, "100", { tokenScope: "inclusive" }));
  for (const ownership of [
    { lineage: "unknown" as const, parentExecutionId: null },
    { lineage: "child" as const, parentExecutionId: null },
    { lineage: "child" as const, parentExecutionId: richId(9_999) },
  ]) {
    const other = richFact(2, richUsage(2, "20", { tokenScope: "inclusive" }), { owner: { ...richOwner, executionId: richId(2_000), ...ownership } });
    const result = summarizeRichFacts(richReport([root, other]), { ...richSelection, tokenScope: "inclusive" });
    expect(result.ok && result.value).toMatchObject({ tokenAggregation: { eligible: false, reason: "incomplete_lineage" }, tokens: null });
  }
  const unknown = [1, 2].map(index => richFact(index, richUsage(index, "20", { tokenScope: "unknown" }), { owner: { ...richOwner, executionId: richId(index) } }));
  const result = summarizeRichFacts(richReport(unknown), { ...richSelection, tokenScope: "unknown" });
  expect(result.ok && result.value).toMatchObject({ tokenAggregation: { eligible: false, reason: "unknown_token_scope" }, tokens: null });
  expect(summary(richReport(unknown), { ...richSelection, tokenScope: "unknown", executionId: richId(1) }).tokens.total.sum).toBe(20n);
});

test("inclusive sibling branches require complete retained root evidence even outside the selected window", () => {
  const retainedRoot = richFact(1, richUsage(1), { atMs: 100 });
  const children = [2, 3].map(index => richFact(index, richUsage(index, String(index * 10), { tokenScope: "inclusive" }), {
    owner: { ...richOwner, executionId: richId(index), lineage: "child", parentExecutionId: richOwner.executionId },
  }));
  const selected = { ...richSelection, tokenScope: "inclusive" as const, lineage: "child" as const, window: { startMs: 150, endMs: 10_000 } };
  const disjoint = summary(richReport([retainedRoot, ...children]), selected);
  expect(disjoint.tokenAggregation).toEqual({ eligible: true, reason: null });
  expect(disjoint.tokens.total.sum).toBe(50n);
  const missing = summarizeRichFacts(richReport(children), selected);
  expect(missing.ok && missing.value).toMatchObject({ tokenAggregation: { eligible: false, reason: "incomplete_lineage" }, tokens: null });
  const roots = children.map(fact => ({ ...fact, owner: { ...fact.owner, lineage: "root" as const, parentExecutionId: null } }));
  expect(summary(richReport(roots), { ...richSelection, tokenScope: "inclusive" }).tokens.total.sum).toBe(50n);
  const ancestor = { ...children[1]!, owner: { ...children[1]!.owner, parentExecutionId: children[0]!.owner.executionId } };
  const overlapping = summarizeRichFacts(richReport([retainedRoot, children[0]!, ancestor]), selected);
  expect(overlapping.ok && overlapping.value).toMatchObject({ tokenAggregation: { eligible: false, reason: "overlapping_executions" }, tokens: null });
});

test("replay, correction and retraction use the latest exact head independently of input order", () => {
  const first = richFact(1), corrected = richFact(1, richUsage(1, "30"), { revision: 2 });
  const retracted = { ...corrected, revision: 3, value: null };
  expect(summary(richReport([corrected, first, corrected])).tokens.total.sum).toBe(30n);
  const result = summary(richReport([retracted, first, corrected]));
  expect(result.tokens.total.sum).toBe(0n);
  expect(result.tokens.total.observedMean).toBeNull();
  expect(result.retractedFacts).toBe(1);
  expect(parseRichFactReport(richReport([corrected, { ...corrected, value: richUsage(1, "31") }]))).toEqual({ ok: false, error: "conflicting_fact" });
  expect(parseRichFactReport(richReport([first, { ...corrected, owner: { ...richOwner, accountId: richId(5) } }]))).toEqual({ ok: false, error: "conflicting_owner" });
  expect(parseRichFactReport(richReport([first, retracted, { ...corrected, revision: 4, value: richUsage(2) }]))).toEqual({ ok: false, error: "conflicting_fact" });
});

test("duplicate observations under different fact IDs and incompatible source merges refuse", () => {
  expect(parseRichFactReport(richReport([richFact(1), richFact(2, richUsage(1))]))).toEqual({ ok: false, error: "conflicting_fact" });
  const left = richReport([richFact(1)]);
  expect(mergeRichFactReports(left, left)).toEqual(parseRichFactReport(left));
  const source = { ...left.provenance, sourceId: richId(888) };
  const right = { ...left, provenance: source, facts: left.facts.map(fact => ({ ...fact, provenance: source })) };
  expect(mergeRichFactReports(left, right)).toEqual({ ok: false, error: "incompatible_source" });
});

test("each latency and token statistic retains its own measured cohort", () => {
  const knownZero = richUsage(3, "0");
  const report = richReport([
    richFact(1, terminal(1)),
    richFact(2, terminal(2, { firstTokenAtMs: null, lastTokenAtMs: null, clockUncertaintyMs: null, outcome: "unknown" })),
    richFact(3, { ...knownZero, tokens: { ...knownZero.tokens, reasoning: "0" } }),
    richFact(4, richUsage(4, "20")),
  ]);
  const result = summary(report);
  expect(result.requests.latencyMs).toMatchObject({ measured: 1, unmeasured: 1, observedMean: { numerator: 90n, denominator: 1n } });
  expect(result.requests.firstTokenMs.observedMean).toEqual({ numerator: 10n, denominator: 1n });
  expect(result.requests.generationMs.observedMean).toEqual({ numerator: 70n, denominator: 1n });
  expect(result.requests.unknownOutcome).toBe(1);
  expect(result.tokens.output.observedMean).toEqual({ numerator: 20n, denominator: 2n });
  expect(result.tokens.reasoning).toMatchObject({ measured: 1, unmeasured: 3, observedMean: { numerator: 0n, denominator: 1n } });
  expect(result.tokens.output.unmeasured).toBe(2);
});

test("requested tools and completed turns do not become dispatched or successful requests", () => {
  const report = richReport([
    richFact(1, { kind: "tool", observationId: richId(1), stage: "requested", outcome: "unknown" }),
    richFact(2, { kind: "turn", observationId: richId(2), outcome: "completed", origin: "unknown", startedAtMs: 100, endedAtMs: 200, clockUncertaintyMs: 0, toolCalls: null }),
    richFact(3, { kind: "turn", observationId: richId(3), outcome: "aborted", origin: "automation", startedAtMs: 100, endedAtMs: 200, clockUncertaintyMs: 0, toolCalls: 0 }),
  ]);
  const result = summary(report);
  expect(result.tools).toMatchObject({ requested: 1, dispatched: 0, terminal: 0, success: 0 });
  expect(result.requests.success).toBe(0);
  expect(result.turns).toMatchObject({ completed: 1, aborted: 1, unknownOrigin: 1 });
  expect(result.turns.completedRuntimeMs.observedMean).toEqual({ numerator: 100n, denominator: 1n });
  expect(result.turns.completedToolCalls).toMatchObject({ measured: 0, unmeasured: 1, observedMean: null });
  expect(parseRichFactReport(richReport([richFact(1, { kind: "tool", observationId: richId(1), stage: "requested", outcome: "success" })])).ok).toBe(false);
});

test("planned and failed compactions cannot claim reclaimed tokens", () => {
  const facts = (["applied", "planned", "failed", "skipped"] as const).map((outcome, i) => richFact(i + 1, {
    kind: "compaction", observationId: richId(i + 1), action: "provider_compact", outcome, beforeTokens: "100", afterTokens: "20", durationMs: 50,
  }));
  expect(summary(richReport(facts)).compactions).toMatchObject({ applied: 1, planned: 1, failed: 1, skipped: 1, estimatedReclaimedTokens: { sum: 80n, measured: 1 } });
});

test("malformed timing, unsupported bases and fabricated completion refuse", () => {
  for (const change of [
    { firstTokenAtMs: 90 }, { dispatchedAtMs: null, firstTokenAtMs: 100 }, { lastTokenAtMs: 201 },
    { requestedAtMs: -0 }, { clockUncertaintyMs: -1 }, { stage: "requested" as const },
  ]) expect(parseRichFactReport(richReport([richFact(1, terminal(1, change))])).ok).toBe(false);
  expect(parseRichFactReport(richReport([richFact(1, { kind: "span", observationId: richId(1), phase: "inference", basis: "request_lifecycle", startMs: 100, endMs: 200, clockUncertaintyMs: 0 })])).ok).toBe(false);
});

test("lineage cycles, foreign owners and excessive known depth refuse", () => {
  const child = (index: number, parent: number | null) => richFact(index, richUsage(index), { owner: { ...richOwner, executionId: richId(index), lineage: parent === null ? "root" : "child", parentExecutionId: parent === null ? null : richId(parent) } });
  expect(parseRichFactReport(richReport([child(1, 2), child(2, 1)]))).toEqual({ ok: false, error: "invalid_lineage" });
  expect(parseRichFactReport(richReport([child(1, null), { ...child(2, 1), owner: { ...child(2, 1).owner, accountId: richId(9) } }]))).toEqual({ ok: false, error: "conflicting_owner" });
  const chain = Array.from({ length: RICH_FACT_MAX_LINEAGE_DEPTH + 1 }, (_, i) => child(i + 1, i === 0 ? null : i));
  expect(parseRichFactReport(richReport(chain)).ok).toBe(true);
  const dangling = chain.map((fact, index) => index === 0 ? { ...fact, owner: { ...fact.owner, lineage: "child" as const, parentExecutionId: richId(9_999) } } : fact);
  expect(parseRichFactReport(richReport(dangling))).toEqual({ ok: false, error: "invalid_lineage" });
  expect(parseRichFactReport(richReport([...chain, child(RICH_FACT_MAX_LINEAGE_DEPTH + 2, RICH_FACT_MAX_LINEAGE_DEPTH + 1)]))).toEqual({ ok: false, error: "invalid_lineage" });
  expect(parseRichFactReport(richReport([richFact(1, terminal(1, { retryOf: richId(2) })), richFact(2, terminal(2, { retryOf: richId(1) }))]))).toEqual({ ok: false, error: "invalid_lineage" });
  expect(parseRichFactReport(richReport([richFact(1, terminal(1, { retryOf: richId(2) }))])).ok).toBe(true);
});

test("execution cardinality admits its exact boundary and refuses one more", () => {
  const facts = Array.from({ length: RICH_FACT_MAX_EXECUTIONS + 1 }, (_, i) => richFact(i + 1, richUsage(i + 1), {
    owner: { ...richOwner, executionId: richId(i + 1) },
  }));
  expect(parseRichFactReport(richReport(facts.slice(0, -1))).ok).toBe(true);
  expect(parseRichFactReport(richReport(facts))).toEqual({ ok: false, error: "record_limit" });
});

test("privacy and shape guards refuse accessors, foreign fields, sparse arrays and capacity excess", () => {
  let invoked = false;
  const report = richReport([richFact(1)]);
  expect(parseRichFactReport({ ...report, get facts() { invoked = true; return []; } }).ok).toBe(false);
  expect(parseRichFactReport({ ...report, facts: [Object.defineProperty({ ...richFact(1) }, "value", { get() { invoked = true; return richUsage(); }, enumerable: true })] }).ok).toBe(false);
  expect(invoked).toBe(false);
  expect(parseRichFactReport({ ...report, prompt: "private-canary" })).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(parseRichFactReport({ ...report, facts: new Array(1) }).ok).toBe(false);
  expect(parseRichFactReport({ ...report, facts: new Array(RICH_FACT_MAX_RECORDS + 1) })).toEqual({ ok: false, error: "record_limit" });
  expect(decodeRichFactReport(" ".repeat(RICH_FACT_MAX_BYTES + 1))).toEqual({ ok: false, error: "body_limit" });
  const parsed = parseRichFactReport(report);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value).not.toBe(report);
  expect(parsed.value.facts[0]!.owner).not.toBe(report.facts[0]!.owner);
});

test("the retention interval is explicit and half open", () => {
  expect(parseRichFactReport(richReport([richFact(1, richUsage(), { atMs: 10_000 })])).ok).toBe(false);
  expect(summary(richReport([richFact(1)]), { ...richSelection, window: { startMs: 201, endMs: 10_000 } }).tokens.total.observedMean).toBeNull();
  expect(summarizeRichFacts(richReport(), { ...richSelection, window: { startMs: 0, endMs: 10_001 } })).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(summarizeRichFacts(richReport(), { ...richSelection, executionId: "native-private-session" })).toEqual({ ok: false, error: "invalid_rich_facts" });
});
