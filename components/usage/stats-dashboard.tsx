"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { readAccountStats, warmUsageAccountSession } from "@/lib/usage/account-read-client";
import { subscribeUsageAccountSignOut } from "@/lib/usage/account-session-events";
import type { UsageStatsReport } from "@/lib/usage/stats-contract";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { cachedStatsReport, clearStatsReports, rememberStatsReport } from "./stats-report-cache";
import { readStatsReportFile } from "./stats-report-file";
import { StatsReportView } from "./stats-report-view";
import type { StatsRange, StatsSelection } from "./stats-view";

type Loaded = { report: UsageStatsReport; scope: "account" | "local" | "example"; version: number; selection?: StatsSelection };
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
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<Status>(startWithAccount ? "loading" : "idle");
  const [range, setRange] = useState<StatsRange>({ firstUtcDay: Math.max(0, todayUtcDay - 29), dayCount: Math.min(30, todayUtcDay + 1) });
  const pending = useRef({ id: 0, controller: null as AbortController | null });
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeUsageAccountSignOut(() => {
    const owner = pending.current;
    // A local file parse has no controller and must be allowed to finish.
    if (owner.controller !== null) { owner.id++; owner.controller.abort(); owner.controller = null; }
    setLoaded(previous => previous?.scope === "account" ? null : previous);
    setStatus("authentication_required");
  }), []);

  const read = useCallback(async (selected: StatsRange, id: number, controller: AbortController, selection?: StatsSelection) => {
    const owner = pending.current;
    const deadline = setTimeout(() => { controller.abort(); if (owner.id === id) setStatus("unavailable"); }, 20_000);
    try {
      const reply = await readAccountStats(selected.firstUtcDay, selected.dayCount, controller.signal, {
        onAuthenticationRequired: () => {
          clearStatsReports();
          if (owner.id === id && !controller.signal.aborted) setLoaded(previous =>
            owner.id === id && !controller.signal.aborted && previous?.scope === "account" ? null : previous);
        },
      });
      if (owner.id !== id || controller.signal.aborted) return;
      // A revalidated identical window keeps the view's version so its
      // selection survives; any other scope or window remounts as before.
      if (reply.ok) {
        rememberStatsReport(selected, reply.value);
        setLoaded(previous => ({
          report: reply.value, scope: "account", selection,
          version: previous?.scope === "account" && previous.report.firstUtcDay === selected.firstUtcDay
            && previous.report.dayCount === selected.dayCount ? previous.version : id,
        }));
        setRange(selected); setStatus("ready");
      }
      else {
        const code = reply.error;
        setStatus(code === "authentication_required" ? "authentication_required"
          : code === "not_started" ? "stats_not_started" : code === "not_enrolled" ? "not_enrolled" : code === "range_too_large" ? "range_too_large" : "unavailable");
      }
    } catch { if (owner.id === id && !controller.signal.aborted) setStatus("unavailable"); }
    finally { clearTimeout(deadline); if (owner.id === id) owner.controller = null; }
  }, []);

  const loadAccount = (selected = range, selection?: StatsSelection) => {
    if (!remoteEnabled) return;
    const owner = pending.current, id = ++owner.id;
    owner.controller?.abort(); const controller = new AbortController(); owner.controller = controller;
    const cached = cachedStatsReport(selected);
    if (cached !== undefined) setLoaded({ report: cached, scope: "account", version: id, selection });
    setStatus("loading"); void read(selected, id, controller, selection);
  };
  useEffect(() => {
    const owner = pending.current;
    if (remoteEnabled) warmUsageAccountSession();
    if (startWithAccount && remoteEnabled) {
      const id = ++owner.id, controller = new AbortController(); owner.controller = controller;
      const initial = { firstUtcDay: Math.max(0, todayUtcDay - 29), dayCount: Math.min(30, todayUtcDay + 1) };
      const cached = cachedStatsReport(initial);
      if (cached !== undefined) setLoaded({ report: cached, scope: "account", version: id });
      void read(initial, id, controller);
    }
    return () => { owner.id++; owner.controller?.abort(); };
  }, [read, remoteEnabled, startWithAccount, todayUtcDay]);

  const importFile = async (file: File) => {
    const owner = pending.current, id = ++owner.id; owner.controller?.abort(); owner.controller = null;
    setStatus("loading");
    try {
      const report = await readStatsReportFile(file);
      if (owner.id === id) { setLoaded({ report, scope: "local", version: id }); setStatus("ready"); }
    } catch { if (owner.id === id) setStatus("invalid_file"); }
  };
  const example = () => {
    const owner = pending.current, id = ++owner.id; owner.controller?.abort(); owner.controller = null;
    setLoaded({ report: createUsageStatsExample(todayUtcDay), scope: "example", version: id }); setStatus("ready");
  };
  const clear = () => {
    const owner = pending.current; owner.id++; owner.controller?.abort(); owner.controller = null;
    setLoaded(null); setStatus("idle");
  };
  const showFallback = status === "stats_not_started" && loaded === null && fallback !== undefined;
  const sourceControls = <>
    <button className="usage-button usage-button--quiet" type="button" onClick={() => picker.current?.click()}>{loaded?.scope === "local" ? "Replace local report" : "Open local report"}</button>
    <button className="usage-stats__text-button" type="button" onClick={example}>Explore example</button>
    {remoteEnabled && !showFallback && <button className="usage-stats__text-button" type="button" onClick={() => loadAccount()} disabled={status === "loading"}>Load account</button>}
    {loaded && <button className="usage-stats__text-button" type="button" onClick={clear}>Close report</button>}
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
      {loaded ? <details className="usage-stats-source__menu"><summary>Change report</summary><div>{sourceControls}</div></details> : sourceControls}
    </div>
    <p className="usage-stats__sr" role="status">{status === "loading" ? "Loading numeric usage." : status === "ready" ? `${loaded?.scope === "example" ? "Synthetic example" : loaded?.scope === "local" ? "Local report" : "Account usage"} loaded.` : ""}</p>
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
    {loaded && <StatsReportView key={loaded.version} report={loaded.report} scope={loaded.scope} todayUtcDay={todayUtcDay}
      initialSelection={loaded.selection} busy={status === "loading"} onRangeRequest={loaded.scope === "account" ? loadAccount : undefined} onRefresh={loaded.scope === "account" ? filters => loadAccount({ firstUtcDay: filters.firstUtcDay, dayCount: filters.dayCount }, { client: filters.client, provider: filters.provider, model: filters.model, basis: filters.basis }) : undefined} />}
    {status === "loading" && !loaded && <StatsSkeleton />}
    {status === "idle" && <section className="usage-stats__empty"><h2>See the whole usage picture</h2><p>Open a numeric report to compare clients and models, inspect daily trends, and export exact totals. The file stays in this browser; opening it does not publish or upload anything.</p>
      <button className="usage-button usage-button--primary" type="button" onClick={example}>Explore a working example</button>
      <p><Link href="https://github.com/hraness/aicharts/blob/main/docs/usage-details.md">Create a numeric report with the local collector</Link></p></section>}
  </>;
}
