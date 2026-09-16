"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

import { leaderboardPublicHandle, type LeaderboardConsentViewV1 } from "@/lib/usage/leaderboard-contract";
import { readUsageConsent, setUsageConsent } from "@/lib/usage/consent-client";
import type { UsageConsentPublicReply } from "@/lib/usage/consent-public";

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type ConsentState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "authentication_required" }
  | { kind: "not_enrolled" }
  | { kind: "ready"; view: LeaderboardConsentViewV1 }
  | { kind: "busy"; view: LeaderboardConsentViewV1 }
  | { kind: "failed"; view: LeaderboardConsentViewV1 };

function stateOf(reply: UsageConsentPublicReply): ConsentState {
  if ("state" in reply && reply.state === "ready") return { kind: "ready", view: reply.value };
  if ("state" in reply && reply.state === "not_enrolled") return { kind: "not_enrolled" };
  if ("error" in reply && reply.error.code === "authentication_required") return { kind: "authentication_required" };
  return { kind: "unavailable" };
}

/** Explicit opt-in publishing control. Private collection never implies
 * public sharing: consent is a separate recorded decision with a chosen
 * bounded handle, and withdrawal removes the account from the published
 * index. No local persistence; the server session is the only authority. */
export function LeaderboardConsentControl() {
  const [state, setState] = useState<ConsentState>({ kind: "loading" });
  const [handle, setHandle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const requests = useRef({ id: 0, pending: null as AbortController | null });

  const settle = useCallback((reply: UsageConsentPublicReply) => {
    const next = stateOf(reply);
    setState(next);
    if (next.kind === "ready") {
      setHandle(next.view.publicHandle ?? "");
      setConfirmed(false);
    }
  }, []);

  const issue = useCallback(async (run: (signal: AbortSignal) => Promise<UsageConsentPublicReply>, fallback: ConsentState | null) => {
    const owner = requests.current, id = ++owner.id;
    owner.pending?.abort();
    const controller = new AbortController(); owner.pending = controller;
    const deadline = setTimeout(() => {
      controller.abort();
      if (id === owner.id) setState(previous => fallback ?? (previous.kind === "ready" || previous.kind === "busy" ? { kind: "failed", view: previous.view } : { kind: "unavailable" }));
    }, 20_000);
    try {
      const reply = await run(controller.signal);
      if (id === owner.id && !controller.signal.aborted) settle(reply);
    } catch {
      if (id === owner.id) setState(previous => fallback ?? (previous.kind === "ready" || previous.kind === "busy" ? { kind: "failed", view: previous.view } : { kind: "unavailable" }));
    } finally {
      clearTimeout(deadline);
      if (id === owner.id) owner.pending = null;
    }
  }, [settle]);

  useEffect(() => {
    void issue(signal => readUsageConsent(signal), null);
    const owner = requests.current;
    return () => { owner.id++; owner.pending?.abort(); };
  }, [issue]);

  const publish = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "ready" || !confirmed || !leaderboardPublicHandle(handle)) return;
    setState({ kind: "busy", view: state.view });
    void issue(signal => setUsageConsent({ consent: true, publicHandle: handle }, signal), { kind: "failed", view: state.view });
  };
  const withdraw = () => {
    if (state.kind !== "ready" && state.kind !== "failed") return;
    const view = state.view;
    setState({ kind: "busy", view });
    void issue(signal => setUsageConsent({ consent: false, publicHandle: null }, signal), { kind: "failed", view });
  };
  const retry = () => { void issue(signal => readUsageConsent(signal), null); };

  const view = state.kind === "ready" || state.kind === "busy" || state.kind === "failed" ? state.view : null;
  const busy = state.kind === "busy";
  const published = view !== null && view.consent === true;
  const handleValid = leaderboardPublicHandle(handle);
  const changed = !published || handle !== view?.publicHandle;
  return <section className="usage-consent" aria-labelledby="usage-consent-title">
    <header className="usage-daily__heading">
      <div><h2 id="usage-consent-title">Public leaderboard</h2><p>A separate, explicit choice — private collection never implies public sharing.</p></div>
      <span className="usage-daily__privacy">{published ? "Published" : "Not published"}</span>
    </header>
    <div aria-live="polite" aria-atomic="true" className="usage-daily__announcement">
      {state.kind === "loading" ? "Loading your publishing status." : state.kind === "unavailable" ? "Publishing status is unavailable." : state.kind === "authentication_required" ? "Sign in to manage publishing." : state.kind === "not_enrolled" ? "Connect a collector before publishing." : published ? "Your handle is published on the leaderboard." : "You are not publishing."}
    </div>
    {state.kind === "loading" ? <div className="usage-daily__loading" aria-hidden="true"><span /><span /><span /></div>
      : state.kind === "unavailable" ? <div className="usage-daily__notice">
          <h3>Publishing status is unavailable</h3>
          <p>Your measurements and your consent state have not been changed. Try again when the connection is available.</p>
          <button className="usage-button usage-button--primary" type="button" onClick={retry}>Try again</button>
        </div>
      : state.kind === "authentication_required" ? <div className="usage-daily__notice">
          <h3>Sign in to manage publishing</h3>
          <p>Publishing consent is recorded on your account. Sign in to choose a public handle or withdraw.</p>
          <form method="get" action="/api/suite-auth/start"><input type="hidden" name="return_to" value="/usage" />
            <button className="usage-button usage-button--primary" type="submit">Sign in with Hraness</button></form>
        </div>
      : state.kind === "not_enrolled" ? <div className="usage-daily__notice">
          <h3>Connect a collector first</h3>
          <p>Only an enrolled account can publish. Your local collector still works without any public sharing.</p>
          <Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-local.md">Local collector guide</Link>
        </div>
      : view === null ? null : published ? <div className="usage-consent__published">
          <p>Publishing as <strong className="usage-consent__handle">{view.publicHandle}</strong>{view.consentedAtMs === null ? "" : <> since <time dateTime={new Date(view.consentedAtMs).toISOString()}>{date.format(view.consentedAtMs)}</time></>}. The public index shows your handle, observed token totals, record counts, coverage window, and verification freshness — never your email, account, or device identifiers.</p>
          {state.kind === "failed" && <p className="usage-daily__error" role="alert">The withdrawal did not complete. Your previous consent state still applies; try again.</p>}
          <button className="usage-button usage-button--quiet" type="button" disabled={busy} onClick={withdraw}>{busy ? "Withdrawing…" : "Withdraw from leaderboard"}</button>
        </div>
        : <form className="usage-consent__form" onSubmit={publish} aria-label="Publish usage on the public leaderboard">
          <label className="usage-consent__handle-field">Public handle
            <input type="text" value={handle} minLength={1} maxLength={32} pattern="[a-z0-9](-?[a-z0-9])*" required
              autoComplete="off" spellCheck={false} placeholder="lowercase-handle" aria-describedby="usage-consent-hint"
              onChange={event => setHandle(event.target.value)} />
          </label>
          <span id="usage-consent-hint">1–32 lowercase letters, digits, and single hyphens.</span>
          <label className="usage-consent__check">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            <span>Publish my handle and numeric usage totals on the public leaderboard.</span>
          </label>
          <p className="usage-consent__copy">This publishes your chosen handle, observed token totals, record counts, and coverage window — never your email, account, or device identifiers. Private collection stays private either way. You can withdraw at any time; withdrawal removes the entry from the published index.</p>
          {state.kind === "failed" && <p className="usage-daily__error" role="alert">The publish did not complete. Your previous consent state still applies; try again.</p>}
          <button className="usage-button usage-button--primary" type="submit" disabled={busy || !confirmed || !handleValid || !changed}>{busy ? "Publishing…" : "Publish to leaderboard"}</button>
        </form>}
  </section>;
}
