/** Workerd RPC results are resources. Snapshot only inert result properties and
 * retain disposal even when the untrusted envelope is refused. */
export function rpcResultSnapshot(raw: unknown): { envelope: Record<string, unknown> | null; dispose: (() => void) | null } {
  let dispose: (() => void) | null = null;
  try {
    if (raw === null || typeof raw !== "object") return { envelope: null, dispose };
    const disposal = Object.getOwnPropertyDescriptor(raw, Symbol.dispose);
    if (disposal !== undefined && "value" in disposal && typeof disposal.value === "function") {
      const method: (...args: unknown[]) => unknown = disposal.value;
      dispose = () => { Reflect.apply(method, raw, []); };
    }
    if (dispose === null || Object.getPrototypeOf(raw) !== Object.prototype) return { envelope: null, dispose };
    const names = Reflect.ownKeys(raw);
    if (names.length !== 3 || !names.includes(Symbol.dispose)) return { envelope: null, dispose };
    const envelope: Record<string, unknown> = Object.create(null);
    for (const name of names) {
      if (name === Symbol.dispose) continue;
      if (name !== "ok" && name !== "value" && name !== "error") return { envelope: null, dispose };
      const descriptor = Object.getOwnPropertyDescriptor(raw, name);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return { envelope: null, dispose };
      envelope[name] = descriptor.value as unknown;
    }
    return { envelope, dispose };
  } catch { return { envelope: null, dispose }; }
}
