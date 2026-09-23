import { expect, test } from "bun:test";
import { clearUsageAccountViews, retainUsageAccountLifecycle, subscribeUsageAccountSignOut } from "./account-session-events";
import { captureUsageAccountRead, currentUsageAccountRead } from "./account-generation";

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

test("one retained lifecycle owner invalidates hidden, restored and refocused documents and releases every listener", () => {
  const originals = ["window", "document", "BroadcastChannel"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const target = new EventTarget(), page = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: undefined });
  const one = retainUsageAccountLifecycle(), two = retainUsageAccountLifecycle();
  try {
    const initial = captureUsageAccountRead();
    target.dispatchEvent(new Event("pageshow")); expect(currentUsageAccountRead(initial)).toBe(true);
    for (const [surface, name] of [[page, "visibilitychange"], [target, "pagehide"], [target, "focus"], [target, "pageshow"]] as const) {
      const ticket = captureUsageAccountRead(), event = new Event(name);
      if (name === "pageshow") Object.defineProperty(event, "persisted", { value: true });
      surface.dispatchEvent(event); expect(currentUsageAccountRead(ticket)).toBe(false);
    }
    one(); one(); const remaining = captureUsageAccountRead(); target.dispatchEvent(new Event("focus"));
    expect(currentUsageAccountRead(remaining)).toBe(false);
    two(); const released = captureUsageAccountRead();
    target.dispatchEvent(new Event("focus")); page.dispatchEvent(new Event("visibilitychange"));
    expect(currentUsageAccountRead(released)).toBe(true);
  } finally {
    one(); two();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
