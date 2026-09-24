"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readAccountTotals, warmUsageAccountSession } from "@/lib/usage/account-read-client";
import { retainUsageAccountLifecycle } from "@/lib/usage/account-session-events";
import { currentUsageAccountScope, subscribeUsageAccountInvalidation, type UsageAccountScope } from "@/lib/usage/account-generation";
import { readInUsageAccountGeneration } from "@/lib/usage/account-generation-read";
import { statsTotalsTokenTotal, type StatsTotals, type StatsTotalsCell } from "@/lib/usage/stats-totals-contract";
import { formatStatsCompact, formatStatsDay, formatStatsInteger, statsLabel } from "./stats-view";
import { useAccountGeneration } from "./use-account-generation";

export type TotalsPanelState = "loading" | "ready" | "authentication_required" | "not_enrolled" | "unavailable";
const basisText = { snapshots: "current reports", legacy: "earlier uploads", mixed: "reports and earlier uploads" } as const;
const tokensOf = (cell: StatsTotalsCell) => statsTotalsTokenTotal(cell.tokens);
const shortDevice = (deviceId: string) => `${deviceId.slice(0, 8)}…`;
function span(cell: StatsTotalsCell): string {
  if (cell.firstUtcDay === null || cell.lastUtcDay === null) return "no days yet";
  return cell.firstUtcDay === cell.lastUtcDay ? formatStatsDay(cell.firstUtcDay) : `${formatStatsDay(cell.firstUtcDay)} to ${formatStatsDay(cell.lastUtcDay)}`;
}

/** All-time totals for the signed-in account, summed across every enrolled
 * device. This is the figure to compare with other trackers; the windowed
 * report below it covers one period at a time. */
export function UsageTotalsPanel({ returnTo }: Readonly<{ returnTo: string }>) {
  const [state, setState] = useState<TotalsPanelState>("loading");
  const [totals, setTotals] = useState<StatsTotals | null>(null);
  const [authority, setAuthority] = useState<UsageAccountScope | null>(null);
  const owner = useRef({ id: 0, controller: null as AbortController | null, mounted: false });
  const generation = useAccountGeneration();
  const visible = authority !== null && authority.generation === generation && currentUsageAccountScope(authority) ? totals : null;

  const read = useCallback(async () => {
    const current = owner.current, id = ++current.id;
    current.controller?.abort();
    const controller = new AbortController(); current.controller = controller;
    const deadline = setTimeout(() => { controller.abort(); if (current.id === id) { setTotals(null); setState("unavailable"); } }, 20_000);
    try {
      const bound = await readInUsageAccountGeneration(() => readAccountTotals(controller.signal, { onAuthenticationRequired: () => {
        if (current.id === id && !controller.signal.aborted) setTotals(null);
      } }), reply => reply.accountId, () => current.id === id && !controller.signal.aborted,
      reply => !reply.ok && reply.error === "authentication_required");
      if (current.id !== id || controller.signal.aborted) return;
      if (bound === null) { setAuthority(null); setTotals(null); setState("unavailable"); return; }
      const { reply, scope } = bound;
      if (reply.ok && scope !== null && currentUsageAccountScope(scope)) { setAuthority(scope); setTotals(reply.value); setState("ready"); }
      else if (reply.ok) { setAuthority(null); setTotals(null); setState("unavailable"); }
      else { setAuthority(null); setTotals(null); setState(reply.error === "authentication_required" ? "authentication_required" : reply.error === "not_enrolled" ? "not_enrolled" : "unavailable"); }
    } catch {
      if (current.id === id && !controller.signal.aborted) { setTotals(null); setState("unavailable"); }
    } finally { clearTimeout(deadline); if (current.id === id) current.controller = null; }
  }, []);
  useEffect(() => {
    const current = owner.current; current.mounted = true;
    const release = retainUsageAccountLifecycle();
    const unsubscribe = subscribeUsageAccountInvalidation(reason => {
      setAuthority(null); setTotals(null);
      if (reason === "identity-changed") { setState("loading"); if (current.controller === null) void read(); return; }
      current.id++; current.controller?.abort(); current.controller = null;
      setState(reason === "confirmed-signout" || reason === "authentication-required" ? "authentication_required" : "unavailable");
    });
    warmUsageAccountSession();
    void Promise.resolve().then(() => { if (current.mounted) return read(); });
    return () => { current.mounted = false; current.id++; current.controller?.abort(); unsubscribe(); release(); };
  }, [read]);
  return <UsageTotalsView state={state} totals={visible} returnTo={returnTo} retry={() => { setState("loading"); void read(); }} />;
}

