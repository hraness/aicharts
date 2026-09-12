// Private bounded JSON boundary. This is not a general parser or JS sandbox.
const fail = (): never => { throw new Error("invalid_json"); };
const parse = JSON.parse;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function boundedJson(bytes: Uint8Array): unknown {
  if (bytes.length === 0 || bytes.length > 16_384) fail();
  const text = decoder.decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) fail();
  let at = 0;
  let units = 0;
  const count = () => { if (++units > 256) fail(); };
  const space = () => { while (at < text.length && /[\x20\t\r\n]/u.test(text[at]!)) at++; };
  function string(): string {
    const start = at++;
    while (at < text.length) {
      const ch = text[at++]!;
      if (ch === '"') return parse(text.slice(start, at)) as string;
      if (ch.charCodeAt(0) < 32) fail();
      if (ch === "\\") {
        if (at >= text.length) fail();
        at++;
      }
    }
    return fail();
  }
  function value(depth: number): unknown {
    if (depth > 8) fail();
    count(); space();
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === "{") {
      at++; space();
      const out: Record<string, unknown> = Object.create(null);
      const keys = new Set<string>();
      if (text[at] === "}") { at++; return out; }
      while (at < text.length) {
        if (text[at] !== '"') fail();
        const key = string();
        if (keys.has(key) || keys.size >= 32) fail();
        keys.add(key); count(); space();
        if (text[at++] !== ":") fail();
        out[key] = value(depth + 1); space();
        if (text[at] === "}") { at++; return out; }
        if (text[at++] !== ",") fail();
        space();
      }
      return fail();
    }
    if (ch === "[") {
      at++; space();
      const out: unknown[] = [];
      if (text[at] === "]") { at++; return out; }
      while (at < text.length) {
        out.push(value(depth + 1)); space();
        if (text[at] === "]") { at++; return out; }
        if (text[at++] !== ",") fail();
        space();
      }
      return fail();
    }
    for (const literal of ["true", "false", "null"] as const) {
      if (text.startsWith(literal, at)) {
        at += literal.length;
        return literal === "null" ? null : literal === "true";
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(at));
    if (!number) return fail();
    at += number[0].length;
    return parse(number[0]) as number;
  }
  const result = value(1); space();
  if (at !== text.length) fail();
  return result;
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) fail();
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function decodeBase64Url(text: string, maxBytes: number): Uint8Array {
  if (!text.length || text.length > Math.ceil(maxBytes * 4 / 3) || /[^A-Za-z0-9_-]/u.test(text) || text.length % 4 === 1) fail();
  const binary = atob(text.replace(/-/gu, "+").replace(/_/gu, "/"));
  if (binary.length > maxBytes) fail();
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  if (encodeBase64Url(bytes) !== text) fail();
  return bytes;
}

const typedArray = Object.getPrototypeOf(Uint8Array.prototype) as object;
const getBuffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
const getOffset = Object.getOwnPropertyDescriptor(typedArray, "byteOffset")!.get!;
const getLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const getTag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const getBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const getResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

// Intrinsic access avoids chunk-owned getters; proxy/shared/resizable/detached views fail.
export function byteView(value: unknown): Uint8Array {
  if (!ArrayBuffer.isView(value) || getTag.call(value) !== "Uint8Array") return fail();
  const buffer = getBuffer.call(value) as ArrayBuffer;
  getBufferLength.call(buffer);
  if (getResizable?.call(buffer)) return fail();
  return new Uint8Array(buffer, getOffset.call(value) as number, getLength.call(value) as number);
}
