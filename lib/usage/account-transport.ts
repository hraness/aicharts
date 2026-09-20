import "server-only";
import { privateDaysSnapshot } from "./private-days-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, PAIRING_HTTP_STAGE_MS } from "./pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";
import type { UsageAccountSessionScope } from "./auth-server";
import { usageAccountId, type UsageAccountReply } from "./account-public";

export interface UsageAccountDependencies extends PairingHttpEffects {
  available(): boolean;
  registerLifetime(terminal: Promise<void>): void;
  beginSession(request: Request): UsageAccountSessionScope | null;
}
const failed = (): UsageAccountReply => ({ schemaVersion: 1, error: { code: "unavailable" } });
/** Live Accounts only. No Worker call, enrollment claim or coordinator token. */
export function createUsageAccountTransport(dependencies: UsageAccountDependencies) {
  let outstanding = 0;
  return async (request: Request): Promise<UsageAccountReply> => {
    try {
      if (request.signal.aborted || !dependencies.available() || outstanding >= PAIRING_HTTP_CAPACITY) return failed();
      outstanding++;
      return await pairingHttpWork(dependencies, PAIRING_HTTP_CLIENT_MS, dependencies.registerLifetime, failed,
        () => { outstanding--; }, async work => {
          const session = dependencies.beginSession(request);
          if (session === null) throw new Error("usage_unavailable");
          work.onStop(session.finish);
          const guard = () => {
            work.guard();
            if (request.signal.aborted || !dependencies.available() || !session.current()) throw new Error("usage_unavailable");
          };
          guard();
          const raw = await work.stage(PAIRING_HTTP_STAGE_MS, () => session.readOutcome());
          guard();
          if (privateDaysSnapshot(raw, ["kind"])?.kind === "authentication_required") {
            return { schemaVersion: 1, error: { code: "authentication_required" } };
          }
          const authenticated = privateDaysSnapshot(raw, ["kind", "value"]);
          const account = privateDaysSnapshot(authenticated?.value, ["suiteAccountId", "expiresAtMs"]);
          if (authenticated?.kind !== "authenticated" || !account || !usageAccountId(account.suiteAccountId)
            || typeof account.expiresAtMs !== "number" || !Number.isSafeInteger(account.expiresAtMs)
            || account.expiresAtMs <= dependencies.now() || account.expiresAtMs > 8_640_000_000_000_000) throw new Error("usage_unavailable");
          guard();
          return { schemaVersion: 1, state: "ready", account: { accountId: account.suiteAccountId } };
        });
    } catch { return failed(); }
  };
}
