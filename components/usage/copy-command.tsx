"use client";

import { useEffect, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/* A shell command with a copy button. The command stays in server-rendered
 * HTML; the button only adds clipboard access when the browser allows it. */
export function CopyCommand({ command, label, note }: { command: string; label: string; note?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);
  async function copy() {
    if (navigator.clipboard === undefined) { setState("failed"); return; }
    try { await navigator.clipboard.writeText(command); setState("copied"); } catch { setState("failed"); }
  }
  return <div className="usage-terminal" role="group" aria-label={label}>
    <code>{command}</code>
    <div className="usage-terminal__meta">
      {note === undefined ? null : <span>{note}</span>}
      <button className="usage-copy" type="button" onClick={copy} data-copied={state === "copied"}>
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
      <span className="sr-only" role="status">{state === "copied" ? "Command copied." : state === "failed" ? "The browser blocked clipboard access." : ""}</span>
    </div>
  </div>;
}