export function UsageTotalsView({ state, totals, returnTo, retry }: Readonly<{ state: TotalsPanelState; totals: StatsTotals | null; returnTo: string; retry: () => void }>) {
  if (state === "loading" || (state === "ready" && totals === null)) {
    return <section className="usage-totals" aria-busy="true" aria-labelledby="usage-totals-title"><h2 id="usage-totals-title">All time</h2><p className="usage-totals__muted">Loading your account totals.</p></section>;
  }
  if (state === "authentication_required") {
    return <section className="usage-totals" aria-labelledby="usage-totals-title"><h2 id="usage-totals-title">All time</h2>
      <p>Sign in to see the totals for every device on your account.</p>
      <a className="usage-button usage-button--primary" href={`/api/suite-auth/start?return_to=${encodeURIComponent(returnTo)}`}>Sign in</a></section>;
  }
  if (state === "not_enrolled") {
    return <section className="usage-totals" aria-labelledby="usage-totals-title"><h2 id="usage-totals-title">All time</h2>
      <p>No device has published usage to this account yet. Enroll a collector to start.</p></section>;
  }
  if (state === "unavailable" || totals === null) {
    return <section className="usage-totals" role="alert" aria-labelledby="usage-totals-title"><h2 id="usage-totals-title">All time</h2>
      <p>Account totals are unavailable right now. Your saved measurements are unchanged.</p>
      <button className="usage-stats__text-button" type="button" onClick={retry}>Try again</button></section>;
  }
  const total = tokensOf(totals.total);
  return <section className="usage-totals" aria-labelledby="usage-totals-title">
    <div className="usage-totals__headline">
      <h2 id="usage-totals-title">All time</h2>
      <p className="usage-totals__figure"><strong>{formatStatsCompact(total)}</strong> tokens <span className="usage-totals__muted">({formatStatsInteger(total)})</span></p>
      <p className="usage-totals__muted">{formatStatsInteger(totals.total.records)} records over {formatStatsInteger(totals.total.days)} days, {span(totals.total)}, across {totals.devices.length} {totals.devices.length === 1 ? "device" : "devices"}.</p>
      {!totals.legacyComplete && <p className="usage-totals__notice">Earlier uploads are still being indexed ({formatStatsInteger(totals.legacyVerifiedRevision)} of {formatStatsInteger(totals.legacyRevision)} batches). Totals grow as indexing finishes.</p>}
    </div>
    <div className="usage-totals__tables">
      <table className="usage-totals__table"><caption>By client</caption>
        <thead><tr><th scope="col">Client</th><th scope="col">Tokens</th><th scope="col">Records</th><th scope="col">Days</th><th scope="col">Source</th></tr></thead>
        <tbody>{totals.clients.map(client => <tr key={client.client}>
          <th scope="row">{statsLabel(client.client, "client")}</th><td>{formatStatsCompact(tokensOf(client))}</td><td>{formatStatsInteger(client.records)}</td>
          <td>{formatStatsInteger(client.days)}</td><td>{basisText[client.basis]}</td></tr>)}</tbody>
      </table>
      <table className="usage-totals__table"><caption>By device</caption>
        <thead><tr><th scope="col">Device</th><th scope="col">Tokens</th><th scope="col">Records</th><th scope="col">Days</th><th scope="col">Clients</th></tr></thead>
        <tbody>{totals.devices.map(device => <tr key={device.deviceId}>
          <th scope="row"><code>{shortDevice(device.deviceId)}</code>{device.revokedAtMs !== null && <span className="usage-totals__muted"> (revoked)</span>}<span className="usage-totals__muted"> enrolled {formatStatsDay(Math.floor(device.enrolledAtMs / 86_400_000))}</span></th>
          <td>{formatStatsCompact(tokensOf(device))}</td><td>{formatStatsInteger(device.records)}</td><td>{formatStatsInteger(device.days)}</td>
          <td>{device.clients.map(client => statsLabel(client.client, "client")).join(", ") || "none yet"}</td></tr>)}</tbody>
      </table>
    </div>
  </section>;
}
