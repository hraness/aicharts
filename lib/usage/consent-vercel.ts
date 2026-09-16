import "server-only";
import { getContext } from "@vercel/oidc";
import { after } from "next/server";
import { beginUsagePrivateReadSession, usagePrivateReadAvailable } from "./auth-server";
import { createUsageConsentTransport, type UsageConsentTransportDependencies } from "./consent-transport";

/** Dormant private binding for the consent write path. The consent route is
 * fenced by the same private-read qualification as the private dashboard:
 * authentication plus private read must both be enabled before this transport
 * can reach the worker. Tests may inject trusted ports. */
export function createVercelUsageConsentTransport(
  beginSession: UsageConsentTransportDependencies["beginSession"] = beginUsagePrivateReadSession,
  available: UsageConsentTransportDependencies["available"] = usagePrivateReadAvailable,
) {
  return createUsageConsentTransport({ beginSession, available, getContext,
    registerLifetime: terminal => { after(terminal); },
    fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
}
