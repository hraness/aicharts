import { afterAll, beforeEach, expect, mock, test } from "bun:test";

// These stand-ins deliberately have no platform behavior. Provider runtime and
// persisted-alarm qualification belong to the separately reviewed rollout.
class PlatformBase {
  constructor() {
    for (const name of ["ctx", "env"]) {
      Object.defineProperty(this, name, {
        get() { throw new Error(`platform ${name} access forbidden`); },
        set() { throw new Error(`platform ${name} access forbidden`); },
      });
    }
  }
}
class DurableObject extends PlatformBase {}
class WorkerEntrypoint extends PlatformBase {}
mock.module("cloudflare:workers", () => ({ DurableObject, WorkerEntrypoint }));

const originalFetch = globalThis.fetch;
let outboundCalls = 0;
globalThis.fetch = () => {
  outboundCalls++;
  throw new Error("outbound access forbidden");
};

const local = await import("./usage-worker.mjs");
const synthetic = await import("./synthetic-qualification.mjs");
expect(outboundCalls).toBe(0);
beforeEach(() => { outboundCalls = 0; });
afterAll(() => { globalThis.fetch = originalFetch; });

function forbidden(label) {
  const fail = () => { throw new Error(`${label} access forbidden`); };
  return new Proxy(function () {}, {
    get: fail,
    set: fail,
    has: fail,
    ownKeys: fail,
    getOwnPropertyDescriptor: fail,
    defineProperty: fail,
    deleteProperty: fail,
    getPrototypeOf: fail,
    setPrototypeOf: fail,
    apply: fail,
    construct: fail,
  });
}

const durableClasses = [
  local.AccountEnrollment, local.LeaderboardIndex, local.PairingIntent, local.RestoreFence,
  synthetic.AccountEnrollment, synthetic.PairingIntent, synthetic.RestoreFence,
];

const handlers = [
  local.default.fetch,
  synthetic.default.fetch,
  ...durableClasses.map(Class => Class.prototype.fetch),
  synthetic.SyntheticQualification.prototype.fetch,
  synthetic.createSyntheticQualificationHandler(),
];

async function expectRetired(response) {
  expect(response.status).toBe(410);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(await response.text()).toBe("AI Charts is retired.\n");
}

test("keeps each entrypoint's exact named interface and platform class roles", () => {
  expect(Object.keys(local).sort()).toEqual([
    "AccountEnrollment", "LeaderboardIndex", "PairingIntent", "RestoreFence", "default",
  ]);
  expect(Object.keys(synthetic).sort()).toEqual([
    "AccountEnrollment", "PairingIntent", "RestoreFence", "SyntheticQualification",
    "createSyntheticQualificationHandler", "default",
  ]);
  for (const Class of durableClasses) expect(Class.prototype instanceof DurableObject).toBe(true);
  expect(synthetic.SyntheticQualification.prototype instanceof WorkerEntrypoint).toBe(true);
  expect(synthetic.SyntheticQualification.prototype instanceof DurableObject).toBe(false);
  expect(typeof synthetic.createSyntheticQualificationHandler).toBe("function");
  expect(typeof synthetic.createSyntheticQualificationHandler()).toBe("function");
});

test("constructors do not access context, storage, environment, or outbound services", () => {
  for (const Class of [...durableClasses, synthetic.SyntheticQualification]) {
    const value = new Class(forbidden("context"), forbidden("environment"));
    expect(Object.getOwnPropertyNames(value)).toEqual(["ctx", "env"]);
  }
  expect(outboundCalls).toBe(0);
});

test("all HTTP handlers refuse opaque inputs without accessing this or bindings", async () => {
  for (const handler of handlers) {
    for (const request of [forbidden("request"), undefined, null, Symbol("request")]) {
      await expectRetired(await handler.call(
        forbidden("this"), request, forbidden("environment"), forbidden("context"),
      ));
    }
  }
  expect(outboundCalls).toBe(0);
});

test("all HTTP methods refuse and leave request bodies unread", async () => {
  for (const handler of handlers) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const request = new Request("https://retired.invalid/arbitrary/path?private=unread", {
        method,
        headers: { authorization: "synthetic-only", cookie: "synthetic-only" },
        ...(["GET", "HEAD"].includes(method) ? {} : { body: "synthetic unread body" }),
      });
      await expectRetired(await handler.call(
        forbidden("this"), request, forbidden("environment"), forbidden("context"),
      ));
      expect(request.bodyUsed).toBe(false);
    }
  }
  expect(outboundCalls).toBe(0);
});

test("every alarm completes repeatedly without storage, RPC, outbound calls, or rearming", async () => {
  for (const Class of durableClasses) {
    const value = new Class(forbidden("context"), forbidden("environment"));
    for (let delivery = 0; delivery < 3; delivery++) {
      expect(await value.alarm(forbidden("alarm info"))).toBeUndefined();
      expect(await Class.prototype.alarm.call(forbidden("this"), forbidden("alarm info"))).toBeUndefined();
    }
  }
  expect(outboundCalls).toBe(0);
});

test("application prototypes expose only HTTP refusal and the durable alarm handler", () => {
  for (const Class of durableClasses) {
    let prototype = Class.prototype;
    const names = new Set();
    while (prototype !== DurableObject.prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) names.add(name);
      prototype = Object.getPrototypeOf(prototype);
    }
    expect([...names].sort()).toEqual(["alarm", "constructor", "fetch"]);
  }
  expect(Object.getOwnPropertyNames(synthetic.SyntheticQualification.prototype).sort())
    .toEqual(["constructor", "fetch"]);
  expect(outboundCalls).toBe(0);
});

test("responses are fresh and cannot change a later refusal", async () => {
  for (const handler of handlers) {
    const first = await handler();
    first.headers.set("cache-control", "public");
    await first.text();
    await expectRetired(await handler());
  }
  expect(outboundCalls).toBe(0);
});

test("guards reject deliberate storage, environment, context, and outbound access", () => {
  expect(() => forbidden("context").storage).toThrow("context access forbidden");
  expect(() => forbidden("environment").CONTROL).toThrow("environment access forbidden");
  expect(() => forbidden("context").waitUntil).toThrow("context access forbidden");
  const instance = new local.AccountEnrollment();
  expect(() => instance.ctx).toThrow("platform ctx access forbidden");
  expect(() => instance.env).toThrow("platform env access forbidden");
  expect(() => globalThis.fetch("https://retired.invalid")).toThrow("outbound access forbidden");
  expect(outboundCalls).toBe(1);
});
