import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetSummary,
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
} from "@/lib/coding-agent-dataset";

import { GET } from "./route";

const expectedContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' https://hraness.com",
  "img-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

describe("Hraness AI Charts preview", () => {
  test("is frameable only by AI Charts itself and canonical Hraness", () => {
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

  test("stays out of search while identifying the canonical product root", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(body).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
    expect(body).toContain('<link rel="canonical" href="https://aicharts.io/">');
    expect(body).toContain("<title>AI model and agent comparison charts | AI Charts</title>");
  });

  test("renders a bounded, inert summary of the checked benchmark snapshot", async () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const summary = codingAgentDatasetSummary(parsed.value);
    const leaders = currentCodingAgentBenchmarkLeaders(parsed.value);
    const body = await GET().text();

    expect(body).toContain("<h1>AI model and agent comparison charts</h1>");
    expect(body).toContain(
      `${summary.recordCount} model-agent configurations across ${summary.modelCount} models and ${summary.providerCount} providers.`,
    );
    for (const leader of leaders) {
      expect(body).toContain(leader.definition.label);
      expect(body).toContain(leader.record.model);
      expect(body).toContain(formatBenchmarkScore(leader.value));
    }
    expect(body).not.toMatch(/<(?:a|button|form|iframe|img|input|script)\b/iu);
    expect(body).not.toMatch(/\son[a-z]+\s*=/iu);
    expect(Buffer.byteLength(body)).toBeLessThan(12_000);
  });

  test("remains a build-time static route", async () => {
    const source = await Bun.file(new URL("./route.ts", import.meta.url)).text();

    expect(source).toContain('export const dynamic = "force-static";');
    expect(source).not.toMatch(/export\s+async\s+function\s+GET/iu);
  });
});
