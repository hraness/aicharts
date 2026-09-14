import "server-only";

export type PairingProof = Readonly<{
  intentId: string;
  attemptId: string;
  browserNonce: string;
  contextToken: string;
}>;
export type PairingCustody = PairingProof & Readonly<{
  csrfToken: string;
  issuedAtMs: number;
  expiresAtMs: number;
}>;

export const pairingCookieName = "__Host-aicharts-usage-pairing";
const domain = new TextEncoder().encode(`https://aicharts.io\0${pairingCookieName}\0v1`);
const fields = ["intentId", "attemptId", "browserNonce", "contextToken", "csrfToken"] as const;
const maxTime = 8_640_000_000_000_000;
const plainSize = 177; // version + five 32-byte values + two u64 millisecond times
const sealedSize = 12 + plainSize + 16;
export const pairingHex = (value: unknown): value is string => typeof value === "string"
  && value.length === 64 && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
export const pairingTime = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= 0 && value <= maxTime;

function randomBytes(size: number, random: (length: number) => Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = random(size);
  if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new Error("Pairing randomness unavailable.");
  return Uint8Array.from(bytes);
}

export function randomPairingToken(random: (length: number) => Uint8Array): string {
  const result = Buffer.from(randomBytes(32, random)).toString("hex");
  if (!pairingHex(result)) throw new Error("Pairing randomness unavailable.");
  return result;
}

async function key(secret: string): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: domain, info: domain }, source,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function valid(custody: PairingCustody): boolean {
  return fields.every(field => pairingHex(custody[field])) && custody.browserNonce !== custody.csrfToken
    && pairingTime(custody.issuedAtMs) && pairingTime(custody.expiresAtMs)
    && custody.expiresAtMs > custody.issuedAtMs && custody.expiresAtMs - custody.issuedAtMs <= 600_000;
}

/** Fixed binary plaintext has no content/string extension fields. */
export async function sealPairingCustody(custody: PairingCustody, secret: string, random: (length: number) => Uint8Array): Promise<string> {
  if (!valid(custody)) throw new Error("Invalid pairing custody.");
  const bytes = new Uint8Array(plainSize);
  bytes[0] = 1;
  fields.forEach((field, index) => bytes.set(Buffer.from(custody[field], "hex"), 1 + index * 32));
  const view = new DataView(bytes.buffer);
  view.setBigUint64(161, BigInt(custody.issuedAtMs));
  view.setBigUint64(169, BigInt(custody.expiresAtMs));
  const iv = randomBytes(12, random);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: domain }, await key(secret), bytes);
  return Buffer.concat([iv, new Uint8Array(encrypted)]).toString("base64url");
}

export async function openPairingCustody(request: Request, secret: string, now: number): Promise<PairingCustody | null> {
  try {
    const header = request.headers.get("cookie");
    if (header === null || header.length > 16_384 || !pairingTime(now)) return null;
    const matches = header.split(";").filter(part => part.slice(0, part.indexOf("=")).trim() === pairingCookieName);
    if (matches.length !== 1) return null;
    const encoded = matches[0].slice(matches[0].indexOf("=") + 1);
    if (encoded.length !== 274 || !/^[A-Za-z0-9_-]{274}$/u.test(encoded)) return null;
    const sealed = Buffer.from(encoded, "base64url");
    if (sealed.length !== sealedSize || sealed.toString("base64url") !== encoded) return null;
    const bytes = new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM", iv: Uint8Array.from(sealed.subarray(0, 12)), additionalData: domain,
    }, await key(secret), Uint8Array.from(sealed.subarray(12))));
    if (bytes.length !== plainSize || bytes[0] !== 1) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const custody = Object.freeze({
      intentId: Buffer.from(bytes.subarray(1, 33)).toString("hex"),
      attemptId: Buffer.from(bytes.subarray(33, 65)).toString("hex"),
      browserNonce: Buffer.from(bytes.subarray(65, 97)).toString("hex"),
      contextToken: Buffer.from(bytes.subarray(97, 129)).toString("hex"),
      csrfToken: Buffer.from(bytes.subarray(129, 161)).toString("hex"),
      issuedAtMs: Number(view.getBigUint64(161)), expiresAtMs: Number(view.getBigUint64(169)),
    });
    return valid(custody) && custody.issuedAtMs <= now && custody.expiresAtMs > now ? custody : null;
  } catch { return null; }
}

export function pairingSetCookie(value: string, remainingMs: number): string {
  return `${pairingCookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.ceil(remainingMs / 1_000)}`;
}
