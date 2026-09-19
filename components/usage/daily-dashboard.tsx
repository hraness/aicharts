"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { privateDaysInputRange, readPrivateDays, utcDayInput } from "@/lib/usage/private-days-client";
import type { PrivateDaysV1, ProviderImportedTotals } from "@/lib/usage/private-days-contract";
import type { PrivateDaysPublicReply, PrivateDaysRange } from "@/lib/usage/private-days-public";

type View = { kind: "loading" } | { kind: "unavailable" } | { kind: "invalid_dates" } | { kind: "reply"; reply: PrivateDaysPublicReply };
const number = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const providers = [{ key: "codex", name: "Codex" }, { key: "claudeCode", name: "Claude Code" }, { key: "devin", name: "Devin" }] as const;
const formattedDay = (day: number) => date.format(new Date(day * 86_400_000));
const tokens = (value: string) => number.format(BigInt(value));
const presets = [{ days: 1, label: "Today" }, { days: 7, label: "Last 7 days" }, { days: 30, label: "Last 30 days" }] as const;

/** Calendar days anchored to the server UTC day, including today. */
export function dailyUsagePresetRange(todayUtcDay: number, days: 1 | 7 | 30): PrivateDaysRange {
  return { firstUtcDay: Math.max(0, todayUtcDay - days + 1), dayCount: Math.min(days, todayUtcDay + 1) };
}

function summed(value: PrivateDaysV1, key: "codex" | "claudeCode" | "devin"): ProviderImportedTotals {
  let total = 0n, output = 0n, count = 0;
  for (const day of value.days) {
    total += BigInt(day[key].observedAccountedTokens);
    output += BigInt(day[key].observedOutputTokens);
    count += day[key].usageOccurrences;
  }
  return { observedAccountedTokens: total.toString(), observedOutputTokens: output.toString(), usageOccurrences: count };
}

function Measurements({ value }: Readonly<{ value: PrivateDaysV1 }>) {
  const totals = providers.map(provider => ({ ...provider, totals: summed(value, provider.key) }));
  const records = totals.reduce((sum, provider) => sum + provider.totals.usageOccurrences, 0);
  let maximum = 0n;
  for (const day of value.days) for (const provider of providers) {
    const count = BigInt(day[provider.key].observedAccountedTokens);
    if (count > maximum) maximum = count;
  }
  const height = (value: string) => `${maximum === 0n ? 0 : Number(BigInt(value) * 10_000n / maximum) / 100}%`;
  return <>
    <div className="usage-daily__coverage">
      <p><strong>Partial coverage</strong> · Imported token records only. Missing records are unknown; a zero does not prove there was no activity.</p>
      <p>{value.journalCommittedAtMs === null ? "No recorded sync yet." : <>Last recorded sync: <time dateTime={new Date(value.journalCommittedAtMs).toISOString()}>{time.format(value.journalCommittedAtMs)} UTC</time>.</>}</p>
    </div>
    <div className="usage-daily__totals" aria-label="Provider totals for the selected dates">
      {totals.map(provider => <section key={provider.key} aria-labelledby={`usage-total-${provider.key}`}>
        <h2 id={`usage-total-${provider.key}`}><span className={`usage-daily__key usage-daily__key--${provider.key}`} aria-hidden="true" />{provider.name}</h2>
        <dl>
          <div><dt>Observed tokens</dt><dd>{tokens(provider.totals.observedAccountedTokens)}</dd></div>
          <div><dt>Output tokens</dt><dd>{tokens(provider.totals.observedOutputTokens)}</dd></div>
          <div><dt>Usage records</dt><dd>{number.format(provider.totals.usageOccurrences)}</dd></div>
        </dl>
      </section>)}
    </div>
    {records === 0 ? <div className="usage-daily__notice">
      <h2>No observations in these dates</h2>
      <p>Your account is connected, but this range has no accepted token records. Try other dates or check your local collector.</p>
    </div> : <figure className="usage-daily__figure">
      <figcaption><strong>Observed tokens by day</strong><span>Codex solid · Claude Code outlined · Devin muted</span></figcaption>
      <div className="usage-daily__plot" aria-hidden="true">
        {value.days.map(day => <div className="usage-daily__day" key={day.utcDay}
          title={`${formattedDay(day.utcDay)}: ${providers.map(provider => `${provider.name} ${tokens(day[provider.key].observedAccountedTokens)}`).join("; ")}`}>
          {providers.map(provider => <span className={`usage-daily__bar usage-daily__bar--${provider.key}`} key={provider.key}
            style={{ height: height(day[provider.key].observedAccountedTokens) }} />)}
        </div>)}
      </div>
      <div className="usage-daily__axis" aria-hidden="true"><span>{formattedDay(value.firstUtcDay)}</span><span>{formattedDay(value.firstUtcDay + value.days.length - 1)}</span></div>
      <p className="usage-daily__hint">Exact daily values are in the table below. Output tokens are included in observed tokens.</p>
    </figure>}
    <details className="usage-daily__details" open>
      <summary>Daily records <span>{number.format(records)} records · {value.days.length} UTC days</span></summary>
      <div className="usage-daily__table-scroll" role="region" aria-label="Daily usage, scroll horizontally for all columns" tabIndex={0}>
        <table>
          <caption>Observed token records, {formattedDay(value.firstUtcDay)}–{formattedDay(value.firstUtcDay + value.days.length - 1)}. Coverage is partial.</caption>
          <thead><tr><th scope="col">UTC day</th><th scope="col">Provider</th><th scope="col">Observed tokens</th><th scope="col">Output tokens</th><th scope="col">Usage records</th></tr></thead>
          {value.days.map(day => <tbody key={day.utcDay}>{providers.map((provider, index) => <tr key={provider.key} className={index === 0 ? "usage-daily__row-start" : undefined}>
            {index === 0 && <th scope="rowgroup" rowSpan={providers.length}><time dateTime={utcDayInput(day.utcDay)}>{formattedDay(day.utcDay)}</time></th>}
            <th scope="row">{provider.name}</th><td>{tokens(day[provider.key].observedAccountedTokens)}</td><td>{tokens(day[provider.key].observedOutputTokens)}</td><td>{number.format(day[provider.key].usageOccurrences)}</td>
          </tr>)}</tbody>)}
        </table>
      </div>
    </details>
    <p className="usage-daily__hint">Usage records are not human prompts. These measurements do not establish spending, runtime, throughput or productivity.</p>
  </>;
}

