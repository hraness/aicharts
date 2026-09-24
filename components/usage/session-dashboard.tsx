"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SESSION_PHASES, type SessionPhase, type SessionReport } from "@/lib/usage/session-contract";
import { summarizeSessions, type SessionSummary } from "@/lib/usage/sessions";
import { joinCompactionEvents, type CompactionEvent, type SessionCompactions } from "@/lib/usage/compaction";
import { readCompactionFile, readSessionFile } from "./local-report-file";
import { SESSION_EXAMPLE } from "@/lib/usage/session-example";
import { RichMetricPanel } from "./rich-metric-panel";

const labels: Record<SessionPhase, string> = { inference: "Inference", reply_wait: "Reply wait", approval_wait: "Approval wait", tool_wait: "Tool wait", unknown: "Unknown" };
const numbers = new Intl.NumberFormat("en-US");
const clock = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const percent = (value: number | null) => value === null ? "Unknown" : `${value.toFixed(1)}%`;
const duration = (ms: number) => ms < 1_000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1_000).toFixed(1)} s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
const provider = (name: string) => name === "codex" ? "Codex" : name === "devin" ? "Devin" : "Claude Code";
const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-6)}`;
type ReadHandle = { getFile: () => Promise<File> };
type PickerWindow = Window & { showOpenFilePicker?: (options: { multiple: false; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<ReadHandle[]> };
const subscribeCapabilities = () => () => {};
const fileFollowingSupported = () => typeof (window as PickerWindow).showOpenFilePicker === "function";
const serverCapabilities = () => false;

function Breakdown({ value }: Readonly<{ value: SessionSummary }>) {
  return <section className="usage-sessions__breakdown" aria-labelledby="session-time-title">
    <h3 id="session-time-title">Where this session spent time</h3>
    <div className="usage-sessions__bar" aria-hidden="true">
      {SESSION_PHASES.map(p => <span key={p} className={`usage-sessions__phase usage-sessions__phase--${p}`} style={{ flexGrow: value.phaseMs[p] }} />)}
    </div>
    <dl className="usage-sessions__phases">{SESSION_PHASES.map(p => <div key={p}>
      <dt><span className={`usage-sessions__key usage-sessions__phase--${p}`} aria-hidden="true" />{labels[p]}</dt>
      <dd>{p !== "unknown" && value.phaseMs[p] === 0 && value.phaseMs.unknown > 0 ? "Unmeasured" : duration(value.phaseMs[p])}<span>{value.windowMs > 0 ? percent(value.phaseMs[p] / value.windowMs * 100) : "No elapsed window"}</span></dd>
    </div>)}</dl>
    <p className="usage-daily__hint">Shares use the selected session window, including unknown time. Inference takes precedence over simultaneous waits; human waits take precedence over tools. Conflicting human waits remain unknown.</p>
    <div className="usage-sessions__timeline" aria-label="Session time sequence">
      <span>{clock.format(value.session.window.startMs)} UTC</span>
      <div className="usage-sessions__track" aria-hidden="true">{value.timeline.length <= 300 && value.timeline.map(segment => <span
        key={segment.startMs} className={`usage-sessions__phase usage-sessions__phase--${segment.phase}`}
        style={{ flexGrow: segment.endMs - segment.startMs }} title={`${labels[segment.phase]} · ${duration(segment.endMs - segment.startMs)}`} />)}</div>
      <span>{clock.format(value.session.window.endMs)} UTC</span>
    </div>
    {value.timeline.length > 300 && <p className="usage-daily__hint">This session has too many transitions for the compact timeline. The time breakdown includes every interval.</p>}
    <p className="usage-daily__hint">{value.modelRequestMs > 0 ? `Model requests occupied ${duration(value.modelRequestMs)}.` : "No model-request timing was observed."} Request time includes provider, network and retry waits; it is separate from observed streaming.</p>
  </section>;
}

function SessionDetail({ value }: Readonly<{ value: SessionSummary }>) {
  return <section id="session-detail" className="usage-sessions__detail" aria-labelledby="session-detail-title">
    <header><div><h2 id="session-detail-title">{provider(value.session.provider)} · Session {shortId(value.session.sessionId)}</h2>
      <p>{value.session.conversationId === null ? "Conversation link unavailable" : `Conversation ${shortId(value.session.conversationId)}`} · {value.session.source === "history" ? "Imported history" : "Instrumented observations"}</p></div>
      <span>{duration(value.windowMs)} window</span></header>
    {value.session.source === "history" && <p className="usage-sessions__notice">History provides token observations. It does not establish streaming or wait intervals, so those times remain unknown.</p>}
    <Breakdown value={value} />
    <RichMetricPanel session={value.session} />
    <section aria-labelledby="session-models-title"><h3 id="session-models-title">Model mix</h3>
      <p className="usage-daily__hint">Observed token share, including cache reads and writes. Reasoning tokens are already included in output. A requested model alone does not prove which model served a response.</p>
      <div className="usage-daily__table-scroll" role="region" aria-label="Model usage table" tabIndex={0}>
        <table><caption>Partial token observations for this session</caption><thead><tr>
          <th scope="col">Model</th><th scope="col">Share</th><th scope="col">Input</th><th scope="col">Cache read</th><th scope="col">Cache write</th><th scope="col">Output</th><th scope="col">Reasoning</th><th scope="col">Records</th>
        </tr></thead><tbody>{value.models.map(m => <tr key={`${m.modelBasis}:${m.model}`}>
          <th scope="row">{m.model ?? "Unknown model"}{m.modelBasis === "request" && <span className="usage-sessions__model-basis">Request tag</span>}</th><td>{value.accountedTokens === 0n ? "—" : percent(Number(m.accountedTokens * 1_000n / value.accountedTokens) / 10)}</td>
          <td>{numbers.format(m.inputTokens)}</td><td>{numbers.format(m.cacheReadTokens)}</td><td>{numbers.format(m.cacheWriteTokens)}</td><td>{numbers.format(m.outputTokens)}</td>
          <td>{m.reasoningMeasuredRecords === 0 ? "Unknown" : `${numbers.format(m.reasoningTokens)}${m.reasoningMeasuredRecords < m.records ? " (partial)" : ""}`}</td><td>{m.records}</td>
        </tr>)}</tbody></table>
      </div>
      {value.models.length === 0 && <p className="usage-sessions__notice">No token observations in this window.</p>}
    </section>
  </section>;
}

export function SessionDashboard() {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [example, setExample] = useState(false), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState("all"), [following, setFollowing] = useState<ReadHandle | null>(null);
  const canFollow = useSyncExternalStore(subscribeCapabilities, fileFollowingSupported, serverCapabilities);
  const [updated, setUpdated] = useState<number | null>(null);
  const [limit, setLimit] = useState(100);
  const [compactionEvents, setCompactionEvents] = useState<readonly CompactionEvent[] | null>(null);
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const [compactionLoading, setCompactionLoading] = useState(false);
  const [skippedCompactions, setSkippedCompactions] = useState(0);
  const sequence = useRef(0), compactionSequence = useRef(0);
  useEffect(() => () => { sequence.current++; compactionSequence.current++; }, []);

  const read = async (file: File, expected: number, replace = false) => {
    const result = await readSessionFile(file);
    if (sequence.current !== expected) return false;
    setReport(result); setError(null); setExample(false); setUpdated(Date.now());
    if (replace) {
      setSelected(null); setScope("all"); setLimit(100);
      compactionSequence.current++; setCompactionEvents(null); setCompactionError(null); setCompactionLoading(false); setSkippedCompactions(0);
    }
    return true;
  };

  const openCompactions = async (file: File) => {
    const generation = ++compactionSequence.current;
    setCompactionLoading(true); setCompactionError(null);
    try {
      const result = await readCompactionFile(file);
      if (generation === compactionSequence.current) {
        setCompactionEvents(result.events); setSkippedCompactions(result.skippedLines);
      }
    } catch {
      if (generation === compactionSequence.current) setCompactionError("Open a valid gobstopper events log (events.jsonl), up to 8 MiB. The previous events, if any, are still shown.");
    } finally {
      if (generation === compactionSequence.current) setCompactionLoading(false);
    }
  };

  useEffect(() => {
    if (!following) return;
    const generation = sequence.current;
    let stopped = false, initial = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || generation !== sequence.current) return;
      try { if (await read(await following.getFile(), generation, initial)) initial = false; }
      catch { if (!stopped && generation === sequence.current) setError("The report could not be refreshed. Showing the last valid reading; check the collector or reopen the report."); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 3_000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [following]);

  const open = async (file: File) => {
    const generation = ++sequence.current;
    setFollowing(null); setLoading(true); setError(null);
    try { await read(file, generation, true); }
    catch { if (sequence.current === generation) setError("Open a valid AI Charts session report, up to 8 MiB. Raw session logs are not accepted."); }
    finally { if (sequence.current === generation) setLoading(false); }
  };
  const follow = async () => {
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) return;
    try {
      const [handle] = await picker.call(window, { multiple: false, types: [{ description: "AI Charts session report", accept: { "application/json": [".json"] } }] });
      if (handle) { ++sequence.current; setFollowing(handle); setLoading(false); setError(null); }
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("The browser could not follow this file. Use Open session report to read a snapshot."); }
  };
  const filtered = useMemo(() => report === null ? null : { ...report, sessions: report.sessions.filter(s => scope === "all" || (scope.startsWith("conversation:") ? `${s.provider}:${s.conversationId}` === scope.slice(13) : s.provider === scope)) }, [report, scope]);
  const summary = useMemo(() => filtered === null ? null : summarizeSessions(filtered), [filtered]);
  const compactions = useMemo(() => filtered === null || compactionEvents === null ? null : joinCompactionEvents(filtered, compactionEvents), [filtered, compactionEvents]);
  const selectedCompactions = useMemo(() => ({
    applied: compactions?.sessions.reduce((sum, session) => sum + session.applied, 0) ?? 0,
    reclaimed: compactions?.sessions.reduce((sum, session) => sum + session.estReclaimedTokens, 0n) ?? 0n,
  }), [compactions]);
  const compactionBySession = useMemo(() => {
    const map = new Map<string, SessionCompactions>();
    for (const s of compactions?.sessions ?? []) map.set(`${s.session.provider}:${s.session.sessionId}`, s);
    return map;
  }, [compactions]);
  const sorted = useMemo(() => [...(summary?.sessions ?? [])].sort((a, b) => b.session.window.endMs - a.session.window.endMs || a.session.sessionId.localeCompare(b.session.sessionId)), [summary]);
  const detail = sorted.find(s => `${s.session.provider}:${s.session.sessionId}` === selected) ?? sorted[0];
  const conversations = [...new Set(report?.sessions.flatMap(s => s.conversationId === null ? [] : [`${s.provider}:${s.conversationId}`]) ?? [])].sort();
  const reading = (complete: number | null, observed: number | null) => complete !== null ? percent(complete) : observed !== null && observed > 0 ? `≥ ${percent(observed)}` : "Unknown";

  return <section className="usage-daily usage-sessions" aria-labelledby="sessions-title">
    <Link className="usage-inline-link" href="/dashboard">Usage overview</Link>
    <header className="usage-daily__heading"><div><h1 id="sessions-title">Your sessions, in detail</h1>
      <p>See the model mix and where time goes, within a conversation and across concurrent sessions.</p></div></header>
    <div className="usage-sessions__controls">
      <label className="usage-button usage-button--primary usage-sessions__file">{loading ? "Reading report…" : "Open session report"}
        <input type="file" accept="application/json,.json" disabled={loading} onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void open(f); }} />
      </label>
      {canFollow && <button className="usage-button usage-button--quiet" type="button" onClick={() => void follow()}>Follow a report</button>}
      {following && <button className="usage-button usage-button--quiet" type="button" onClick={() => { ++sequence.current; setFollowing(null); }}>Stop following</button>}
      <button className="usage-button usage-button--quiet" type="button" onClick={() => { ++sequence.current; setFollowing(null); setReport(SESSION_EXAMPLE); setExample(true); setError(null); setLoading(false); setScope("all"); setSelected(null); setUpdated(null); setLimit(100); compactionSequence.current++; setCompactionEvents(null); setCompactionError(null); setCompactionLoading(false); setSkippedCompactions(0); }}>Explore an example</button>
      {report !== null && <label className="usage-button usage-button--quiet usage-sessions__file" aria-disabled={compactionLoading}>
        {compactionLoading ? "Reading events…" : "Add compaction events"}
        <input type="file" accept=".jsonl,application/x-ndjson" disabled={compactionLoading} onChange={e => {
          const file = e.currentTarget.files?.[0]; e.currentTarget.value = "";
          if (file) void openCompactions(file);
        }} />
      </label>}
      {compactionEvents !== null && <button className="usage-button usage-button--quiet" type="button" onClick={() => {
        compactionSequence.current++; setCompactionEvents(null); setCompactionError(null); setCompactionLoading(false); setSkippedCompactions(0);
      }}>Remove compaction events</button>}
    </div>
    <p className="usage-sessions__privacy">The report stays in this browser tab. Opening it does not upload it or save it to your account.</p>
    {error && <p className="usage-sessions__notice" role="alert">{error}</p>}
    {compactionError && <p className="usage-sessions__notice" role="alert">{compactionError}</p>}
    {skippedCompactions > 0 && <p className="usage-sessions__notice">{numbers.format(skippedCompactions)} unrecognized or incomplete event lines were skipped. Compaction coverage is partial.</p>}
    <div aria-live="polite" className="usage-daily__announcement">{loading ? "Reading report." : example ? "Synthetic example loaded." : report ? `${report.sessions.length} sessions loaded.` : "No report opened."}</div>
    {report === null ? <div className="usage-sessions__intro">
      <h2>Start with your local measurements</h2><p>Export numeric observations from an explicit Codex, Claude Code or Devin session file. Open the report here to inspect a session without sending its transcript.</p>
      <pre><code>aicharts sessions --occurrence-key-file ./aicharts.key \
  --codex ./session.jsonl --json &gt; ./sessions.json</code></pre>
      <p>Historical files provide token totals. Live timing requires instrumented observations; unknown time stays visible.</p>
      <Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-sessions.md">Collector and timing guide</Link>
    </div> : <>
      <div className="usage-sessions__source"><strong>{example ? "Synthetic example · not your usage" : following ? "Following local report · every 3 seconds" : "Local report"}</strong>
        {updated !== null && <span>Read at {new Date(updated).toLocaleTimeString()}</span>}</div>
      <div className="usage-sessions__scope"><label htmlFor="session-scope">Show</label><select id="session-scope" value={scope} onChange={e => { setScope(e.target.value); setSelected(null); setLimit(100); }}>
        <option value="all">All sessions</option><option value="codex">Codex</option><option value="claude_code">Claude Code</option><option value="devin">Devin</option>
        {conversations.map(c => <option key={c} value={`conversation:${c}`}>Conversation {shortId(c.split(":")[1])} · {provider(c.split(":")[0])}</option>)}
      </select><span>{sorted.length} sessions · {duration(summary?.netWindowMs ?? 0)} observed elapsed window</span></div>
      {summary && <dl className="usage-sessions__aggregate">
        <div><dt>Session inference share</dt><dd>{reading(summary.sessionInferencePct, summary.observedSessionInferencePct)}</dd><p>Inference time ÷ total selected session time.</p></div>
        <div><dt>Net inference share</dt><dd>{reading(summary.netInferencePct, summary.observedNetInferencePct)}</dd><p>Elapsed time with at least one session inferring.</p></div>
        <div><dt>Observed concurrency</dt><dd>{summary.phaseMs.inference === 0 && summary.phaseMs.unknown > 0 ? "Unknown" : `${summary.meanInferenceConcurrency?.toFixed(2) ?? "—"} mean · ${summary.peakInferenceConcurrency} peak`}</dd><p>Observed simultaneous inference sessions. Missing intervals may increase these values.</p></div>
        <div><dt>Unclassified session time</dt><dd>{duration(summary.phaseMs.unknown)}</dd><p>Unknown time remains in the denominator.</p></div>
      </dl>}
      {summary && compactions !== null && <dl className="usage-sessions__aggregate">
        <div><dt>Compactions applied</dt><dd>{numbers.format(selectedCompactions.applied)}</dd><p>Applied events matched to the selected sessions.</p></div>
        <div><dt>Tokens reclaimed</dt><dd>{numbers.format(selectedCompactions.reclaimed)}</dd><p>Estimated context tokens reclaimed in the selected sessions.</p></div>
        {compactions.unmatchedEvents.length > 0 && <div><dt>Events outside selection</dt><dd>{numbers.format(compactions.unmatchedEvents.length)}</dd><p>Log events not matched to the selected sessions; excluded from these totals.</p></div>}
      </dl>}
      <p className="usage-daily__hint">A ≥ value is the observed minimum; missing timing prevents an exact share. Streaming is observed application activity, not a measurement of GPU utilization. Elapsed windows exclude gaps when no selected session is observed.</p>
      {summary && summary.models.length > 0 && <details className="usage-daily__details">
        <summary>Model mix across this selection <span>{numbers.format(summary.accountedTokens)} observed tokens · {numbers.format(summary.outputTokens)} output</span></summary>
        <div className="usage-daily__table-scroll" role="region" aria-label="Selection model mix" tabIndex={0}><table>
          <caption>Model mix across the selected sessions or conversation. Coverage is partial.</caption><thead><tr><th scope="col">Model</th><th scope="col">Provider</th><th scope="col">Attribution</th><th scope="col">Token share</th><th scope="col">Observed tokens</th><th scope="col">Output</th></tr></thead>
          <tbody>{summary.models.map(m => <tr key={`${m.provider}:${m.modelBasis}:${m.model}`}><th scope="row">{m.model ?? "Unknown model"}</th>
            <td>{provider(m.provider)}</td><td>{m.modelBasis === "request" ? "Request tag" : m.modelBasis === "response" ? "Response" : "Unknown"}</td>
            <td>{summary.accountedTokens === 0n ? "—" : percent(Number(m.accountedTokens * 1_000n / summary.accountedTokens) / 10)}</td><td>{numbers.format(m.accountedTokens)}</td><td>{numbers.format(m.outputTokens)}</td>
          </tr>)}</tbody></table></div>
      </details>}
      {sorted.length === 0 ? <p className="usage-sessions__notice">No sessions in this selection.</p> : <>
        <div className="usage-daily__table-scroll" role="region" aria-label="Session list" tabIndex={0}><table className="usage-sessions__table">
          <caption>Select a session to inspect its model mix and time breakdown. Token coverage is partial.</caption><thead><tr><th scope="col">Session</th><th scope="col">Last observation (UTC)</th><th scope="col">Observed tokens</th><th scope="col">Output</th><th scope="col">Inference</th>{compactions !== null && <th scope="col">Compactions</th>}<th scope="col">Window</th></tr></thead>
          <tbody>{sorted.slice(0, limit).map(value => {
            const c = compactionBySession.get(`${value.session.provider}:${value.session.sessionId}`);
            return <tr key={`${value.session.provider}:${value.session.sessionId}`} data-selected={value === detail}>
            <th scope="row"><button className="usage-sessions__select" type="button" aria-pressed={value === detail} aria-controls="session-detail" onClick={() => setSelected(`${value.session.provider}:${value.session.sessionId}`)}>{provider(value.session.provider)} <span>{shortId(value.session.sessionId)}</span></button></th>
            <td>{clock.format(value.session.window.endMs)}</td><td>{numbers.format(value.accountedTokens)}</td><td>{numbers.format(value.outputTokens)}</td><td>{reading(value.inferencePct, value.observedInferencePct)}</td>
            {compactions !== null && <td>{c === undefined || c.events.length === 0 ? "—" : `${numbers.format(c.applied)} applied · ${numbers.format(c.estReclaimedTokens)} reclaimed`}</td>}
            <td>{duration(value.windowMs)}</td>
          </tr>; })}</tbody></table></div>
        {sorted.length > limit && <button className="usage-button usage-button--quiet" type="button" onClick={() => setLimit(n => n + 100)}>Show more sessions</button>}
        {detail && <SessionDetail value={detail} />}
      </>}
    </>}
  </section>;
}
