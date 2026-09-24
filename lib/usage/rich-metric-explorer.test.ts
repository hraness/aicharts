import { expect, test } from "bun:test";
import { evaluateRichMetricQuery, parseRichMetricQuery, RICH_SUPPORTED_METRIC_IDS, type RichMetricQuery } from "./rich-metric-explorer";
import { richFact, richId, richOwner, richReport, richSelection, richUsage } from "./rich-fact-fixtures";
import type { RichFactReport, RichRequest } from "./rich-fact-contract";

const query = (metricIds: readonly string[], change: Partial<RichMetricQuery> = {}): RichMetricQuery =>
  ({ schemaVersion: 1, metricIds, selection: { ...richSelection, window: { ...richSelection.window } }, quantity: "total", ...change });
const measured = (report: RichFactReport, input: RichMetricQuery) => {
  const result = evaluateRichMetricQuery(report, input); if (!result.ok) throw new Error(result.error); return result.value;
};
const request = (index: number, change: Partial<RichRequest> = {}): RichRequest => ({ kind: "request", observationId: richId(index), stage: "terminal",
  outcome: "success", requestedAtMs: 0, dispatchedAtMs: 10, firstTokenAtMs: 20, lastTokenAtMs: 90, terminalAtMs: 100,
  clockUncertaintyMs: 0, retryOf: null, ...change });

test("typed means and nearest-rank quantiles preserve exact wide values and measured denominators", () => {
  const wide = 99_999_999_999_999_999_999_999n;
  const report = richReport([richFact(1, richUsage(1, "0")), richFact(2, richUsage(2, "7")), richFact(3, richUsage(3, wide.toString())),
    richFact(4, request(4), { atMs: 100 })]);
  const result = measured(report, query(["mean-total-tokens-per-request", "token-size-median", "token-size-p90", "token-size-minimum", "token-size-maximum"]));
  expect(result.measures.map(value => value.value)).toEqual([
    { kind: "ratio", numerator: wide + 7n, denominator: 3n }, { kind: "integer", amount: 7n }, { kind: "integer", amount: wide },
    { kind: "integer", amount: 0n }, { kind: "integer", amount: wide },
  ]);
  for (const value of result.measures) expect(value).toMatchObject({ measured: 3, unmeasured: 1, status: "partial", reason: null, sourceKind: "usage" });
  expect(result.observedOnly).toBe(true);
});

test("grain, lineage and per-quantity missingness cannot silently change the cohort", () => {
  const parent = richFact(1, richUsage(1, "100", { tokenScope: "inclusive" }));
  const child = richFact(2, richUsage(2, "20", { tokenScope: "inclusive" }), {
    owner: { ...richOwner, executionId: richId(1_001), lineage: "child", parentExecutionId: richOwner.executionId },
  });
  const report = richReport([parent, child, richFact(3, request(3), { atMs: 100 })]);
  const result = measured(report, query(["mean-total-tokens-per-request", "request-latency-p50"], {
    selection: { ...richSelection, tokenScope: "inclusive" },
  }));
  expect(result.measures[0]).toMatchObject({ value: null, status: "unavailable", reason: "overlapping_executions" });
  expect(result.measures[1]).toMatchObject({ value: { kind: "integer", amount: 90n }, measured: 1 });
  expect(measured(report, query(["mean-total-tokens-per-turn"])).measures[0].reason).toBe("different-grain");
  const reasoning = measured(richReport([richFact(1, richUsage()), richFact(2, richUsage(2, "0", {
    tokens: { ...richUsage().tokens, output: "0", reasoning: "0" },
  }))]), query(["token-size-median"], { quantity: "reasoning" })).measures[0];
  expect(reasoning).toMatchObject({ value: { kind: "integer", amount: 0n }, measured: 1, unmeasured: 1, status: "partial" });
});

test("outcome rates refuse unresolved denominators and expose the exact outcome taxonomy", () => {
  const report = richReport([richFact(1, request(1), { atMs: 100 }), richFact(2, request(2, { outcome: "error", retryOf: richId(1) }), { atMs: 100 }),
    richFact(3, request(3, { stage: "dispatched", outcome: "unknown", terminalAtMs: null, firstTokenAtMs: null, lastTokenAtMs: null }), { atMs: 10 })]);
  const result = measured(report, query(["error-request-rate", "successful-request-count", "failed-request-count", "retry-attempt-count", "request-latency-p50"]));
  expect(result.requestOutcomes).toEqual({ success: 1, error: 1, refusal: 0, cancel: 0, timeout: 0, unknown: 1 });
  expect(result.measures[0]).toMatchObject({ value: null, reason: "unclassified-request-outcomes", measured: 2, unmeasured: 1 });
  expect(result.measures[1]).toMatchObject({ value: { kind: "integer", amount: 1n }, measured: 2, unmeasured: 1 });
  expect(result.measures[2]).toMatchObject({ value: { kind: "integer", amount: 1n }, measured: 2, unmeasured: 1 });
  expect(result.measures[3]).toMatchObject({ value: { kind: "integer", amount: 1n }, measured: 3 });
  expect(result.measures[4].reason).toBe("unclassified-request-outcomes");
  const terminal = richReport(report.facts.slice(0, 2));
  expect(measured(terminal, query(["error-request-rate"])).measures[0].value).toEqual({ kind: "ratio", numerator: 1n, denominator: 2n });
});