export function DailyUsageDashboard({ todayUtcDay }: Readonly<{ todayUtcDay: number }>) {
  const initialRange = dailyUsagePresetRange(todayUtcDay, 30);
  const [first, setFirst] = useState(utcDayInput(initialRange.firstUtcDay));
  const [last, setLast] = useState(utcDayInput(todayUtcDay));
  const [range, setRange] = useState<PrivateDaysRange>(initialRange);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [inputError, setInputError] = useState<string | null>(null);
  const requests = useRef({ id: 0, pending: null as AbortController | null });

  const read = useCallback(async (selected: PrivateDaysRange, controller: AbortController, id: number) => {
    const owner = requests.current;
    const deadline = setTimeout(() => {
      controller.abort();
      if (id === owner.id) setView({ kind: "unavailable" });
    }, 20_000);
    try {
      const reply = await readPrivateDays(selected, controller.signal);
      if (id === owner.id && !controller.signal.aborted) setView({ kind: "reply", reply });
    } catch {
      if (id === owner.id) setView({ kind: "unavailable" });
    } finally {
      clearTimeout(deadline);
      if (id === owner.id) owner.pending = null;
    }
  }, []);

  const load = useCallback((selected: PrivateDaysRange) => {
    const owner = requests.current, id = ++owner.id;
    owner.pending?.abort();
    const controller = new AbortController(); owner.pending = controller;
    setView({ kind: "loading" }); setInputError(null); setRange(selected);
    void read(selected, controller, id);
  }, [read]);

  useEffect(() => {
    const owner = requests.current, id = ++owner.id;
    owner.pending?.abort();
    const controller = new AbortController(); owner.pending = controller;
    // The initial state already describes this request; only its asynchronous
    // settlement updates the view, avoiding a redundant loading render.
    void read(dailyUsagePresetRange(todayUtcDay, 30), controller, id);
    return () => { owner.id++; owner.pending?.abort(); };
  }, [read, todayUtcDay]);

  const applyPreset = (days: 1 | 7 | 30) => {
    const selected = dailyUsagePresetRange(todayUtcDay, days);
    setFirst(utcDayInput(selected.firstUtcDay)); setLast(utcDayInput(todayUtcDay));
    load(selected);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = privateDaysInputRange(first, last);
    if (selected === null) {
      requests.current.id++; requests.current.pending?.abort(); setView({ kind: "invalid_dates" });
      setInputError("Choose 1–31 days, with the start on or before the end.");
      return;
    }
    void load(selected);
  };
  const reply = view.kind === "reply" ? view.reply : null;
  const authenticationRequired = reply !== null && "error" in reply && reply.error.code === "authentication_required";
  const notEnrolled = reply !== null && "state" in reply && reply.state === "not_enrolled";
  const value = reply !== null && "state" in reply && reply.state === "ready" ? reply.value : null;
  return <section className="usage-daily" aria-labelledby="daily-usage-title">
    <header className="usage-daily__heading">
      <div><h1 id="daily-usage-title">Your daily usage</h1><p>Codex, Claude Code and Devin, with coverage attached to every total.</p></div>
      <span className="usage-daily__privacy">Private to your account</span>
    </header>
    <form className="usage-daily__controls" onSubmit={submit} aria-label="Usage date range">
      <div className="usage-daily__presets" role="group" aria-label="Quick date ranges in UTC">
        {presets.map(preset => {
          const selected = dailyUsagePresetRange(todayUtcDay, preset.days);
          const active = view.kind !== "invalid_dates" && range.firstUtcDay === selected.firstUtcDay && range.dayCount === selected.dayCount
            && first === utcDayInput(selected.firstUtcDay) && last === utcDayInput(todayUtcDay);
          return <button className="usage-button usage-button--quiet" key={preset.days} type="button"
            aria-pressed={active} aria-describedby="usage-range-hint" onClick={() => applyPreset(preset.days)}>{preset.label}</button>;
        })}
      </div>
      <label>From <input type="date" value={first} min="1970-01-01" max="9999-12-31" required aria-describedby={inputError ? "usage-date-error" : "usage-range-hint"} aria-invalid={inputError !== null} onChange={event => setFirst(event.target.value)} /></label>
      <label>Through <input type="date" value={last} min="1970-01-01" max="9999-12-31" required aria-describedby={inputError ? "usage-date-error" : "usage-range-hint"} aria-invalid={inputError !== null} onChange={event => setLast(event.target.value)} /></label>
      <button className="usage-button usage-button--primary" type="submit">Apply dates</button>
      <button className="usage-button usage-button--quiet" type="button" disabled={view.kind === "loading"} onClick={() => void load(range)}>Refresh</button>
      <span id="usage-range-hint">Up to 31 days · UTC</span>
    </form>
    {inputError !== null && <p className="usage-daily__error" id="usage-date-error" role="alert">{inputError}</p>}
    <p className="usage-daily__range">{formattedDay(range.firstUtcDay)}–{formattedDay(range.firstUtcDay + range.dayCount - 1)}</p>
    <div aria-live="polite" aria-atomic="true" className="usage-daily__announcement">
      {view.kind === "loading" ? "Loading your daily usage." : view.kind === "invalid_dates" ? "Choose a valid date range." : value !== null ? "Daily usage loaded. Coverage is partial." : authenticationRequired ? "Sign in to view your usage." : notEnrolled ? "No collector connected." : "Usage could not be loaded."}
    </div>
    {view.kind === "loading" ? <div className="usage-daily__loading" aria-hidden="true"><span /><span /><span /></div>
      : view.kind === "invalid_dates" ? null : value !== null ? <Measurements value={value} />
        : <div className="usage-daily__notice">
          <h2>{authenticationRequired ? "Sign in to view your usage" : notEnrolled ? "No collector connected" : "Usage is unavailable right now"}</h2>
          <p>{authenticationRequired ? "Use your Hraness account to see your private measurements. Public sharing is a separate choice."
            : notEnrolled ? "Accepted measurements will appear here after you enroll a device. Your local collector can still be used independently."
              : "Your measurements have not been changed. Try again when the connection is available."}</p>
          {authenticationRequired ? <form method="get" action="/api/suite-auth/start">
            <input type="hidden" name="return_to" value="/usage" />
            <button className="usage-button usage-button--primary" type="submit">Sign in with Hraness</button>
          </form>
            : notEnrolled ? <Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-local.md">Local collector guide</Link>
              : <button className="usage-button usage-button--primary" type="button" onClick={() => void load(range)}>Try again</button>}
        </div>}
  </section>;
}
