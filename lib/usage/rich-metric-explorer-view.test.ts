import { expect, test } from "bun:test";
import { richFact, richId, richOwner, richReport, richUsage } from "./rich-fact-fixtures";
import type { RichFact, RichFactReport, RichRequest } from "./rich-fact-contract";
import { evaluateRichMetricQuery, RICH_SUPPORTED_METRIC_IDS } from "./rich-metric-explorer";
import { evaluateRichExplorerQuery, isRichTimeZone, MAX_RICH_DRILLDOWN_ROWS, MAX_RICH_HISTOGRAM_BINS, openRichFactsDocument, parseRichExplorerQuery, richDistribution, richExplorerResultJson,
  type RichExplorerQuery, type RichFactsDocument } from "./rich-metric-explorer-view";
import { SESSION_EXAMPLE } from "./session-example";

const HOUR = 3_600_000;
const baseSelection = { window: { startMs: 0, endMs: 10_000 }, grain: "request", tokenScope: "direct", lineage: "all" } as const;
const request = (index: number, change: Partial<RichRequest> = {}): RichRequest => ({ kind: "request", observationId: richId(index), stage: "terminal",
  outcome: "success", requestedAtMs: 0, dispatchedAtMs: 10, firstTokenAtMs: 20, lastTokenAtMs: 90, terminalAtMs: 100, clockUncertaintyMs: 0, retryOf: null, ...change });
const document = (report: RichFactReport, timeZone: string | null = null): RichFactsDocument => ({ report, timeZone, origin: "rich-facts-v1", revision: "test:0:0" });
const query = (metricId: string, change: Partial<RichExplorerQuery> = {}): RichExplorerQuery => ({
  schemaVersion: 1, metricId, quantity: "total", selection: { window: { startMs: 0, endMs: 10_000 }, grain: "request", tokenScope: "direct", lineage: "all" },
  filters: { provider: "*", model: "*", session: "*" }, groupBy: [], topK: 50, timeZone: null, ...change });
const evaluated = (input: RichFactsDocument, definition: RichExplorerQuery) => {
  const result = evaluateRichExplorerQuery(input, definition); if (!result.ok) throw new Error(result.error); return result.value;
};
function xorshift(seed: number) { let state = seed >>> 0 || 1; return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4_294_967_296; }; }
/** A seeded report with every fact kind across two sessions, three models and several hours. */
function generatedReport(seed: number, count = 60): RichFactReport {
  const random = xorshift(seed), facts: RichFact[] = [];
  const owners = [richOwner, { ...richOwner, provider: "claude_code" as const, executionId: richId(2_000) }];
  const models = { codex: ["gpt-5.5", "gpt-5.3-codex", null], claude_code: ["claude-sonnet-4-6", "claude-opus-4-6", null] } as const;
  for (let index = 1; index <= count; index++) {
    const owner = owners[index % 2]!, atMs = 60_000 + Math.floor(random() * (8 * HOUR - 60_000)), pick = random();
    const base = { owner, atMs };
    if (pick < 0.4) {
      const model = models[owner.provider === "codex" ? "codex" : "claude_code"][index % 3] ?? null, output = 100 + Math.floor(random() * 5_000);
      facts.push(richFact(index, richUsage(index, String(output), { model, modelBasis: model === null ? "unknown" : "response",
        tokens: { inputUncached: String(Math.floor(random() * 300)), cacheRead: "0", cacheWrite5m: "0", cacheWrite1h: "0", cacheWriteUnknown: "0", output: String(output), reasoning: random() < 0.5 ? null : String(Math.floor(random() * 90)) } }), base));
    }
    else if (pick < 0.6) {
      const latency = 100 + Math.floor(random() * 900);
      facts.push(richFact(index, request(index, { requestedAtMs: atMs - latency - 50, dispatchedAtMs: atMs - latency, firstTokenAtMs: atMs - latency + 10, lastTokenAtMs: atMs, terminalAtMs: atMs, clockUncertaintyMs: random() < 0.8 ? 0 : 5 }), base));
    }
    else if (pick < 0.75) facts.push(richFact(index, { kind: "turn", observationId: richId(index), origin: "human", outcome: random() < 0.8 ? "completed" : "aborted", startedAtMs: atMs - 200 - Math.floor(random() * 3_000), endedAtMs: atMs, clockUncertaintyMs: 0, toolCalls: 1 }, base));
    else if (pick < 0.85) facts.push(richFact(index, { kind: "context", observationId: richId(index), tokens: String(Math.floor(random() * 100_000)), limitTokens: "200000" }, base));
    else if (pick < 0.95) facts.push(richFact(index, { kind: "compaction", observationId: richId(index), action: "provider_compact", outcome: "applied", beforeTokens: String(50_000 + Math.floor(random() * 50_000)), afterTokens: String(Math.floor(random() * 20_000)), durationMs: Math.floor(random() * 4_000) }, base));
    else facts.push(richFact(index, { kind: "tool", observationId: richId(index), stage: "terminal", outcome: random() < 0.5 ? "success" : "error" }, base));
  }
  return { ...richReport(facts), window: { startMs: 0, endMs: 8 * HOUR + 1 } };
}
const window = { startMs: 0, endMs: 8 * HOUR + 1 };

