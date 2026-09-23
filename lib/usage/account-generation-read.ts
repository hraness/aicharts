import { acceptUsageAccountReply, captureUsageAccountRead, currentUsageAccountRead, currentUsageAccountScope, invalidateUsageAccountGeneration, type UsageAccountScope } from "./account-generation";

/** One optional fresh read after identity adoption; an old payload is never rebound. */
export async function readInUsageAccountGeneration<T>(read: () => Promise<T>, identity: (reply: T) => string | null,
  current: () => boolean, authenticationRequired: (reply: T) => boolean = () => false): Promise<Readonly<{ reply: T; scope: UsageAccountScope | null }> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!current()) return null;
    const ticket = captureUsageAccountRead();
    const reply = await read();
    if (!current()) return null;
    if (!currentUsageAccountRead(ticket)) continue;
    // A settled refusal clears every private view. An intermediate 401 during
    // SDK renewal is not passed here and must not cancel its own recovery.
    if (authenticationRequired(reply)) { invalidateUsageAccountGeneration("authentication-required"); return null; }
    const accountId = identity(reply);
    if (accountId === null) return { reply, scope: null };
    const accepted = acceptUsageAccountReply(ticket, accountId);
    if (accepted.kind === "accepted" && current() && currentUsageAccountScope(accepted.scope)) return { reply, scope: accepted.scope };
  }
  return null;
}
