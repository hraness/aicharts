import { createUsageOidcVerifier, type VerifierDependencies } from "../../../lib/usage/oidc/usage-oidc-verifier";
import { createPrivateDaysHttpHandler } from "./private-days-http";

/** Construct once per isolate. No default Worker handler imports this factory. */
export function createPrivateDaysCoordinator(): ReturnType<typeof createPrivateDaysHttpHandler> {
  const effects = Object.freeze<VerifierDependencies>({
    fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  return createPrivateDaysHttpHandler({ ...effects, verifier: createUsageOidcVerifier(effects) });
}
