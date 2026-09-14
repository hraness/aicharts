import "server-only";
import { getContext } from "@vercel/oidc";
import { after } from "next/server";
import { createPairingTransport } from "./pairing-transport";

/** Shared server transport; creating it has no request effects. Each resolved
 * production intent supplies its coordinator's live configuration/abort fence. */
export function createVercelPairingTransport() {
  return createPairingTransport({
    getContext,
    // Register the existing nonrejecting terminal promise before transport work.
    // A callback passed to after() would instead defer work until response close.
    registerLifetime: terminal => { after(terminal); },
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
}
