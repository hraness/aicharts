import { expect, test } from "bun:test";
import { createBrowserExceptionBudget, sanitizeAnalyticsError } from "./analytics-privacy";
import { analyticsEventPayload, exceptionEventProperties, pageNotFoundEvent } from "./analytics";
import { normalizedPageAnalyticsProperties } from "./page-analytics";

test("exceptions retain standard type without private messages or stack frames", () => {
  const raw = new TypeError("customer alice@example.com token=private-secret");
  raw.stack = "TypeError at https://aicharts.io/account/private-secret?token=secret";
  const safe = sanitizeAnalyticsError(raw);
  expect(safe.name).toBe("TypeError");
  expect(safe.message).toBe("Client operation failed");
  expect(safe.stack).toBeUndefined();
  const budget = createBrowserExceptionBudget();
  expect(exceptionEventProperties(safe, "window_error", budget, 1)).not.toBeNull();
  expect(exceptionEventProperties(safe, "window_error", budget, 2)).not.toBeNull();
  expect(exceptionEventProperties(safe, "window_error", budget, 3)).toBeNull();
  expect(exceptionEventProperties(safe, "window_error", budget, 60002)).not.toBeNull();
});

test("404 reports retain no unadmitted path or referrer query", () => {
  const event = pageNotFoundEvent("/account/%61lice/private-secret?token=secret", "https://google.com/search?q=private-secret");
  expect(analyticsEventPayload({ name: "page not found", properties: { requested_path: "/account/private-canary", referrer_host: "google.com" } })?.properties.requested_path).toBe("/[other]");
  expect(event).toEqual({ name: "page not found", properties: { requested_path: "/[other]", referrer_host: "google.com" } });
});

test("provider properties preserve cookieless inputs and reject private nested values and keyword attribution", () => {
  const properties = normalizedPageAnalyticsProperties("https://aicharts.io/coding?utm_source=private-secret", {
    $current_url: "https://aicharts.io/coding?token=private-secret",
    $referrer: "https://google.com/search?q=private-secret",
    ph_keyword: "private-secret", $initial_ph_keyword: "private-secret", utm_source: "private-secret",
    $raw_user_agent: "browser-user-agent", $session_id: "session-canary", $cookieless_mode: true,
    context: { url: "https://aicharts.io/account/private-canary", email: "alice@example.com", token: "private-secret" },
  });
  expect(properties.$current_url).toBe("https://aicharts.io/coding");
  expect(properties.$referrer).toBe("https://google.com");
  expect(properties.$raw_user_agent).toBe("browser-user-agent");
  expect(properties.$session_id).toBe("session-canary");
  expect(properties.$cookieless_mode).toBe(true);
  expect(JSON.stringify(properties)).not.toContain("private-canary");
  expect(JSON.stringify(properties)).not.toContain("private-secret");
  expect(JSON.stringify(properties)).not.toContain("alice@example.com");
});

const encodedPrivacyCanaries = [
  "+@a.aa",
  "person.contract%40example.com",
  "personé%40example.com",
  "person%40%E4%BE%8B%E5%AD%90.%E4%B8%AD%E5%9B%BD",
  "Bearer%20canary_secret_123",
  "api_key%3Dcanary_secret_123",
  "https%3A%2F%2Fcanary_user%3Acanary_password%40example.com/path",
] as const;

test("encoded private 404 paths and exception text stay outside product events", () => {
  for (const canary of encodedPrivacyCanaries) {
    const event = pageNotFoundEvent(`/missing/${canary}?q=private-query`, "https://google.com/search?q=private-query");
    expect(event?.properties.requested_path).toBe("/[other]");
    const error = sanitizeAnalyticsError(new Error(canary));
    expect(error.message).toBe("Client operation failed");
    expect(error.stack).toBeUndefined();
    const properties = normalizedPageAnalyticsProperties(`/missing/${canary}`, {
      $current_url: `https://aicharts.io/missing/${canary}`,
      $pathname: `/missing/${canary}`,
      requested_path: `/missing/${canary}`,
    });
    expect(properties.$current_url).toBe("https://aicharts.io/[other]");
    expect(properties.requested_path).toBe("/[other]");
    expect(JSON.stringify({ event, properties, message: error.message })).not.toContain(canary);
  }
});

test("provider boundary scrubs encoded credentials and emails in nested exception values", () => {
  for (const canary of encodedPrivacyCanaries) {
    const properties = normalizedPageAnalyticsProperties("https://aicharts.io/coding", {
      $exception_list: [{ type: "Error", value: canary }],
    });
    const serialized = JSON.stringify(properties);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("canary_secret_123");
    expect(serialized).not.toContain("canary_password");
  }
});
