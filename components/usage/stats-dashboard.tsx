"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { readAccountStats, warmUsageAccountSession } from "@/lib/usage/account-read-client";
import { retainUsageAccountLifecycle } from "@/lib/usage/account-session-events";
import { currentUsageAccountScope, subscribeUsageAccountInvalidation, type UsageAccountScope } from "@/lib/usage/account-generation";
import { readInUsageAccountGeneration } from "@/lib/usage/account-generation-read";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { RICH_FACT_MAX_BYTES } from "@/lib/usage/rich-fact-contract";
import { openRichFactsDocument, type RichFactsDocument } from "@/lib/usage/rich-metric-explorer-view";
import type { RichExplorerAbsence, RichExplorerSource } from "./rich-metric-explorer";
import { MetricReportSession } from "@/lib/usage/metric-explorer-session";
import { disposeStatsReadReply, StatsReadDeadline } from "@/lib/usage/stats-client";
import type { MetricReportMetadata } from "@/lib/usage/metric-explorer";
import { useAccountGeneration } from "./use-account-generation";
import { StatsReportView } from "./stats-report-view";
import type { StatsRange, StatsSelection } from "./stats-view";

type Loaded = { report: MetricReportMetadata; session: MetricReportSession; version: number; selection?: StatsSelection } &
  ({ scope: "account"; authority: UsageAccountScope } | { scope: "local" | "example" });
type Status = "idle" | "loading" | "ready" | "authentication_required" | "stats_not_started" | "not_enrolled" | "range_too_large" | "unavailable" | "invalid_file";

// Decorative bar heights; the skeleton is aria-hidden and carries no data.
const skeletonBars = [42, 63, 38, 71, 48, 56, 30, 66, 44, 78, 52, 35, 60, 47, 73, 40, 58, 68, 33, 62, 50, 76, 37, 55, 45, 70, 31, 64, 53, 43];

