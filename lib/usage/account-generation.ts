import { usageAccountId } from "./account-public";

const generationBrand: unique symbol = Symbol("usage-account-generation");
export type UsageAccountGeneration = Readonly<{ [generationBrand]: true }>;
export type UsageAccountReadTicket = Readonly<{ generation: UsageAccountGeneration }>;
export type UsageAccountScope = Readonly<{ accountId: string; generation: UsageAccountGeneration }>;
export type UsageAccountInvalidationReason = "confirmed-signout" | "authentication-required" | "identity-changed" | "lifecycle";
export type UsageAccountReplyAcceptance = Readonly<{ kind: "accepted"; scope: UsageAccountScope }>
  | Readonly<{ kind: "identity-changed" }> | Readonly<{ kind: "stale" }>;

const newGeneration = (): UsageAccountGeneration => Object.freeze({ [generationBrand]: true });
let generation = newGeneration();
let accountId: string | null = null;
// The identity-less generation the current one was first adopted from, if the
// only change since then is that adoption. Any other boundary clears it.
let adoptedFrom: UsageAccountGeneration | null = null;
const subscriptions = new Set<Readonly<{ listener: (reason: UsageAccountInvalidationReason) => void }>>();
const stale = Object.freeze({ kind: "stale" } as const);
const identityChanged = Object.freeze({ kind: "identity-changed" } as const);

function notifyInvalidation(reason: UsageAccountInvalidationReason): void {
  // A fixed snapshot keeps subscription changes during cleanup out of this dispatch.
  for (const { listener } of [...subscriptions]) {
    try { listener(reason); } catch { /* One failed cleanup must not retain another view. */ }
  }
}

/** Capture before dispatching a read; retries never inherit a newer generation. */
export function captureUsageAccountRead(): UsageAccountReadTicket {
  return Object.freeze({ generation });
}

export function currentUsageAccountRead(ticket: UsageAccountReadTicket): boolean {
  return ticket.generation === generation;
}

export function currentUsageAccountScope(scope: UsageAccountScope): boolean {
  return scope.generation === generation && scope.accountId === accountId;
}

/**
 * Use only an identity bound to the same authenticated response as its payload.
 * First adoption and identity changes invalidate every in-flight read, including
 * this reply. The caller may start one fresh read, then check its own request's
 * cancellation and this generation again immediately before rendering.
 */
export function acceptUsageAccountReply(ticket: UsageAccountReadTicket, replyAccountId: unknown): UsageAccountReplyAcceptance {
  if (!currentUsageAccountRead(ticket) || !usageAccountId(replyAccountId)) return stale;
  if (accountId !== replyAccountId) {
    adoptedFrom = accountId === null ? generation : null;
    generation = newGeneration();
    accountId = replyAccountId;
    notifyInvalidation("identity-changed");
    return identityChanged;
  }
  return Object.freeze({ kind: "accepted", scope: Object.freeze({ accountId, generation }) });
}

/**
 * Like acceptUsageAccountReply, but a first adoption or an identity change also
 * accepts this reply's own payload in the generation it establishes: the payload
 * and the identity came from the same authenticated response, so rendering it
 * needs no second read. A sibling dispatched in the identity-less generation that
 * the current identity was first adopted from, naming that same account, is
 * accepted too: nothing but that adoption happened in between. Any other
 * boundary (sign-out, refusal, suspension, a different account) leaves every
 * earlier read stale, and a listener that invalidates again during the
 * notification leaves this one stale as well.
 */
export function adoptUsageAccountReply(ticket: UsageAccountReadTicket, replyAccountId: unknown): UsageAccountReplyAcceptance {
  if (!currentUsageAccountRead(ticket) && adoptedFrom !== null && ticket.generation === adoptedFrom
    && usageAccountId(replyAccountId) && accountId === replyAccountId) {
    return Object.freeze({ kind: "accepted", scope: Object.freeze({ accountId, generation }) });
  }
  const accepted = acceptUsageAccountReply(ticket, replyAccountId);
  if (accepted.kind !== "identity-changed") return accepted;
  if (!usageAccountId(replyAccountId) || accountId !== replyAccountId) return stale;
  return Object.freeze({ kind: "accepted", scope: Object.freeze({ accountId, generation }) });
}

/** Lifecycle ownership belongs to callers; this module owns no browser listeners or persistent state. */
export function invalidateUsageAccountGeneration(reason: UsageAccountInvalidationReason): void {
  generation = newGeneration();
  accountId = null;
  adoptedFrom = null;
  notifyInvalidation(reason);
}

/** Listeners synchronously clear private views; the notification contains no identity. */
export function subscribeUsageAccountInvalidation(listener: (reason: UsageAccountInvalidationReason) => void): () => void {
  const subscription = Object.freeze({ listener });
  subscriptions.add(subscription);
  return () => { subscriptions.delete(subscription); };
}
