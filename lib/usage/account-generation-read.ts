import { acceptUsageAccountReply, captureUsageAccountRead, currentUsageAccountRead, currentUsageAccountScope, invalidateUsageAccountGeneration, subscribeUsageAccountInvalidation, type UsageAccountScope } from "./account-generation";

/** One optional fresh read after identity adoption; an old payload is never rebound. */
export async function readInUsageAccountGeneration<T>(read: (signal?: AbortSignal) => Promise<T>, identity: (reply: T) => string | null,
  current: () => boolean, authenticationRequired: (reply: T) => boolean = () => false,
  custody: Readonly<{ signal?: AbortSignal; dispose?: (reply: T) => void }> = {}): Promise<Readonly<{ reply: T; scope: UsageAccountScope | null }> | null> {
  const live = () => !custody.signal?.aborted && current();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!live()) return null;
    const ticket = captureUsageAccountRead();
    const controller = custody.signal === undefined ? null : new AbortController();
    const invalidate = () => controller?.abort();
    const stop = controller === null ? () => {} : subscribeUsageAccountInvalidation(invalidate);
    custody.signal?.addEventListener("abort", invalidate, { once: true });
    let reply: T;
    try { reply = await read(controller?.signal); }
    catch (error) {
      if (!live()) return null;
      // Only the opted-in cancellable read treats an invalidated attempt as
      // replaceable. Unrelated callers retain their original error behavior.
      if (controller !== null && !currentUsageAccountRead(ticket)) continue;
      throw error;
    } finally { stop(); custody.signal?.removeEventListener("abort", invalidate); }
    let retained = false;
    try {
      if (!live()) return null;
      if (!currentUsageAccountRead(ticket)) continue;
      // A settled refusal clears every private view. An intermediate 401 during
      // SDK renewal is not passed here and must not cancel its own recovery.
      if (authenticationRequired(reply)) { invalidateUsageAccountGeneration("authentication-required"); return null; }
      const accountId = identity(reply);
      if (accountId === null) { retained = true; return { reply, scope: null }; }
      const accepted = acceptUsageAccountReply(ticket, accountId);
      if (accepted.kind === "accepted" && live() && currentUsageAccountScope(accepted.scope)) { retained = true; return { reply, scope: accepted.scope }; }
    } finally { if (!retained) custody.dispose?.(reply); }
  }
  return null;
}