function StatsSkeleton() {
  return <div className="usage-stats__skeleton" aria-hidden="true">
    <div className="usage-stats__skeleton-presets"><span /><span /><span /><span /><span /></div>
    <div className="usage-stats__skeleton-filters"><span /><span /><span /></div>
    <div className="usage-stats__skeleton-summary">
      <div><span className="usage-stats__skeleton-label" /><span className="usage-stats__skeleton-total" /><span className="usage-stats__skeleton-sub" /></div>
      <div className="usage-stats__skeleton-facts"><span /><span /><span /></div>
      <div className="usage-stats__skeleton-cost"><span className="usage-stats__skeleton-label" /><span className="usage-stats__skeleton-amount" /><span className="usage-stats__skeleton-sub" /></div>
    </div>
    <div className="usage-stats__skeleton-section">
      <div className="usage-stats__skeleton-heading"><span /><span /></div>
      <div className="usage-stats__skeleton-plot">{skeletonBars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div>
      <div className="usage-stats__skeleton-axis"><span /><span /></div>
    </div>
    <div className="usage-stats__skeleton-section">
      <div className="usage-stats__skeleton-heading"><span /><span /></div>
      <div className="usage-stats__skeleton-table"><span /><span /><span /><span /><span /><span /></div>
    </div>
  </div>;
}

export function StatsDashboard({ todayUtcDay, remoteEnabled = false, startWithAccount = false, fallback, returnTo = "/dashboard" }: Readonly<{
  todayUtcDay: number; remoteEnabled?: boolean; startWithAccount?: boolean; fallback?: ReactNode; returnTo?: string;
}>) {
  const [stored, setLoaded] = useState<Loaded | null>(null);
  const [facts, setFacts] = useState<Readonly<{ document: RichFactsDocument | null; absence: RichExplorerAbsence | null; name: string | null }>>({ document: null, absence: null, name: null });
  const factsPicker = useRef<HTMLInputElement>(null), factsSequence = useRef(0);
  const importFacts = async (file: File) => {
    const id = ++factsSequence.current;
    if (!Number.isSafeInteger(file.size) || file.size > RICH_FACT_MAX_BYTES) { setFacts({ document: null, absence: "invalid", name: null }); return; }
    let opened: Awaited<ReturnType<typeof openRichFactsDocument>>;
    try { opened = await openRichFactsDocument(await file.text()); } catch { opened = { ok: false, error: "invalid_rich_facts" }; }
    if (factsSequence.current !== id) return;
    if (opened.ok) setFacts({ document: opened.value, absence: null, name: file.name });
    else setFacts({ document: null, absence: opened.error === "session_window_limit" ? "window" : opened.error === "record_limit" || opened.error === "body_limit" ? "limit" : "invalid", name: null });
  };
  const closeFacts = () => { factsSequence.current++; setFacts({ document: null, absence: null, name: null }); };
  const generation = useAccountGeneration();
  const loaded = stored?.scope === "account" && (stored.authority.generation !== generation || !currentUsageAccountScope(stored.authority)) ? null : stored;
  const [status, setStatus] = useState<Status>(startWithAccount ? "loading" : "idle");
  const [range, setRange] = useState<StatsRange>({ firstUtcDay: Math.max(0, todayUtcDay - 29), dayCount: Math.min(30, todayUtcDay + 1) });
  const pending = useRef({ id: 0, controller: null as AbortController | null,
    kind: null as "account" | "local" | "example" | null, loaded: null as Loaded | null });
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const lifecycleOwner = pending.current;
    const release = retainUsageAccountLifecycle();
    const unsubscribe = subscribeUsageAccountInvalidation(reason => {
      const owner = pending.current;
      const hadAccountWork = owner.loaded?.scope === "account" || owner.kind === "account";
      // Identity adoption discards payloads through generation tickets; its caller owns one fresh read.
      // Local worker admission is independent of every account boundary.
      if (reason !== "identity-changed" && owner.kind === "account" && owner.controller !== null) {
        owner.id++; owner.controller.abort(); owner.controller = null; owner.kind = null;
      }
      if (owner.loaded?.scope === "account") { owner.loaded.session.close(); owner.loaded = null; setLoaded(null); }
      if (reason === "confirmed-signout" || reason === "authentication-required") setStatus("authentication_required");
      else if (hadAccountWork) setStatus(owner.controller === null ? "unavailable" : "loading");
    });
    return () => {
      unsubscribe(); release();
      lifecycleOwner.id++; lifecycleOwner.controller?.abort(); lifecycleOwner.loaded?.session.close(); lifecycleOwner.loaded = null;
    };
  }, []);

  const read = useCallback(async (selected: StatsRange, id: number, controller: AbortController, selection?: StatsSelection) => {
    const owner = pending.current;
    const deadline = new StatsReadDeadline(controller.signal);
    const expired = () => { if (owner.id === id && !controller.signal.aborted) setStatus("unavailable"); };
    deadline.signal.addEventListener("abort", expired, { once: true });
    try {
      const bound = await readInUsageAccountGeneration(signal => readAccountStats(selected.firstUtcDay, selected.dayCount, signal ?? controller.signal, {
        statsDeadline: deadline,
        onAuthenticationRequired: () => {
          if (owner.id === id && deadline.active() && owner.loaded?.scope === "account") {
            owner.loaded.session.close(); owner.loaded = null; setLoaded(null);
          }
        },
      }), reply => reply.accountId ?? null, () => owner.id === id && deadline.active(),
      reply => !reply.ok && reply.error === "authentication_required", { signal: deadline.signal, dispose: disposeStatsReadReply });
      if (owner.id !== id || !deadline.active()) { if (bound !== null) disposeStatsReadReply(bound.reply); return; }
      if (bound === null) { setStatus("unavailable"); return; }
      const { reply, scope: authority } = bound;
      // A revalidated identical window keeps the view's version so its
      // selection survives; any other scope or window remounts as before.
      if (reply.ok) {
        const session = reply.session;
        if (authority === null || !currentUsageAccountScope(authority)) { session.close(); setStatus("unavailable"); return; }
        const previous = owner.loaded, next: Loaded = {
          report: session.metadata, session, scope: "account", authority, selection,
          version: previous?.scope === "account" && previous.authority.accountId === authority.accountId
            && previous.authority.generation === authority.generation && previous.report.firstUtcDay === selected.firstUtcDay
            && previous.report.dayCount === selected.dayCount ? previous.version : id,
        };
        previous?.session.close(); owner.loaded = next; setLoaded(next);
        setRange(selected); setStatus("ready");
      }
      else {
        const code = reply.error;
        setStatus(code === "authentication_required" ? "authentication_required"
          : code === "not_started" ? "stats_not_started" : code === "not_enrolled" ? "not_enrolled" : code === "range_too_large" ? "range_too_large" : "unavailable");
      }
    } catch { if (owner.id === id && !controller.signal.aborted) setStatus("unavailable"); }
    finally { deadline.signal.removeEventListener("abort", expired); deadline.finish(); if (owner.id === id) { owner.controller = null; owner.kind = null; } }
  }, []);

  const loadAccount = (selected = range, selection?: StatsSelection) => {
    if (!remoteEnabled) return;
    const owner = pending.current, id = ++owner.id;
    owner.controller?.abort(); const controller = new AbortController(); owner.controller = controller; owner.kind = "account";
    setStatus("loading"); void read(selected, id, controller, selection);
  };
  useEffect(() => {
    const owner = pending.current;
    if (remoteEnabled) warmUsageAccountSession();
    if (startWithAccount && remoteEnabled) {
      const id = ++owner.id, controller = new AbortController(); owner.controller = controller; owner.kind = "account";
      const initial = { firstUtcDay: Math.max(0, todayUtcDay - 29), dayCount: Math.min(30, todayUtcDay + 1) };
      void read(initial, id, controller);
    }
    return () => { owner.id++; owner.controller?.abort(); owner.controller = null; owner.kind = null; };
  }, [read, remoteEnabled, startWithAccount, todayUtcDay]);

  const importFile = async (file: File) => {
    const owner = pending.current, id = ++owner.id; owner.controller?.abort();
    const controller = new AbortController(); owner.controller = controller; owner.kind = "local";
    setStatus("loading");
    try {
      const session = await MetricReportSession.open(file, controller.signal);
      if (owner.id !== id || controller.signal.aborted) { session.close(); return; }
      owner.loaded?.session.close();
      owner.loaded = { report: session.metadata, session, scope: "local", version: id };
      setLoaded(owner.loaded); setStatus("ready");
    } catch { if (owner.id === id) setStatus("invalid_file"); }
    finally { if (owner.id === id) { owner.controller = null; owner.kind = null; } }
  };
  const example = async () => {
    const owner = pending.current, id = ++owner.id; owner.controller?.abort();
    const controller = new AbortController(); owner.controller = controller; owner.kind = "example";
    setStatus("loading");
    try {
      const session = await MetricReportSession.open(createUsageStatsExample(todayUtcDay), controller.signal);
      if (owner.id !== id || controller.signal.aborted) { session.close(); return; }
      owner.loaded?.session.close();
      owner.loaded = { report: session.metadata, session, scope: "example", version: id };
      setLoaded(owner.loaded); setStatus("ready");
    } catch { if (owner.id === id) setStatus("invalid_file"); }
    finally { if (owner.id === id) { owner.controller = null; owner.kind = null; } }
  };
  const clear = () => {
    const owner = pending.current; owner.id++; owner.controller?.abort(); owner.controller = null;
    owner.kind = null; owner.loaded?.session.close(); owner.loaded = null;
    setLoaded(null); setStatus("idle");
  };
  const showFallback = status === "stats_not_started" && loaded === null && fallback !== undefined;
  const sourceControls = <>
    <button className="usage-button usage-button--quiet" type="button" onClick={() => picker.current?.click()}>{loaded?.scope === "local" ? "Replace local report" : "Open local report"}</button>
    <button className="usage-stats__text-button" type="button" onClick={example}>Explore example</button>
    {remoteEnabled && !showFallback && <button className="usage-stats__text-button" type="button" onClick={() => loadAccount()} disabled={status === "loading"}>Load account</button>}
    {loaded && <button className="usage-stats__text-button" type="button" onClick={clear}>Close report</button>}
    {loaded && loaded.scope !== "account" && <button className="usage-stats__text-button" type="button" onClick={() => factsPicker.current?.click()}>{facts.document ? "Replace session facts" : "Open session facts"}</button>}
    {facts.document && <button className="usage-stats__text-button" type="button" onClick={closeFacts}>Close session facts</button>}
    <Link href="/usage/sessions">Session timing</Link>
  </>;
  return <>
    {!showFallback && <header className="usage-stats-heading"><div><h1>Your usage</h1>{!loaded && <p>Tokens, models, and the sources behind them.</p>}</div>
      <span>{loaded?.scope === "account" ? "Private to your account" : loaded?.scope === "example" ? "Example data · synthetic" : "Local reports stay in this browser"}</span>
    </header>}
    <div className="usage-stats-source" aria-label="Choose usage data">
      <input ref={picker} type="file" accept=".json,application/json" hidden aria-label="Open numeric usage report" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file);
      }} />
      <input ref={factsPicker} type="file" accept=".json,application/json" hidden aria-label="Open session facts" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFacts(file);
      }} />
      {loaded ? <details className="usage-stats-source__menu"><summary>Change report</summary><div>{sourceControls}</div></details> : sourceControls}
    </div>
    <p className="usage-stats__sr" role="status">{status === "loading" ? "Loading numeric usage." : status === "ready" ? `${loaded?.scope === "example" ? "Synthetic example" : loaded?.scope === "local" ? "Local report" : "Account usage"} loaded.` : ""}</p>
    {facts.absence !== null && <p className="usage-stats__notice" role="alert">{facts.absence === "window" ? "Session facts support at most 31 days between the first and last observation. Open a report with a shorter window." : facts.absence === "limit" ? "This session-facts file exceeds the bounded record limit. Open a smaller report." : "This file could not be read as session facts. Choose a session-observations-v1 or rich-facts-v1 JSON file up to 8 MiB. Any facts loaded before are closed."}</p>}
    {status === "invalid_file" && <p className="usage-stats__notice" role="alert">This file could not be read as a numeric usage report. Choose a client-stats-v2 JSON report up to 32 MiB. Your previous report is unchanged.</p>}
    {status === "unavailable" && <div className="usage-stats__notice" role="alert"><strong>Account usage could not be loaded</strong>
      <p>Your saved measurements have not changed. Any report below is the last one loaded. You can retry, request a shorter period, or inspect a local report.</p>
      {remoteEnabled && <><button className="usage-stats__text-button" type="button" onClick={() => loadAccount(range)}>Try again</button>{" · "}<button className="usage-stats__text-button" type="button" onClick={() => loadAccount({ firstUtcDay: Math.max(0, todayUtcDay - 6), dayCount: Math.min(7, todayUtcDay + 1) })}>Load last 7 days</button></>}
    </div>}
    {status === "range_too_large" && <div className="usage-stats__notice" role="alert"><strong>This period has too much detail to load at once</strong><p>Choose a shorter period. No records have been truncated; any report below is the last one loaded.</p><button className="usage-stats__text-button" type="button" onClick={() => loadAccount({ firstUtcDay: Math.max(0, todayUtcDay - 6), dayCount: Math.min(7, todayUtcDay + 1) })}>Load last 7 days</button></div>}
    {status === "authentication_required" && <div className="usage-stats__notice"><h2>Sign in to view your usage</h2><p>Use your Hraness account for private measurements. Local reports work without signing in.</p>
      <form action="/api/suite-auth/start" method="get"><input type="hidden" name="return_to" value={returnTo} /><button className="usage-button usage-button--primary" type="submit">Sign in with Hraness</button></form></div>}
    {status === "not_enrolled" && <div className="usage-stats__notice"><h2>No collector connected</h2><p>Enroll a device to sync accepted measurements to your account. You can inspect a local numeric report now.</p><Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-local.md">Local collector guide</Link></div>}
    {showFallback ? fallback : status === "stats_not_started" ? <div className="usage-stats__notice"><h2>No detailed snapshot yet</h2><p>Your existing daily measurements remain available. Any report below is the last one loaded. Open a detailed local report to inspect model and token breakdowns.</p><Link className="usage-inline-link" href="/dashboard">View account overview</Link></div> : null}
    {loaded && <StatsReportView key={loaded.version} report={loaded.report} session={loaded.session} scope={loaded.scope} todayUtcDay={todayUtcDay}
      captureExport={() => {
        const id = pending.current.id;
        return () => pending.current.id === id && (loaded.scope !== "account" || currentUsageAccountScope(loaded.authority));
      }}
      rich={loaded.scope === "account" ? { document: null, absence: "hosted" } satisfies RichExplorerSource
        : { document: facts.document, absence: facts.document ? null : "not-loaded", onOpen: () => factsPicker.current?.click(), label: facts.name === null ? undefined : `Session facts from ${facts.name}` } satisfies RichExplorerSource}
      initialSelection={loaded.selection} busy={status === "loading"} onRangeRequest={loaded.scope === "account" ? loadAccount : undefined} onRefresh={loaded.scope === "account" ? filters => loadAccount({ firstUtcDay: filters.firstUtcDay, dayCount: filters.dayCount }, { client: filters.client, provider: filters.provider, model: filters.model, basis: filters.basis }) : undefined} />}
    {status === "loading" && !loaded && <StatsSkeleton />}
    {status === "idle" && <section className="usage-stats__empty"><h2>See the whole usage picture</h2><p>Open a numeric report to compare clients and models, inspect daily trends, and export exact totals. The file stays in this browser; opening it does not publish or upload anything.</p>
      <button className="usage-button usage-button--primary" type="button" onClick={example}>Explore a working example</button>
      <p><Link href="https://github.com/hraness/aicharts/blob/main/docs/usage-details.md">Create a numeric report with the local collector</Link></p></section>}
  </>;
}
