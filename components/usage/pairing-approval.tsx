"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPairingController, requestPairing, type PairingView } from "@/app/usage/pairing/client";
import type { PairingDecision } from "@/lib/usage/pairing-public";

/** Separate presentation lets focused fixtures cover every visible state without
 * constructing a browser session or an authentication authority. */
export function PairingApprovalPanel({ view, read, decide, navigating }: Readonly<{
  view: PairingView; read(): void; decide(value: PairingDecision): void; navigating(): void;
}>) {
  const status = view.kind === "loading" ? "Checking this pairing attempt…" : view.kind === "deciding" ? "Saving your decision…" : null;
  const reply = view.kind === "reply" ? view.reply : null;
  return <section className="usage-pairing" aria-labelledby="pairing-title">
    <h1 id="pairing-title">Connect your collector</h1>
    <p className="usage-pairing__intro">Choose the Hraness account for this collector, then confirm the same account in your terminal.</p>
    <div className="usage-pairing__body" aria-live="polite" aria-atomic="true">
      {status !== null ? <p role="status">{status}</p>
        : view.kind === "disabled" ? <p>Collector connection is unavailable. Local collection still works.</p>
          : view.kind === "invalid" ? <><h2>This pairing link is invalid</h2><p>Return to your terminal and open its original pairing link. No authentication was started.</p></>
            : view.kind === "start" || view.kind === "starting" ? <>
              <h2>Sign in for this pairing attempt</h2>
              <p>Continue only if you started this connection in your own terminal. Signing in identifies the account; approval is a separate step.</p>
              <form method="post" action="/api/usage/pairing/start" encType="application/x-www-form-urlencoded" onSubmit={navigating}>
                <input type="hidden" name="intentId" value={view.intentId} />
                <button className="usage-button usage-button--primary" type="submit" disabled={view.kind === "starting"}>{view.kind === "starting" ? "Opening Hraness…" : "Continue with Hraness"}</button>
              </form>
            </> : view.kind === "expired" ? <><h2>This pairing attempt has expired</h2><p>Start a new attempt in your terminal. This page cannot extend the original deadline.</p></>
              : view.kind === "uncertain" ? <><h2>Your decision needs a status check</h2><p>The reply did not arrive. Check the saved status before making another decision.</p><button className="usage-button usage-button--primary" onClick={read}>Check approval status</button></>
                : view.kind === "unavailable" ? <><h2>Approval is unavailable right now</h2><p>No outcome could be verified. You can read the status of the original attempt again.</p><button className="usage-button usage-button--primary" onClick={read}>Check approval status</button></>
                  : view.kind === "rejected" ? <><h2>No verified pairing attempt</h2><p>Open the pairing link from your terminal and complete its fresh sign-in. An ordinary sign-in cannot approve a collector.</p><button className="usage-button usage-button--quiet" onClick={read}>Check approval status</button></>
                    : reply !== null ? <>
                      <dl className="usage-pairing__account"><dt>Hraness account</dt><dd><code>{reply.accountId}</code></dd></dl>
                      {reply.state === "pending" ? <>
                        <h2>Approve this collector?</h2><p>Compare this account with your terminal. Approve only the collector you started.</p>
                        <div className="usage-pairing__actions"><button className="usage-button usage-button--primary" onClick={() => decide("approve")}>Approve collector</button><button className="usage-button usage-button--quiet" onClick={() => decide("deny")}>Deny</button></div>
                      </> : <>
                        <h2>{reply.state === "browser-approved" ? "Approval saved. Return to your terminal to confirm this account." : reply.state === "terminal-confirmed" ? "Account confirmed in your terminal." : "Collector denied."}</h2>
                        <p>{reply.state === "browser-approved" ? "Browser approval alone does not finish enrollment. Continue with the original attempt in your terminal."
                          : reply.state === "terminal-confirmed" ? "Continue there to finish connecting this collector. This page does not confirm that enrollment or upload is complete."
                            : "This attempt cannot be approved again. Start a new attempt in your terminal if you want to connect."}</p>
                        {reply.state !== "denied" && <button className="usage-button usage-button--quiet" onClick={read}>Check approval status</button>}
                      </>}
                      <p className="usage-pairing__expiry">This attempt expires at <time dateTime={new Date(reply.expiresAtMs).toISOString()}>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(reply.expiresAtMs)} UTC</time>.</p>
                    </> : null}
    </div>
    <aside className="usage-pairing__privacy" aria-label="What connecting allows">
      <h2>Numeric usage only</h2><p>The collector is designed for numeric Codex, Claude Code and Devin measurements. Prompts, responses and session transcripts stay out of uploads. Public sharing is a separate choice.</p>
    </aside>
  </section>;
}

export function PairingApproval({ available }: Readonly<{ available: boolean }>) {
  const [controller] = useState(() => createPairingController(available, {
    takeFragment() {
      const fragment = window.location.hash;
      // Strip before availability checks, parsing, status reads or explicit start.
      if (fragment !== "") window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      return fragment;
    },
    request: requestPairing, now: () => Date.now(), later: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }));
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.serverSnapshot);
  useEffect(() => controller.mount(), [controller]);
  return <PairingApprovalPanel view={view} read={controller.read} decide={controller.decide} navigating={controller.navigating} />;
}