test("an ungrouped explorer query reproduces the rich recipe for every supported metric", () => {
  for (const seed of [7, 19, 311]) {
    const report = generatedReport(seed);
    for (const grain of ["request", "turn"] as const) for (const metricId of RICH_SUPPORTED_METRIC_IDS) {
      const definition = query(metricId, { selection: { ...baseSelection, window, grain } });
      const expected = evaluateRichMetricQuery(report, { schemaVersion: 1, quantity: "total", metricIds: [metricId], selection: { window, grain, tokenScope: "direct", lineage: "all", executionId: null } });
      if (!expected.ok) throw new Error(expected.error);
      const actual = evaluated(document(report), definition);
      expect(actual.measure).toEqual(expected.value.measures[0]!);
      expect(actual.reason).toBe(expected.value.measures[0]!.reason);
      expect(actual.groups).toHaveLength(1);
      expect(actual.groups[0]).toMatchObject({ key: "[]", label: "All selected facts", measure: expected.value.measures[0]! });
      expect(actual.revision).toBe("test:0:0");
    }
  }
});

test("sample distributions reproduce the exact nearest-rank quantiles of the evaluated recipe", () => {
  const percentiles: Record<string, keyof NonNullable<ReturnType<typeof richDistribution>>> = {
    "token-size-minimum": "minimum", "token-size-median": "p50", "token-size-p90": "p90", "token-size-p95": "p95", "token-size-p99": "p99", "token-size-maximum": "maximum",
    "request-latency-p50": "p50", "request-latency-p95": "p95", "request-latency-p99": "p99",
    "context-occupancy-p50": "p50", "context-occupancy-p90": "p90", "maximum-context-occupancy": "maximum", "observed-turn-duration": "p50",
  };
  let checked = 0;
  for (const seed of [3, 42, 1_000]) {
    const report = generatedReport(seed, 120);
    for (const [metricId, statistic] of Object.entries(percentiles)) for (const quantity of ["total", "output", "reasoning"] as const) {
      const result = evaluated(document(report), query(metricId, { quantity, selection: { ...baseSelection, window, grain: metricId === "observed-turn-duration" ? "turn" : "request" } }));
      if (result.measure.value === null) { expect(result.distribution).toBeNull(); continue; }
      expect(result.distribution).not.toBeNull();
      const value = result.measure.value.kind === "integer" ? result.measure.value.amount : null;
      const expected = result.distribution![statistic];
      if (metricId === "observed-turn-duration") expect(result.measure.value.kind).toBe("ratio");
      else { expect(expected).toBe(value); checked++; }
      expect(result.distribution!.measured).toBe(result.measure.measured);
      expect(result.distribution!.unmeasured).toBe(result.measure.unmeasured);
      expect(result.distribution!.bins.length).toBeLessThanOrEqual(MAX_RICH_HISTOGRAM_BINS);
      expect(result.distribution!.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(result.distribution!.measured);
      expect(result.samples.length).toBeLessThanOrEqual(MAX_RICH_DRILLDOWN_ROWS);
      expect(result.sampledFacts).toBe(result.distribution!.measured + result.distribution!.unmeasured);
      for (let index = 1; index < result.samples.length; index++) {
        const a = result.samples[index - 1]!.value, b = result.samples[index]!.value;
        if (a !== null && b !== null) expect(a >= b).toBe(true);
        if (a === null) expect(b).toBeNull();
      }
    }
  }
  expect(checked).toBeGreaterThan(30);
  const means = evaluated(document(generatedReport(5)), query("mean-total-tokens-per-request", { selection: { ...baseSelection, window } }));
  expect(means.distribution?.mean).toEqual(means.measure.value?.kind === "ratio" ? { numerator: means.measure.value.numerator, denominator: means.measure.value.denominator } : null);
});

test("histograms keep integer edges, cover every measured value once and never exceed the bin cap", () => {
  const empty = richDistribution([null, null]);
  expect(empty).toMatchObject({ measured: 0, unmeasured: 2, sum: 0n, mean: null, minimum: null, p50: null, maximum: null, bins: [] });
  const narrow = richDistribution([3n, 3n, 5n, null]);
  expect(narrow.bins).toEqual([{ lower: 3n, upper: 3n, count: 2 }, { lower: 4n, upper: 4n, count: 0 }, { lower: 5n, upper: 5n, count: 1 }]);
  const random = xorshift(99);
  for (let trial = 0; trial < 100; trial++) {
    const values = Array.from({ length: Math.floor(random() * 60) }, () => random() < 0.1 ? null : BigInt(Math.floor(random() * 1_000_000)) * (random() < 0.05 ? 1_000_000_000_000n : 1n));
    const view = richDistribution(values);
    expect(view.bins.length).toBeLessThanOrEqual(MAX_RICH_HISTOGRAM_BINS);
    expect(view.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(view.measured);
    for (let index = 0; index < view.bins.length; index++) {
      const bin = view.bins[index]!;
      expect(bin.upper >= bin.lower).toBe(true);
      if (index > 0) expect(bin.lower).toBe(view.bins[index - 1]!.upper + 1n);
      expect(values.filter(value => value !== null && value >= bin.lower && value <= bin.upper)).toHaveLength(bin.count);
    }
    if (view.measured > 0) { expect(view.bins[0]!.lower).toBe(view.minimum!); expect(view.bins.at(-1)!.upper >= view.maximum!).toBe(true); }
  }
});

test("session, provider and model dimensions partition facts and conserve integer counts", () => {
  const report = generatedReport(11, 80);
  const total = evaluated(document(report), query("successful-request-count", { selection: { ...baseSelection, window } }));
  for (const groupBy of [["session"], ["provider"], ["model"], ["session", "model"]] as const) {
    const grouped = evaluated(document(report), query("successful-request-count", { selection: { ...baseSelection, window }, groupBy: [...groupBy] }));
    expect(grouped.measure).toEqual(total.measure);
    expect(grouped.omittedGroups).toBe(0);
    expect(grouped.groups.reduce((sum, group) => sum + group.facts, 0)).toBe(report.facts.length);
    let sum = 0n;
    for (const group of grouped.groups) { expect(group.dimensions).toHaveLength(groupBy.length); if (group.measure.value?.kind === "integer") sum += group.measure.value.amount; }
    expect(sum).toBe(total.measure.value?.kind === "integer" ? total.measure.value.amount : -1n);
    for (let index = 1; index < grouped.groups.length; index++) {
      const a = grouped.groups[index - 1]!.measure.value, b = grouped.groups[index]!.measure.value;
      if (a?.kind === "integer" && b?.kind === "integer") expect(a.amount >= b.amount).toBe(true);
      if (a === null) expect(b).toBeNull();
    }
  }
  const sessions = evaluated(document(report), query("successful-request-count", { selection: { ...baseSelection, window }, groupBy: ["session"], topK: 1 }));
  expect(sessions.groups).toHaveLength(1);
  expect(sessions.totalGroups).toBe(2);
  expect(sessions.omittedGroups).toBe(1);
  expect(sessions.groups[0]!.label).toMatch(/^(Codex|Claude Code) · [0-9a-f]{4}…[0-9a-f]{4}$/u);
  expect(sessions.facets.sessions.map(session => session.executionId)).toEqual([richId(1_000), richId(2_000)]);
  expect(sessions.facets.providers).toEqual(["claude_code", "codex"]);
  expect(sessions.facets.models).toEqual(["claude-opus-4-6", "claude-sonnet-4-6", "gpt-5.3-codex", "gpt-5.5"]);
  const filtered = evaluated(document(report), query("successful-request-count", { selection: { ...baseSelection, window }, filters: { provider: "codex", model: "*", session: "*" }, groupBy: ["provider"] }));
  expect(filtered.groups).toHaveLength(1);
  expect(filtered.groups[0]!.dimensions).toEqual(["codex"]);
  const bySession = evaluated(document(report), query("successful-request-count", { selection: { ...baseSelection, window }, filters: { provider: "*", model: "*", session: richId(2_000) } }));
  expect(bySession.groups[0]!.facts).toBe(report.facts.filter(fact => fact.owner.executionId === richId(2_000)).length);
  const model = evaluated(document(report), query("token-size-median", { selection: { ...baseSelection, window }, filters: { provider: "*", model: "gpt-5.5", session: "*" }, groupBy: ["model"] }));
  expect(model.groups.map(group => group.dimensions)).toEqual([["gpt-5.5"]]);
  const modelOnly = evaluated(document(report), query("successful-request-count", { selection: { ...baseSelection, window }, filters: { provider: "*", model: "gpt-5.5", session: "*" } }));
  expect(modelOnly.measure).toMatchObject({ value: null, status: "unavailable" });
  expect(modelOnly.groups.map(group => group.facts)).toEqual([report.facts.filter(fact => fact.value?.kind === "usage" && fact.value.model === "gpt-5.5").length]);
  expect(evaluated(document(report), query("token-size-median", { selection: { ...baseSelection, window }, filters: { provider: "devin", model: "*", session: "*" } }))).toMatchObject({ reason: "no-groups", groups: [], distribution: null });
});

test("calendar dimensions use only the declared time zone and refuse when none is declared", () => {
  const facts = [
    richFact(1, richUsage(1, "10"), { atMs: Date.UTC(2026, 0, 1, 3, 30) }),
    richFact(2, richUsage(2, "20"), { atMs: Date.UTC(2026, 0, 1, 4, 10) }),
    richFact(3, richUsage(3, "30"), { atMs: Date.UTC(2026, 0, 2, 3, 59) }),
    richFact(4, richUsage(4, "40"), { atMs: Date.UTC(2026, 0, 2, 4, 0) }),
  ];
  const report = { ...richReport(facts), window: { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 0, 3) } };
  const selection = { ...baseSelection, window: report.window };
  const refused = evaluated(document(report, null), query("token-size-median", { selection, groupBy: ["local-day"], timeZone: null }));
  expect(refused).toMatchObject({ reason: "time-zone-unknown", groups: [], measure: { value: null, status: "unavailable" } });
  const utc = evaluated(document(report, "UTC"), query("token-size-median", { selection, groupBy: ["local-day", "hour-of-day"], timeZone: "UTC" }));
  expect(utc.groups.map(group => [group.dimensions, group.measure.value])).toEqual([
    [["2026-01-02", "04:00"], { kind: "integer", amount: 40n }], [["2026-01-02", "03:00"], { kind: "integer", amount: 30n }],
    [["2026-01-01", "04:00"], { kind: "integer", amount: 20n }], [["2026-01-01", "03:00"], { kind: "integer", amount: 10n }],
  ]);
  const puertoRico = evaluated(document(report, "America/Puerto_Rico"), query("token-size-median", { selection, groupBy: ["local-day"], timeZone: "America/Puerto_Rico" }));
  expect(puertoRico.groups.map(group => [group.dimensions, group.measure.value])).toEqual([
    [["2026-01-02"], { kind: "integer", amount: 40n }], [["2026-01-01"], { kind: "integer", amount: 20n }], [["2025-12-31"], { kind: "integer", amount: 10n }],
  ]);
  const hours = evaluated(document(report, "America/Puerto_Rico"), query("token-size-median", { selection, groupBy: ["hour-of-day"], timeZone: "America/Puerto_Rico" }));
  expect(hours.groups.map(group => [group.dimensions[0], group.measure.value])).toEqual([["00:00", { kind: "integer", amount: 20n }], ["23:00", { kind: "integer", amount: 10n }]]);
  expect(isRichTimeZone("Europe/Berlin")).toBe(true);
  expect(isRichTimeZone("UTC")).toBe(true);
  expect(isRichTimeZone("Mars/Olympus")).toBe(false);
  expect(isRichTimeZone("")).toBe(false);
  expect(isRichTimeZone("+02:00")).toBe(false);
});

test("queries reject unknown metrics, zones, dimensions, sessions and oversized windows before touching facts", () => {
  const good = query("token-size-median");
  expect(parseRichExplorerQuery(good)).toEqual(good);
  const bad: unknown[] = [
    { ...good, metricId: "not-a-metric" }, { ...good, timeZone: "Nowhere/Here" }, { ...good, groupBy: ["session", "session"] },
    { ...good, groupBy: ["session", "provider", "model"] }, { ...good, groupBy: ["utc-day"] }, { ...good, topK: 0 }, { ...good, topK: 51 },
    { ...good, filters: { ...good.filters, session: "abc" } }, { ...good, filters: { ...good.filters, provider: "gemini" } },
    { ...good, filters: { ...good.filters, model: "" } }, { ...good, selection: { ...good.selection, window: { startMs: 0, endMs: 32 * 86_400_000 } } },
    { ...good, selection: { ...good.selection, executionId: null } }, { ...good, quantity: "cached" }, { ...good, schemaVersion: 2 }, { ...good, extra: 1 },
    Object.create(good), null, "query",
  ];
  for (const input of bad) expect(parseRichExplorerQuery(input)).toBeNull();
  const result = evaluateRichExplorerQuery(document(richReport()), { ...good, topK: 0 });
  expect(result).toEqual({ ok: false, error: "invalid_rich_explorer_query" });
  expect(evaluated(document(richReport()), query("accounted-tokens"))).toMatchObject({ reason: "not-a-session-fact-metric", measure: { id: "accounted-tokens", value: null } });
  expect(richExplorerResultJson(evaluated(document(generatedReport(1)), query("token-size-median", { selection: { ...baseSelection, window } })))).toMatch(/"amount": "[0-9]+"/u);
});

test("documents admit an explicit time zone, refuse an invalid one and adapt session observations locally", async () => {
  const base = richReport([richFact(1, richUsage(1, "5"))]);
  const zoned = await openRichFactsDocument(JSON.stringify({ ...base, timeZone: "Asia/Tokyo" }));
  expect(zoned.ok && zoned.value.timeZone).toBe("Asia/Tokyo");
  expect(zoned.ok && zoned.value.origin).toBe("rich-facts-v1");
  expect(zoned.ok && zoned.value.revision).toBe(`${richId(999)}:1:0`);
  const plain = await openRichFactsDocument(JSON.stringify(base));
  expect(plain.ok && plain.value.timeZone).toBeNull();
  expect(await openRichFactsDocument(JSON.stringify({ ...base, timeZone: "Local" }))).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(await openRichFactsDocument(JSON.stringify({ ...base, timeZone: null }))).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(await openRichFactsDocument("{")).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(await openRichFactsDocument("[]")).toEqual({ ok: false, error: "invalid_rich_facts" });
  const adapted = await openRichFactsDocument(JSON.stringify(SESSION_EXAMPLE));
  if (!adapted.ok) throw new Error(adapted.error);
  expect(adapted.value.origin).toBe("session-observations-v1");
  expect(adapted.value.timeZone).toBeNull();
  expect(adapted.value.report.facts.length).toBeGreaterThan(0);
  const sizes = evaluated(adapted.value, query("token-size-maximum", { selection: { window: adapted.value.report.window, grain: "usage_observation", tokenScope: "unknown", lineage: "all" }, groupBy: ["session"] }));
  expect(sizes.measure).toMatchObject({ value: null, reason: "unknown_token_scope" });
  expect(sizes.reason).toBe("unknown_token_scope");
  expect(sizes.groups.map(group => group.measure.value)).toEqual([{ kind: "integer", amount: 26_900n }, { kind: "integer", amount: 22_200n }]);
  expect(sizes.groups.map(group => group.measure.reason)).toEqual([null, null]);
  const span = { ...SESSION_EXAMPLE, sessions: SESSION_EXAMPLE.sessions.map((session, index) => index === 0 ? { ...session, window: { ...session.window, startMs: session.window.endMs - 32 * 86_400_000 } } : session) };
  expect(await openRichFactsDocument(JSON.stringify(span))).toEqual({ ok: false, error: "session_window_limit" });
});