test("timing requires exact clocks and context gauges stay separate from sums", () => {
  const report = richReport([
    richFact(1, request(1), { atMs: 100 }), richFact(2, request(2, { clockUncertaintyMs: 1 }), { atMs: 100 }),
    richFact(3, { kind: "context", observationId: richId(3), tokens: "100", limitTokens: "1000" }),
    richFact(4, { kind: "context", observationId: richId(4), tokens: "900", limitTokens: "1000" }),
    richFact(5, { kind: "context", observationId: richId(5), tokens: "200", limitTokens: null }),
  ]);
  const values = measured(report, query(["time-to-first-token", "request-latency-p95", "context-occupancy-p50", "maximum-context-occupancy", "active-wall-time"])).measures;
  expect(values[0]).toMatchObject({ value: { kind: "ratio", numerator: 10n, denominator: 1n }, measured: 1, unmeasured: 1, aggregation: "mean" });
  expect(values[1]).toMatchObject({ value: { kind: "integer", amount: 90n }, measured: 1, unmeasured: 1 });
  expect(values[2].value).toEqual({ kind: "integer", amount: 200n });
  expect(values[3].value).toEqual({ kind: "integer", amount: 900n });
  expect(values[4]).toMatchObject({ value: null, reason: "not-implemented-in-profile" });
});

test("lifecycle recipes expose tool, turn and compaction facts without inferring stages", () => {
  const report = richReport([
    richFact(1, { kind: "tool", observationId: richId(1), stage: "requested", outcome: "unknown" }),
    richFact(2, { kind: "tool", observationId: richId(2), stage: "terminal", outcome: "success" }),
    richFact(3, { kind: "tool", observationId: richId(3), stage: "terminal", outcome: "error" }),
    richFact(4, { kind: "turn", observationId: richId(4), origin: "human", outcome: "completed", startedAtMs: 50, endedAtMs: 200, clockUncertaintyMs: 0, toolCalls: 1 }),
    richFact(5, { kind: "compaction", observationId: richId(5), action: "provider_compact", outcome: "applied", beforeTokens: "100", afterTokens: "40", durationMs: 20 }),
  ]);
  const result = measured(report, query(["tool-requested-count", "tool-completed-count", "tool-failed-count", "observed-turn-duration", "compaction-count", "compaction-duration", "pre-compaction-context", "post-compaction-context"]));
  expect(result.measures.map(value => value.value)).toEqual([
    { kind: "integer", amount: 1n }, { kind: "integer", amount: 1n }, { kind: "integer", amount: 1n },
    { kind: "ratio", numerator: 150n, denominator: 1n }, { kind: "integer", amount: 1n },
    { kind: "ratio", numerator: 20n, denominator: 1n }, { kind: "ratio", numerator: 100n, denominator: 1n },
    { kind: "ratio", numerator: 40n, denominator: 1n },
  ]);
  expect(result.measures.every(value => value.reason === null)).toBe(true);
});

test("tool outcome cohorts count each invocation once and unknown outcomes never become measured zeros", () => {
  const unknown = richFact(1, { kind: "tool", observationId: richId(1), stage: "terminal", outcome: "unknown" });
  const requested = richFact(2, { kind: "tool", observationId: richId(2), stage: "requested", outcome: "unknown" });
  const ids = ["tool-completed-count", "tool-failed-count"];
  for (const facts of [[unknown], [requested], [unknown, requested]]) {
    for (const measure of measured(richReport(facts), query(ids)).measures)
      expect(measure).toMatchObject({ value: null, measured: 0, unmeasured: facts.length, reason: "no-measured-observations", status: "unavailable" });
  }
  const mixed = richReport([unknown, requested,
    richFact(3, { kind: "tool", observationId: richId(3), stage: "terminal", outcome: "success" }),
    richFact(4, { kind: "tool", observationId: richId(4), stage: "terminal", outcome: "timeout" }),
  ]);
  for (const measure of measured(mixed, query(ids)).measures)
    expect(measure).toMatchObject({ value: { kind: "integer", amount: 1n }, measured: 2, unmeasured: 2, status: "partial" });
  const classified = richReport(mixed.facts.slice(2, 3));
  expect(measured(classified, query(ids)).measures[1]).toMatchObject({ value: { kind: "integer", amount: 0n }, measured: 1, unmeasured: 0, reason: null });
});

