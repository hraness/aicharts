import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RICH_FACT_MAX_WINDOW_MS } from "@/lib/usage/rich-fact-contract";
import type { RichMetricQuantity } from "@/lib/usage/rich-metric-explorer";
import { SESSION_EXAMPLE } from "@/lib/usage/session-example";
import type { SessionObservation } from "@/lib/usage/session-contract";
import { parseSessionReport } from "@/lib/usage/sessions";
import { RichMetricPanel } from "./rich-metric-panel";
import { createRichSessionLoader, prepareRichSession, queryRichSession, richSessionWindow, SESSION_TOKEN_METRIC_IDS, type RichSessionState } from "./rich-metric-panel-state";

const id = (value: number) => value.toString(16).padStart(32, "0");
const session = (): SessionObservation => ({
  provider: "codex", sessionId: id(1), conversationId: id(2), source: "instrumented", window: { startMs: 100, endMs: 200 },
  spans: [{ id: id(3), startMs: 100, endMs: 200, kind: "model_request", basis: "request_lifecycle" }],
  usage: [
    { id: id(4), atMs: 100, model: "gpt-5.4", modelBasis: "response", inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 40, reasoningTokens: 10 },
    { id: id(5), atMs: 200, model: "gpt-5.4", modelBasis: "response", inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 90, reasoningTokens: null },
  ],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

test("rich session panel advertises exact local controls without serializing source facts", () => {
  const html = renderToStaticMarkup(<RichMetricPanel session={SESSION_EXAMPLE.sessions[0]!} />);
  expect(html).toContain("Measured session token sizes");
  expect(html).not.toContain("Observation grain");
  expect(html).toContain("Token quantity");
  expect(html).toContain("Computing local metric facts");
  expect(html).toContain("A usage observation does not establish a request or turn");
  expect(html).toContain("Source coverage is partial");
  expect(html).not.toContain("sessionId");
  expect(html).not.toContain("conversationId");
});

test("the actual panel query evaluates every registered distribution and retains endpoint usage and spans", async () => {
  const selected = session();
  const result = await prepareRichSession(selected);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.value.window).toEqual({ startMs: 100, endMs: 201 });
  expect(result.value.facts).toHaveLength(3);
  expect(result.value.facts.find(fact => fact.kind === "span")?.value).toMatchObject({ kind: "span", endMs: 200 });
  const state: RichSessionState = { session: selected, result };
  const total = queryRichSession(state, selected, "total");
  if (!total?.ok) throw new Error("panel_query_failed");
  expect(total.value.query.selection).toMatchObject({ grain: "usage_observation", window: { startMs: 100, endMs: 201 } });
  expect(total.value.measures.map(value => value.id)).toEqual([...SESSION_TOKEN_METRIC_IDS]);
  expect(total.value.measures.map(value => value.value)).toEqual([100n, 100n, 150n, 150n, 150n, 150n].map(amount => ({ kind: "integer", amount })));
  for (const measure of total.value.measures) expect(measure).toMatchObject({ measured: 2, unmeasured: 0, status: "partial", reason: null });
  for (const quantity of ["input", "output", "total", "reasoning", "cacheWriteUnknown"] as const) {
    const value = queryRichSession(state, selected, quantity);
    expect(value?.ok).toBe(true);
  }
  const reasoning = queryRichSession(state, selected, "reasoning");
  if (!reasoning?.ok) throw new Error("reasoning_query_failed");
  expect(reasoning.value.measures[0]).toMatchObject({ measured: 1, unmeasured: 1, value: { kind: "integer", amount: 10n } });
});

test("single-observation sessions keep their only observation and the panel refuses unsupported windows without clipping", async () => {
  const base = session();
  const single = { ...base, source: "history" as const, spans: [], window: { startMs: 200, endMs: 200 }, usage: [base.usage[1]!] };
  expect(parseSessionReport({ schemaVersion: 1, profile: "session-observations-v1", sessions: [single] })).not.toBeNull();
  const result = await prepareRichSession(single);
  if (!result.ok) throw new Error(result.error);
  expect(result.value.window).toEqual({ startMs: 200, endMs: 201 });
  const selected = queryRichSession({ session: single, result }, single, "total");
  if (!selected?.ok) throw new Error("single_observation_query_failed");
  for (const measure of selected.value.measures) expect(measure).toMatchObject({ measured: 1, unmeasured: 0, value: { kind: "integer", amount: 150n } });
  expect(richSessionWindow({ startMs: 0, endMs: RICH_FACT_MAX_WINDOW_MS - 1 })).toEqual({ ok: true, value: { startMs: 0, endMs: RICH_FACT_MAX_WINDOW_MS } });
  const long = { ...base, window: { startMs: 0, endMs: RICH_FACT_MAX_WINDOW_MS } };
  expect(parseSessionReport({ schemaVersion: 1, profile: "session-observations-v1", sessions: [long] })).not.toBeNull();
  expect(await prepareRichSession(long)).toEqual({ ok: false, error: "session_window_limit" });
  const ceiling = 8_640_000_000_000_000;
  expect(richSessionWindow({ startMs: ceiling - 1, endMs: ceiling - 1 })).toEqual({ ok: true, value: { startMs: ceiling - 1, endMs: ceiling } });
  expect(richSessionWindow({ startMs: ceiling - 1, endMs: ceiling })).toEqual({ ok: false, error: "session_window_endpoint" });
  let invoked = false;
  expect(richSessionWindow({ startMs: 0, get endMs() { invoked = true; return 200; } })).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(invoked).toBe(false);
});

test("session adaptation is reused for quantity changes and repeated effect setup", async () => {
  const selected = session();
  let adaptations = 0;
  const loader = createRichSessionLoader(value => { adaptations++; return prepareRichSession(value); });
  const deliveries: RichSessionState[] = [];
  const first = loader.load(selected, value => deliveries.push(value));
  first.cancel();
  const second = loader.load(selected, value => deliveries.push(value));
  await Promise.all([first.completion, second.completion]);
  expect(adaptations).toBe(1);
  expect(deliveries).toHaveLength(1);
  for (const quantity of ["total", "output", "reasoning", "input", "cacheWriteUnknown"] satisfies RichMetricQuantity[]) {
    const result = queryRichSession(deliveries[0]!, selected, quantity);
    expect(result?.ok && result.value.query.quantity).toBe(quantity);
  }
  expect(adaptations).toBe(1);
  const third = loader.load(selected, value => deliveries.push(value));
  await third.completion;
  expect(adaptations).toBe(1);
  expect(deliveries).toHaveLength(2);
});

test("same-ID refreshes hide stale metrics immediately and late or cancelled completions cannot publish", async () => {
  const original = session(), refreshed = { ...original, usage: [...original.usage] }, other = { ...session(), sessionId: id(6) };
  const oldResult = await prepareRichSession(original);
  const previous: RichSessionState = { session: original, result: oldResult };
  expect(queryRichSession(previous, refreshed, "total")).toBeNull();
  expect(queryRichSession(previous, other, "total")).toBeNull();
  const pendingRefresh = deferred<Awaited<ReturnType<typeof prepareRichSession>>>();
  const pendingOther = deferred<Awaited<ReturnType<typeof prepareRichSession>>>();
  const loader = createRichSessionLoader(value => value === refreshed ? pendingRefresh.promise : pendingOther.promise);
  const deliveries: RichSessionState[] = [];
  const refresh = loader.load(refreshed, value => deliveries.push(value));
  await Promise.resolve();
  const next = loader.load(other, value => deliveries.push(value));
  pendingOther.resolve(await prepareRichSession(other));
  pendingRefresh.resolve(await prepareRichSession(refreshed));
  await Promise.all([refresh.completion, next.completion]);
  expect(deliveries.map(value => value.session)).toEqual([other]);
  const cancelled = loader.load(other, value => deliveries.push(value));
  cancelled.cancel();
  await cancelled.completion;
  expect(deliveries.map(value => value.session)).toEqual([other]);
});

test("the loader admits only one adaptation and coalesces rapid selections to the latest waiting snapshot", async () => {
  type FactsResult = Awaited<ReturnType<typeof prepareRichSession>>;
  const first = session(), skipped = { ...session(), sessionId: id(6) }, latest = { ...session(), sessionId: id(7) };
  const firstResult = deferred<FactsResult>(), latestResult = deferred<FactsResult>();
  const latestStarted = deferred<void>();
  let active = 0, maximum = 0;
  const started: SessionObservation[] = [], deliveries: SessionObservation[] = [];
  const loader = createRichSessionLoader(value => {
    started.push(value); active++; maximum = Math.max(maximum, active);
    if (value === latest) latestStarted.resolve();
    return (value === first ? firstResult.promise : latestResult.promise).then(result => { active--; return result; });
  });
  const initial = loader.load(first, value => deliveries.push(value.session));
  await Promise.resolve();
  const obsolete = loader.load(skipped, value => deliveries.push(value.session));
  const last = loader.load(latest, value => deliveries.push(value.session));
  obsolete.cancel(); // An older effect's cleanup cannot cancel the latest selection.
  await Promise.resolve();
  expect(started).toEqual([first]);
  expect(maximum).toBe(1);
  firstResult.resolve({ ok: false, error: "invalid_rich_facts" });
  await latestStarted.promise;
  expect(started).toEqual([first, latest]);
  expect(deliveries).toEqual([]);
  latestResult.resolve({ ok: false, error: "invalid_rich_facts" });
  await Promise.all([initial.completion, obsolete.completion, last.completion]);
  expect(deliveries).toEqual([latest]);
  expect(maximum).toBe(1);
  expect(active).toBe(0);
});

test("A to B to A reuses the active A adaptation and unmount discards waiting work", async () => {
  type FactsResult = Awaited<ReturnType<typeof prepareRichSession>>;
  const first = session(), second = { ...session(), sessionId: id(6) };
  const pending = deferred<FactsResult>();
  const started: SessionObservation[] = [], deliveries: SessionObservation[] = [];
  const loader = createRichSessionLoader(value => { started.push(value); return pending.promise; });
  const a = loader.load(first, value => deliveries.push(value.session));
  await Promise.resolve();
  const b = loader.load(second, value => deliveries.push(value.session));
  const aAgain = loader.load(first, value => deliveries.push(value.session));
  pending.resolve(await prepareRichSession(first));
  await Promise.all([a.completion, b.completion, aAgain.completion]);
  expect(started).toEqual([first]);
  expect(deliveries).toEqual([first]);

  const running = deferred<FactsResult>();
  const cancelledStarts: SessionObservation[] = [];
  const cancelledLoader = createRichSessionLoader(value => { cancelledStarts.push(value); return running.promise; });
  const active = cancelledLoader.load(first, value => deliveries.push(value.session));
  await Promise.resolve();
  const waiting = cancelledLoader.load(second, value => deliveries.push(value.session));
  waiting.cancel();
  running.resolve({ ok: false, error: "invalid_rich_facts" });
  await Promise.all([active.completion, waiting.completion]);
  await Promise.resolve();
  expect(cancelledStarts).toEqual([first]);
  expect(deliveries).toEqual([first]);
});
