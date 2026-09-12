/** Request-owned work only. No pending promise is retained by a factory/global. */
export interface PairingHttpEffects {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

const fault = Symbol("pairing_http_unavailable");
const MAX_TIME = 8_640_000_000_000_000;
type Cleanup = () => void | Promise<void>;

export interface PairingHttpWork {
  guard(): void;
  onStop(cleanup: Cleanup): () => void;
  stage<T>(milliseconds: number, body: () => Promise<T>): Promise<T>;
}

/** Separate a bounded outward result from the actual registered terminal task. */
export function pairingHttpWork<T>(
  effects: PairingHttpEffects,
  milliseconds: number,
  register: (terminal: Promise<void>) => void,
  failure: () => T,
  release: () => void,
  body: (work: PairingHttpWork) => Promise<T>,
  startedAt?: number,
): Promise<T> {
  const { now, setTimeout: later, clearTimeout: clear } = effects;
  let settle!: (value: T) => void;
  const outward = new Promise<T>(resolve => { settle = resolve; });
  let open = true;
  let registered = false;
  let previous = 0;
  let deadline = 0;
  const timers = new Set<unknown>();
  const stages = new Set<number>();
  const hooks = new Set<Cleanup>();
  const cleanups: Promise<void>[] = [];

  function runCleanup(cleanup: Cleanup): boolean {
    try {
      const pending = cleanup();
      if (pending !== undefined) cleanups.push(pending.then(() => {}, () => {}));
      return true;
    } catch { return false; }
  }
  function close(): boolean {
    if (!open) return false;
    open = false;
    let clean = true;
    for (const timer of timers) { try { clear(timer); } catch { clean = false; } }
    timers.clear();
    for (const hook of hooks) if (!runCleanup(hook)) clean = false;
    hooks.clear();
    return clean;
  }
  function stop(): void { if (open) { close(); settle(failure()); } }
  function sample(): number {
    const value: unknown = now();
    if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)
      || value < previous || value < 0 || value > MAX_TIME - milliseconds) throw fault;
    previous = value;
    return value;
  }
  function guard(): void {
    if (!registered || !open) throw fault;
    try {
      const current = sample();
      if (current >= deadline || [...stages].some(end => current >= end)) throw fault;
    }
    catch { stop(); throw fault; }
  }
  function timer(delay: number): unknown {
    const handle = later(stop, delay);
    timers.add(handle);
    return handle;
  }
  const work: PairingHttpWork = Object.freeze({
    guard,
    onStop(cleanup: Cleanup) {
      if (open) hooks.add(cleanup); else runCleanup(cleanup);
      return () => { hooks.delete(cleanup); };
    },
    async stage<U>(duration: number, operation: () => Promise<U>): Promise<U> {
      guard();
      const end = Math.min(previous + duration, deadline);
      stages.add(end);
      let handle: unknown;
      let armed = false;
      try { handle = timer(end - previous); armed = true; }
      catch { stages.delete(end); throw fault; }
      try { const value = await operation(); guard(); return value; }
      finally {
        stages.delete(end);
        if (armed) { timers.delete(handle); try { clear(handle); } catch { stop(); } }
      }
    },
  });

  try {
    if (startedAt !== undefined) {
      if (!Number.isSafeInteger(startedAt) || Object.is(startedAt, -0) || startedAt < 0 || startedAt > MAX_TIME - milliseconds) throw fault;
      previous = startedAt;
    }
    const current = sample();
    deadline = (startedAt ?? current) + milliseconds;
    if (current >= deadline) throw fault;
    timer(deadline - current);
  }
  catch { stop(); }
  const terminal = Promise.resolve().then(async () => {
    try {
      guard();
      const result = await body(work);
      guard();
      const clean = close();
      settle(clean ? result : failure());
    } catch { stop(); }
    finally {
      // Hooks may be added after a late fetch resolves; body settles before this join.
      for (const cleanup of cleanups) await cleanup;
      release();
    }
  }).then(() => {}, () => {});
  try { register(terminal); registered = true; }
  catch { stop(); }
  return outward;
}
