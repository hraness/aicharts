import { describe, expect, test } from "bun:test";

import { MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL } from "@/lib/model-card-collection";

import { GET } from "./route";

const expectedContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors https://hraness.com https://www.hraness.com",
  "img-src 'self'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

describe("Hraness model-card preview", () => {
  test("is frameable only by the two canonical Hraness origins", () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe(
      expectedContentSecurityPolicy,
    );
    expect(response.headers.get("X-Frame-Options")).toBeNull();
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("stays out of search while pointing crawlers at the real collection", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(body).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
    expect(body).toContain('<link rel="canonical" href="https://aicharts.io/models">');
    expect(body).toContain("<title>AI model trading cards | AI Charts</title>");
  });

  test("is a bounded, inert document built from the existing collection image", async () => {
    const body = await GET().text();

    expect(body).toContain(`<h1>AI model trading cards</h1>`);
    expect(body).toContain(`src="${MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL}"`);
    expect(body).not.toMatch(/<(?:a|button|form|iframe|input|script)\b/iu);
    expect(body).not.toMatch(/\son[a-z]+\s*=/iu);
    expect(Buffer.byteLength(body)).toBeLessThan(5_000);
  });
});
