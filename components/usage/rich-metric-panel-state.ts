import { err, ok, type Result } from "@/lib/result";
import { richFactsFromSessions } from "@/lib/usage/rich-fact-adapters";
import { RICH_FACT_MAX_WINDOW_MS, type RichFactError, type RichFactReport, type RichWindow } from "@/lib/usage/rich-fact-contract";
import { evaluateRichMetricQuery, type RichMetricQuantity, type RichMetricResult } from "@/lib/usage/rich-metric-explorer";
import type { SessionObservation } from "@/lib/usage/session-contract";
import { statsInteger, statsOwnRecord } from "@/lib/usage/stats-contract";

const MAX_TIME = 8_640_000_000_000_000;
export const SESSION_TOKEN_METRIC_IDS = Object.freeze([
  "token-size-minimum", "token-size-median", "token-size-p90", "token-size-p95", "token-size-p99", "token-size-maximum",
] as const);
export type RichSessionError = RichFactError | "session_window_limit" | "session_window_endpoint" | "invalid_rich_metric_query";
type FactsResult = Result<RichFactReport, RichSessionError>;
export type RichSessionState = Readonly<{ session: SessionObservation; result: FactsResult }>;

/** Session v1 includes the last observation at endMs; rich v1 uses [start, end).
 * Refuse an unrepresentable window instead of omitting the final observation. */
export function richSessionWindow(input: unknown): Result<RichWindow, RichSessionError> {
  try {
    const window = statsOwnRecord(input, ["startMs", "endMs"]);
    if (!window || !statsInteger(window.startMs, 0, MAX_TIME) || !statsInteger(window.endMs, window.startMs, MAX_TIME))
      return err("invalid_rich_facts");
    if (window.endMs === MAX_TIME) return err("session_window_endpoint");
    if (window.endMs - window.startMs + 1 > RICH_FACT_MAX_WINDOW_MS) return err("session_window_limit");
    return ok(Object.freeze({ startMs: window.startMs, endMs: window.endMs + 1 }));
  } catch { return err("invalid_rich_facts"); }
}

export async function prepareRichSession(session: SessionObservation): Promise<FactsResult> {
  try {
    const window = richSessionWindow(session.window);
    if (!window.ok) return window;
    const key = crypto.getRandomValues(new Uint8Array(32));
    return await richFactsFromSessions({ schemaVersion: 1, profile: "session-observations-v1", sessions: [session] },
      { key, sourceEpoch: "session-panel-v1", window: window.value });
  } catch { return err("invalid_rich_facts"); }
}

/** Keep one active adaptation and one latest waiting selection. Superseded
 * requests settle without publishing; cancelled views cannot start queued work.
 * The last published snapshot is reused for repeated effect setup. */
export function createRichSessionLoader(prepare: (session: SessionObservation) => Promise<FactsResult> = prepareRichSession) {
  type Request = Readonly<{ session: SessionObservation; publish: (state: RichSessionState) => void; settle: () => void }>;
  type Job = Readonly<{ session: SessionObservation }>;
  let active: Job | null = null;
  let waiting: Request | null = null;
  let cached: RichSessionState | null = null;
  let scheduled = false;
  const deliver = (request: Request, state: RichSessionState) => {
    if (waiting !== request) return;
    waiting = null;
    cached = state;
    try { request.publish(state); } finally { request.settle(); }
  };
  const finish = (job: Job, result: FactsResult) => {
    if (active !== job) return;
    active = null;
    if (waiting?.session === job.session) deliver(waiting, { session: job.session, result });
    schedule();
  };
  const run = () => {
    scheduled = false;
    if (active !== null || waiting === null) return;
    if (cached?.session === waiting.session) { deliver(waiting, cached); return; }
    const job = { session: waiting.session };
    active = job;
    try { void prepare(job.session).then(result => finish(job, result), () => finish(job, err("invalid_rich_facts"))); }
    catch { finish(job, err("invalid_rich_facts")); }
  };
  const schedule = () => {
    if (scheduled || waiting === null) return;
    scheduled = true;
    queueMicrotask(run);
  };
  return {
    load(session: SessionObservation, publish: (state: RichSessionState) => void) {
      let settle!: () => void;
      const completion = new Promise<void>(resolve => { settle = resolve; });
      waiting?.settle();
      const request = { session, publish, settle };
      waiting = request;
      schedule();
      return { completion, cancel: () => {
        if (waiting === request) { waiting = null; request.settle(); }
      } };
    },
  };
}

/** A previous snapshot's result is never a reading for the newly selected one.
 * Quantity changes reuse admitted facts and do not repeat source hashing. */
export function queryRichSession(state: RichSessionState | null, session: SessionObservation, quantity: RichMetricQuantity): Result<RichMetricResult, RichSessionError> | null {
  if (state === null || state.session !== session) return null;
  if (!state.result.ok) return state.result;
  return evaluateRichMetricQuery(state.result.value, { schemaVersion: 1, metricIds: SESSION_TOKEN_METRIC_IDS, quantity,
    selection: { window: state.result.value.window, grain: "usage_observation", tokenScope: "unknown", lineage: "all", executionId: null } });
}
