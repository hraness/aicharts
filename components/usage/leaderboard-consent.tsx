"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

import { leaderboardPublicHandle, type LeaderboardConsentViewV1 } from "@/lib/usage/leaderboard-contract";
import { setUsageConsent } from "@/lib/usage/consent-client";
import { readAccountConsent } from "@/lib/usage/account-read-client";
import type { UsageConsentPublicReply } from "@/lib/usage/consent-public";

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export type ConsentState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "authentication_required" }
  | { kind: "not_enrolled" }
  | { kind: "publishing_full" }
  | { kind: "ready"; view: LeaderboardConsentViewV1 }
  | { kind: "busy"; view: LeaderboardConsentViewV1 }
  | { kind: "handle_unavailable"; view: LeaderboardConsentViewV1 }
  | { kind: "uncertain" };

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

  const issue = useCallback(async (run: (signal: AbortSignal) => Promise<UsageConsentPublicReply>, mutation: boolean) => {
    const owner = requests.current, id = ++owner.id;
    owner.pending?.abort();
    const controller = new AbortController(); owner.pending = controller;
    const deadline = setTimeout(() => {
      controller.abort();
      if (id === owner.id) setState({ kind: mutation ? "uncertain" : "unavailable" });
    }, 20_000);
    try {
      const reply = await Promise.resolve().then(() => run(controller.signal));
      if (id === owner.id && !controller.signal.aborted) {
        if (mutation && "error" in reply) {
          setState(previous => reply.error.code === "publishing_full" ? { kind: "publishing_full" }
            : reply.error.code === "handle_unavailable" && previous.kind === "busy"
              ? { kind: "handle_unavailable", view: previous.view } : { kind: "uncertain" });
        }
        else settle(reply);
      }
    } catch {
      if (id === owner.id) setState({ kind: mutation ? "uncertain" : "unavailable" });
    } finally {
      clearTimeout(deadline);
      if (id === owner.id) owner.pending = null;
    }
  }, [settle]);

  useEffect(() => {
    let active = true;
    const owner = requests.current;
    void Promise.resolve().then(() => { if (active) return issue(signal => readAccountConsent(signal), false); });
    return () => { active = false; owner.id++; owner.pending?.abort(); };
  }, [issue]);

  const publish = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((state.kind !== "ready" && state.kind !== "handle_unavailable") || !confirmed || !leaderboardPublicHandle(handle)) return;
    setState({ kind: "busy", view: state.view });
    void issue(signal => setUsageConsent({ consent: true, publicHandle: handle }, signal), true);
  };
  const withdraw = () => {
    if (state.kind !== "ready") return;
    const view = state.view;
    setState({ kind: "busy", view });
    void issue(signal => setUsageConsent({ consent: false, publicHandle: null }, signal), true);
  };
  const retry = () => { setState({ kind: "loading" }); void issue(signal => readAccountConsent(signal), false); };

  return <LeaderboardConsentPanel state={state} handle={handle} confirmed={confirmed} setHandle={setHandle}
    setConfirmed={setConfirmed} publish={publish} withdraw={withdraw} retry={retry} />;
}

