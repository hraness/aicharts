import "server-only";
import { getContext } from "@vercel/oidc";
import { after } from "next/server";
import { beginUsagePrivateReadSession, usagePrivateReadAvailable } from "./auth-server";
import { createPrivateDaysTransport, type PrivateDaysTransportDependencies } from "./private-days-transport";

/** Dormant public-platform binding with the request-owned live Accounts scope.
 * Construction installs no caller or route; the default remains closed while
 * usage authentication or private reads are disabled. Tests may inject trusted ports. */
export function createVercelPrivateDaysTransport(
  beginSession: PrivateDaysTransportDependencies["beginSession"] = beginUsagePrivateReadSession,
  available: PrivateDaysTransportDependencies["available"] = usagePrivateReadAvailable,
) {
  return createPrivateDaysTransport({ beginSession, available, getContext,
    registerLifetime: terminal => { after(terminal); },
    fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
}
