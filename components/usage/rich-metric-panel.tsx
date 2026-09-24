"use client";

import { useEffect, useMemo, useState } from "react";
import type { RichMetricQuantity, RichMetricReason, RichMetricResult } from "@/lib/usage/rich-metric-explorer";
import type { SessionObservation } from "@/lib/usage/session-contract";
import { createRichSessionLoader, queryRichSession, type RichSessionError, type RichSessionState } from "./rich-metric-panel-state";

const quantities: readonly RichMetricQuantity[] = ["input", "output", "total", "reasoning", "cacheWriteUnknown"];
const reasonText: Record<RichMetricReason, string> = {
  "not-implemented-in-profile": "This local profile does not retain the facts needed for this metric.",
  "unsupported-source-kind": "The selected source does not provide this kind of observation.",
  "different-grain": "Choose the observation grain used by this metric.",
  "no-measured-observations": "No exact observations are available in this window.",
  "unclassified-request-outcomes": "Some request outcomes are unresolved, so this denominator is incomplete.",
  "zero-denominator": "The measured denominator is zero; no ratio is established.",
  "unknown_token_scope": "The source does not establish direct versus inclusive token scope.",
  "overlapping_executions": "Inclusive totals would overlap executions and are refused.",
  "incomplete_lineage": "The retained execution lineage is incomplete.",
};
const titles: Readonly<Record<string, string>> = {
  "token-size-minimum": "Minimum token size", "token-size-median": "Median token size", "token-size-p90": "P90 token size",
  "token-size-p95": "P95 token size", "token-size-p99": "P99 token size", "token-size-maximum": "Maximum token size",
};
const errorText = (error: RichSessionError) => error === "session_window_limit"
  ? "Token-size metrics support at most 31 days, including the final observation. Open a report with a shorter session window."
  : error === "session_window_endpoint"
    ? "The final observation is outside the timestamp range supported by token-size metrics."
    : error === "body_limit" || error === "record_limit"
      ? "This session exceeds the observation limit for token-size metrics. Open a smaller session report."
      : "This session’s token-size data could not be read. Reopen a valid session report.";
const exact = (value: RichMetricResult["measures"][number]["value"]) => value === null ? null
  : value.kind === "integer" ? value.amount.toString() : `${value.numerator.toString()} / ${value.denominator.toString()}`;

/** A local-only observation view. It never uploads the session or persists the
 * keyed source identifiers; each selected snapshot gets an ephemeral HMAC key. */
export function RichMetricPanel({ session }: Readonly<{ session: SessionObservation }>) {
  const [quantity, setQuantity] = useState<RichMetricQuantity>("total");
  const [loader] = useState(createRichSessionLoader);
  const [state, setState] = useState<RichSessionState | null>(null);
  useEffect(() => {
    const request = loader.load(session, setState);
    return request.cancel;
  }, [loader, session]);
  const result = useMemo(() => queryRichSession(state, session, quantity), [state, session, quantity]);
  return <section className="usage-sessions__rich" aria-labelledby="rich-metric-title">
    <header><div><h3 id="rich-metric-title">Measured session token sizes</h3>
      <p>Exact sizes of the recorded usage observations. Source coverage is partial.</p></div></header>
    <div className="usage-sessions__rich-controls">
      <div className="usage-sessions__rich-control">
        <label htmlFor="rich-metric-quantity">Token quantity</label>
        <select id="rich-metric-quantity" value={quantity} onChange={event => setQuantity(event.target.value as RichMetricQuantity)}>
          {quantities.map(value => <option key={value} value={value}>{value === "cacheWriteUnknown" ? "unknown cache write" : value}</option>)}
        </select>
      </div>
    </div>
    {result === null && <p className="usage-sessions__notice" role="status">Computing local metric facts…</p>}
    {result !== null && !result.ok && <p className="usage-sessions__notice" role="alert">{errorText(result.error)}</p>}
    {result?.ok && <>
      <div className="usage-sessions__rich-grid">
        {result.value.measures.map(measure => <article key={measure.id} className="usage-sessions__rich-card">
          <h4>{titles[measure.id]}</h4>
          <strong>{measure.value === null ? "Unavailable" : exact(measure.value)}</strong>
          <span>{measure.unit} · {measure.status === "partial" ? "partial coverage" : measure.status}</span>
          {measure.reason !== null && <p>{reasonText[measure.reason]}</p>}
          {measure.reason === null && <p>{measure.measured} measured · {measure.unmeasured} unmeasured</p>}
        </article>)}
      </div>
    </>}
    <p className="usage-daily__hint">A usage observation does not establish a request or turn. This session report does not provide request outcomes, time to first token, tool completion, context or compaction metrics. These sizes describe this session’s recorded observations only.</p>
  </section>;
}