test("revisions, copies and retractions change values once and preserve terminal-turn denominators", () => {
  const first = richFact(1, richUsage(1, "10")), corrected = { ...first, revision: 1, value: richUsage(1, "40") };
  const removed = richFact(2, richUsage(2, "999")), deletion = { ...removed, revision: 1, value: null };
  const report = richReport([first, corrected, { ...corrected }, removed, deletion,
    richFact(3, { kind: "turn", observationId: richId(3), origin: "human", outcome: "completed", startedAtMs: 10, endedAtMs: 200, clockUncertaintyMs: 0, toolCalls: 2 }),
    richFact(4, { kind: "turn", observationId: richId(4), origin: "unknown", outcome: "aborted", startedAtMs: 0, endedAtMs: 200, clockUncertaintyMs: 0, toolCalls: 7 }),
  ]);
  const result = measured(report, query(["mean-total-tokens-per-request", "runtime-per-measured-turn", "completed-turn-count", "aborted-turn-count"]));
  expect(result.retractedFacts).toBe(1);
  expect(result.measures[0].value).toEqual({ kind: "ratio", numerator: 40n, denominator: 1n });
  expect(result.measures[1]).toMatchObject({ value: { kind: "ratio", numerator: 190n, denominator: 1n }, measured: 1, unmeasured: 0 });
  expect(result.measures[2]).toMatchObject({ value: { kind: "integer", amount: 1n }, measured: 2 });
  expect(result.measures[3]).toMatchObject({ value: { kind: "integer", amount: 1n }, measured: 2 });
  const reverse = measured({ ...report, facts: [...report.facts].reverse() }, result.query);
  expect(reverse).toEqual(result);
});

test("empty and unsupported sources never turn absent populations into measured zeros", () => {
  const report = richReport();
  const empty = measured(report, query(["observed-turn-count", "error-request-rate", "mean-total-tokens-per-request"]));
  expect(empty.measures.every(value => value.value === null && value.reason === "no-measured-observations")).toBe(true);
  const unsupported = measured({ ...report, coverage: { ...report.coverage, turn: "unsupported" } }, query(["observed-turn-count"]));
  expect(unsupported.measures[0].reason).toBe("unsupported-source-kind");
  const zero = richReport([richFact(1, request(1), { atMs: 100 })]);
  expect(measured(zero, query(["retry-attempt-count", "failed-request-count"])).measures.map(value => value.value))
    .toEqual([{ kind: "integer", amount: 0n }, { kind: "integer", amount: 0n }]);
});

test("queries reject accessors, coercions, duplicate or excessive IDs before touching report data", () => {
  let invoked = 0;
  const hostile = { get schemaVersion() { invoked++; return 1; } };
  const coercion = { toString() { invoked++; return "request"; } };
  const base = query(["token-size-median"]);
  const sparse = new Array(2); sparse[0] = "token-size-median";
  for (const input of [{ ...base, extra: true }, { ...base, quantity: coercion }, { ...base, selection: { ...base.selection, grain: coercion } },
    query(["unknown"]), query(Array(33).fill("token-size-median")), query(["token-size-median", "token-size-median"]), query(sparse), hostile]) {
    expect(parseRichMetricQuery(input)).toBeNull();
    expect(evaluateRichMetricQuery(hostile, input)).toEqual({ ok: false, error: "invalid_rich_metric_query" });
  }
  expect(invoked).toBe(0);
  const parsed = parseRichMetricQuery(base)!;
  expect(Object.isFrozen(parsed.selection.window)).toBe(true); expect(Object.isFrozen(parsed.metricIds)).toBe(true);
  const report = richReport([richFact(1)]), input = query(["token-size-median"]), result = measured(report, input);
  (input.selection.window as { startMs: number }).startMs = 999;
  (report.facts[0].value as { tokens: { output: string } }).tokens.output = "999";
  expect(result.query.selection.window.startMs).toBe(0); expect(result.measures[0].value).toEqual({ kind: "integer", amount: 10n });
});

test("every implemented metric maps to a checked catalog row without inventing a value", () => {
  for (let index = 0; index < RICH_SUPPORTED_METRIC_IDS.length; index += 32) {
    const ids = RICH_SUPPORTED_METRIC_IDS.slice(index, index + 32), result = measured(richReport(), query(ids));
    expect(result.measures.map(value => value.id)).toEqual(ids);
    expect(result.measures.every(value => value.status === "unavailable" && value.value === null)).toBe(true);
  }
});