export function LeaderboardConsentPanel({ state, handle, confirmed, setHandle, setConfirmed, publish, withdraw, retry }: Readonly<{
  state: ConsentState; handle: string; confirmed: boolean; setHandle: (value: string) => void;
  setConfirmed: (value: boolean) => void; publish: (event: FormEvent<HTMLFormElement>) => void;
  withdraw: () => void; retry: () => void;
}>) {

  const view = state.kind === "ready" || state.kind === "busy" || state.kind === "handle_unavailable" ? state.view : null;
  const busy = state.kind === "busy";
  const published = view !== null && view.consent === true;
  const handleValid = leaderboardPublicHandle(handle);
  const changed = !published || handle !== view?.publicHandle;
  const status = state.kind === "loading" ? "Checking status" : busy ? "Saving choice"
    : state.kind === "publishing_full" ? "Publishing capacity reached" : view === null ? "Status unknown" : published ? "Publishing enabled" : "Not publishing";
  return <section className="usage-consent" aria-labelledby="usage-consent-title">
    <header className="usage-daily__heading">
      <div><h2 id="usage-consent-title">Public leaderboard</h2><p>Choose whether to share your handle and numeric totals.</p></div>
      <span className="usage-daily__privacy">{status}</span>
    </header>
    <div aria-live="polite" aria-atomic="true" className="usage-daily__announcement">
      {state.kind === "loading" ? "Loading your publishing status." : state.kind === "unavailable" ? "Publishing status is unavailable." : state.kind === "authentication_required" ? "Sign in to manage publishing." : state.kind === "not_enrolled" ? "Connect a collector before publishing." : state.kind === "publishing_full" ? "The leaderboard is not accepting new publishers." : state.kind === "uncertain" ? "Your publishing choice could not be confirmed." : state.kind === "handle_unavailable" ? "That handle is already in use. Choose another." : busy ? "Saving your publishing choice." : published ? "Your account has enabled public publishing." : "You are not publishing."}
    </div>
    {state.kind === "loading" ? <div className="usage-daily__loading" aria-hidden="true"><span /><span /><span /></div>
      : state.kind === "publishing_full" ? <div className="usage-daily__notice" role="alert">
          <h3>The leaderboard is full</h3>
          <p>New publishing requests are not being accepted. Your private usage is still available. Check your publishing status to review your account’s current choice.</p>
          <button className="usage-button usage-button--quiet" type="button" onClick={retry}>Check publishing status</button>
          <Link className="usage-inline-link usage-consent__local-link" href="/usage/sessions">Inspect local sessions</Link>
        </div>
      : state.kind === "uncertain" ? <div className="usage-daily__notice" role="alert">
          <h3>Check your publishing status</h3>
          <p>The response was interrupted, so your choice may have been saved. Check your current status before making another change.</p>
          <button className="usage-button usage-button--primary" type="button" onClick={retry}>Check publishing status</button>
        </div>
      : state.kind === "unavailable" ? <div className="usage-daily__notice">
          <h3>Publishing status is unavailable</h3>
          <p>Your current publishing choice could not be read. Check again when the connection is available.</p>
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
          <p>Publishing enabled for <strong className="usage-consent__handle">{view.publicHandle}</strong>{view.consentedAtMs === null ? "" : <> since <time dateTime={new Date(view.consentedAtMs).toISOString()}>{date.format(view.consentedAtMs)}</time></>}. The public index shows your handle, observed token totals, record counts, coverage window, and last refresh time. It does not show your email, account, or device identifiers.</p>
          <Link className="usage-inline-link usage-consent__leaderboard-link" href="/leaderboard">View public leaderboard</Link>
          <button className="usage-button usage-button--quiet" type="button" disabled={busy} onClick={withdraw}>{busy ? "Withdrawing…" : "Withdraw from leaderboard"}</button>
        </div>
        : <form className="usage-consent__form" onSubmit={publish} aria-label="Publish usage on the public leaderboard">
          <label className="usage-consent__handle-field">Public handle
            <input type="text" value={handle} minLength={1} maxLength={32} pattern="[a-z0-9](-?[a-z0-9])*" required
              disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="lowercase-handle" aria-invalid={state.kind === "handle_unavailable"} aria-describedby={state.kind === "handle_unavailable" ? "usage-consent-hint usage-handle-error" : "usage-consent-hint"}
              onChange={event => setHandle(event.target.value)} />
          </label>
          {state.kind === "handle_unavailable" && <p id="usage-handle-error" className="usage-daily__error" role="alert">That handle is already in use. Choose another.</p>}
          <span id="usage-consent-hint">1–32 lowercase letters, digits, and single hyphens.</span>
          <label className="usage-consent__check">
            <input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            <span>Publish my handle and numeric usage totals on the public leaderboard.</span>
          </label>
          <p className="usage-consent__copy">This publishes your chosen handle, observed token totals, record counts, and coverage window. It does not publish your email, account, or device identifiers. Private collection stays private either way. You can withdraw at any time; withdrawal removes the entry from the published index. Cached pages may retain it for up to one minute; a page already open may need a reload.</p>
          <button className="usage-button usage-button--primary" type="submit" disabled={busy || !confirmed || !handleValid || !changed}>{busy ? "Publishing…" : "Publish to leaderboard"}</button>
        </form>}
  </section>;
}
