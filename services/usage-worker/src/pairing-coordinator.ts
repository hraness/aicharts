import { createUsageOidcVerifier, type VerifierDependencies } from "../../../lib/usage/oidc/usage-oidc-verifier";
import { createPairingHttpHandler } from "./pairing-http";

/** Dormant Worker composition. One owner constructs this once per isolate;
 * neither import nor construction installs a route or acquires authority. */
export function createPairingCoordinator(): ReturnType<typeof createPairingHttpHandler> {
  const effects = Object.freeze<VerifierDependencies>({
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  const verifier = createUsageOidcVerifier(effects);
  return createPairingHttpHandler({ ...effects, verifier });
}
