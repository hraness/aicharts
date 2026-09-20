import { expect, test } from "bun:test";
import { clearUsageAccountViews, subscribeUsageAccountSignOut } from "./account-session-events";

test("one SDK channel validates exact cross-tab sign-out, fans out cleanup and releases on last subscriber", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  const channels: FakeChannel[] = [];
  class FakeChannel {
    listener?: (event: MessageEvent<unknown>) => void; closed = false;
    constructor(name: string) { expect(name).toBe("jungle-suite-accounts:oidc-session:v1"); channels.push(this); }
    addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) { this.listener = listener; }
    removeEventListener() { this.listener = undefined; }
    close() { this.closed = true; }
  }
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: FakeChannel });
  let first = 0, second = 0;
  const one = subscribeUsageAccountSignOut(() => { first++; throw new Error("PRIVATE_CANARY"); });
  const two = subscribeUsageAccountSignOut(() => { second++; });
  try {
    expect(channels).toHaveLength(1);
    for (const data of [null, { kind: "signed_out" }, { kind: "signed_out", version: "other" },
      { kind: "signed_out", version: "suite-oidc-session-event-v1", accountId: "PRIVATE_CANARY" }]) {
      channels[0]!.listener!(new MessageEvent("message", { data }));
    }
    expect(first).toBe(0); expect(second).toBe(0);
    channels[0]!.listener!(new MessageEvent("message", { data: { kind: "signed_out", version: "suite-oidc-session-event-v1" } }));
    expect(first).toBe(1); expect(second).toBe(1);
    one(); clearUsageAccountViews(); expect(first).toBe(1); expect(second).toBe(2); expect(channels[0]!.closed).toBe(false);
    two(); expect(channels[0]!.closed).toBe(true);
  } finally {
    one(); two();
    if (original) Object.defineProperty(globalThis, "BroadcastChannel", original); else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});
