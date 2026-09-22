"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readAccountSummary, signOutUsageAccount, warmUsageAccountSession } from "@/lib/usage/account-read-client";
import { subscribeUsageAccountSignOut } from "@/lib/usage/account-session-events";

export type AccountControlState = "loading" | "ready" | "authentication_required" | "unavailable" | "signing_out" | "sign_out_failed";
type CopyState = "idle" | "copied" | "failed";

/** Identity is fetched live after mount; no private values enter cached HTML. */
export function UsageAccountControl() {
  const [state, setState] = useState<AccountControlState>("loading");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const owner = useRef({ id: 0, controller: null as AbortController | null, mounted: false });

  const read = useCallback(async () => {
    const current = owner.current, id = ++current.id;
    current.controller?.abort();
    const controller = new AbortController(); current.controller = controller;
    const deadline = setTimeout(() => {
      controller.abort();
      if (current.id === id) { setAccountId(null); setState("unavailable"); }
    }, 20_000);
    try {
      const reply = await readAccountSummary(controller.signal, { onAuthenticationRequired: () => {
        if (current.id === id && !controller.signal.aborted) setAccountId(null);
      } });
      if (current.id !== id || controller.signal.aborted) return;
      if ("account" in reply) { setAccountId(reply.account.accountId); setState("ready"); }
      else { setAccountId(null); setState(reply.error.code === "authentication_required" ? "authentication_required" : "unavailable"); }
    } catch {
      if (current.id === id && !controller.signal.aborted) { setAccountId(null); setState("unavailable"); }
    } finally { clearTimeout(deadline); if (current.id === id) current.controller = null; }
  }, []);
  useEffect(() => {
    const current = owner.current; current.mounted = true;
    const unsubscribe = subscribeUsageAccountSignOut(() => {
      current.id++; current.controller?.abort(); current.controller = null;
      setAccountId(null); setCopyState("idle"); setState("authentication_required");
    });
    warmUsageAccountSession();
    void read();
    return () => { current.mounted = false; current.id++; current.controller?.abort(); unsubscribe(); };
  }, [read]);

  const signOut = async (switchAccount: boolean) => {
    const current = owner.current, id = ++current.id;
    current.controller?.abort();
    const controller = new AbortController(); current.controller = controller;
    setState("signing_out"); setCopyState("idle");
    const deadline = setTimeout(() => {
      controller.abort(); if (current.id === id) setState("sign_out_failed");
    }, 20_000);
    try {
      await signOutUsageAccount(controller.signal);
      // Keep local/example reports open after ordinary sign-out. The confirmed
      // SDK result already invalidated private views in this and sibling tabs.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- The OIDC API route requires a document request for its external authorization redirect.
      if (switchAccount && current.mounted) window.location.assign("/api/suite-auth/start?return_to=%2Fusage");
    } catch { if (current.id === id) setState("sign_out_failed"); }
    finally { clearTimeout(deadline); if (current.id === id) current.controller = null; }
  };
  const copy = async () => {
    if (accountId === null) return;
    const current = owner.current, id = current.id;
    try {
      await navigator.clipboard.writeText(accountId);
      if (current.id === id && current.mounted) setCopyState("copied");
    } catch { if (current.id === id && current.mounted) setCopyState("failed"); }
  };
  return <UsageAccountPanel state={state} accountId={accountId} copyState={copyState} copy={() => void copy()}
    retry={() => { setState("loading"); setCopyState("idle"); void read(); }} signOut={switchAccount => void signOut(switchAccount)} />;
}

export function UsageAccountPanel({ state, accountId, copyState, copy, retry, signOut }: Readonly<{
  state: AccountControlState; accountId: string | null; copyState: CopyState; copy(): void; retry(): void; signOut(switchAccount: boolean): void;
}>) {
  const busy = state === "signing_out";
  const status = state === "loading" ? "Checking account" : busy ? "Signing out…" : state === "sign_out_failed" ? "Sign-out unconfirmed"
    : state === "ready" ? "Verified with Hraness" : state === "authentication_required" ? "Sign-in required" : "Account unavailable";
  return <details className="usage-account" aria-label="Hraness account controls">
    <summary><span>Hraness account</span>{accountId !== null && <code>{accountId.slice(0, 11)}…{accountId.slice(-4)}</code>}<span className="usage-account__status">{status}</span></summary>
    <div className="usage-account__body">
      {accountId !== null && <>
        <label className="usage-account__id">{state === "ready" ? "Account ID" : "Last verified account ID"}
          <input readOnly value={accountId} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} />
        </label>
        <div className="usage-account__copy"><button type="button" className="usage-account__action" disabled={busy} onClick={copy}>Copy account ID</button>
          <span role="status">{copyState === "copied" ? "Copied" : copyState === "failed" ? "Select the ID above to copy it manually." : ""}</span></div>
        <p>Compare this ID with <code>aicharts account</code> on your collector. A match identifies the account; it does not confirm a successful upload.</p>
      </>}
      {state === "loading" && <p role="status">Verifying your browser account with Hraness.</p>}
      {state === "unavailable" && <><p role="status">Your account could not be verified. Try again before comparing it with your collector.</p><button className="usage-account__action" type="button" onClick={retry}>Retry account check</button></>}
      {state === "authentication_required" && <><p>Sign in to see which account receives your private usage. Local reports work without signing in.</p>
        <form action="/api/suite-auth/start" method="get"><input type="hidden" name="return_to" value="/usage" /><button className="usage-button usage-button--quiet" type="submit">Sign in with Hraness</button></form></>}
      {state === "sign_out_failed" && <p role="alert">Sign-out could not be confirmed. Retry sign-out before switching accounts.</p>}
      {state !== "loading" && <div className="usage-account__actions">
        <button className="usage-account__action" type="button" disabled={busy} onClick={() => signOut(false)}>{busy ? "Signing out…" : state === "sign_out_failed" ? "Retry sign-out" : "Sign out"}</button>
        <button className="usage-account__action" type="button" disabled={busy || state === "sign_out_failed"} onClick={() => signOut(true)}>Switch account</button>
      </div>}
    </div>
  </details>;
}
