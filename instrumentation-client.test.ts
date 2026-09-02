import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { approvedPostHogEndpoint } from "./lib/posthog-endpoint";

test("browser instrumentation normalizes every event before production capture", async () => {
  const source = await readFile(new URL("./instrumentation-client.ts", import.meta.url), "utf8");

  expect(source).toContain("before_send(event)");
  expect(source).toContain("normalizedPageAnalyticsProperties(");
  expect(source).toContain('event.event === "$$client_ingestion_warning"');
  expect(source).toContain("event.properties?.$current_url");
  expect(source).toContain("approvedPostHogEndpoint(");
  expect(source).toContain('capture_pageview: "history_change"');
  expect(source).toContain("autocapture: false");
  expect(source).toContain('cookieless_mode: "always"');
  expect(source).toContain('persistence: "memory"');
  expect(source).toContain('person_profiles: "never"');
  expect(source).toContain("process.env.NODE_ENV === \"production\"");
});

describe("PostHog endpoint approval", () => {
  test("accepts only the exact US and EU regional origins", () => {
    expect(approvedPostHogEndpoint(undefined)).toEqual({
      apiHost: "https://us.i.posthog.com",
      uiHost: "https://us.posthog.com",
    });
    expect(approvedPostHogEndpoint("https://eu.i.posthog.com/")).toEqual({
      apiHost: "https://eu.i.posthog.com",
      uiHost: "https://eu.posthog.com",
    });
  });

  test("rejects spoofed, credentialed, and path-bearing destinations", () => {
    for (const value of [
      "https://eu.i.posthog.com.evil.example",
      "https://user:password@us.i.posthog.com",
      "https://us.i.posthog.com/private",
      "http://us.i.posthog.com",
      "not a URL",
    ]) {
      expect(approvedPostHogEndpoint(value)).toBeNull();
    }
  });
});
