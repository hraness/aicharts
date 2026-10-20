import { expect, test } from "bun:test";

import { admitProductionSourceMaps, withProductionSourceMaps } from "./production-source-maps";
import { assertProperty, fc } from "./property-test";

const productionEnvironment = {
  POSTHOG_API_KEY: "phx_test_personal_key",
  POSTHOG_PROJECT_ID: "543691",
  POSTHOG_UI_HOST: "https://us.posthog.com",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
} as const;

const brokenGateArb = fc.oneof(
  fc.record({ VERCEL_ENV: fc.constantFrom("preview", "development", undefined, "") }),
  fc.record({
    POSTHOG_API_KEY: fc.constantFrom(
      undefined,
      "",
      "phc_public",
      "px_not_personal",
      "PHX_wrong_case",
    ),
  }),
  fc.record({
    POSTHOG_PROJECT_ID: fc.constantFrom(undefined, "", "0", "0123", "project", "543691a"),
  }),
  fc.record({ VERCEL_GIT_COMMIT_SHA: fc.constantFrom(undefined, "") }),
  fc.record({
    POSTHOG_UI_HOST: fc.constantFrom(
      "https://us.i.posthog.com",
      "https://eu.i.posthog.com",
      "https://app.posthog.com",
      "http://us.posthog.com",
      "https://evil.example",
    ),
  }),
);

test("every admitted environment still has the production credential shape", () => {
  assertProperty(fc.property(
    fc.record({
      POSTHOG_API_KEY: fc.constantFrom(
        "phx_test_personal_key",
        "phx_another_key",
      ),
      POSTHOG_PROJECT_ID: fc.constantFrom("1", "543691", "999999"),
      POSTHOG_UI_HOST: fc.option(
        fc.constantFrom("https://us.posthog.com", "https://eu.posthog.com"),
        { nil: undefined },
      ),
      VERCEL_ENV: fc.constant("production"),
      VERCEL_GIT_COMMIT_SHA: fc.constantFrom(
        "0123456789abcdef0123456789abcdef01234567",
        "abcdef0123456789abcdef0123456789abcdef01",
      ),
    }),
    environment => {
      const admission = admitProductionSourceMaps(environment);
      expect(admission).toEqual({
        host: environment.POSTHOG_UI_HOST ?? "https://us.posthog.com",
        personalApiKey: environment.POSTHOG_API_KEY,
        projectId: environment.POSTHOG_PROJECT_ID,
        releaseVersion: environment.VERCEL_GIT_COMMIT_SHA,
      });
    },
  ));
});

test("breaking any one admission gate refuses the upload wrapper", () => {
  assertProperty(fc.property(brokenGateArb, mutation => {
    expect(admitProductionSourceMaps({
      ...productionEnvironment,
      ...mutation,
    })).toBeUndefined();
  }));
});

test("admitted production config wrapping never grows a webpack function", () => {
  assertProperty(fc.property(
    fc.record({
      POSTHOG_API_KEY: fc.constantFrom("phx_test_personal_key", "phx_another_key"),
      POSTHOG_PROJECT_ID: fc.constantFrom("1", "543691", "999999"),
      POSTHOG_UI_HOST: fc.option(
        fc.constantFrom("https://us.posthog.com", "https://eu.posthog.com"),
        { nil: undefined },
      ),
      VERCEL_ENV: fc.constant("production"),
      VERCEL_GIT_COMMIT_SHA: fc.constantFrom(
        "0123456789abcdef0123456789abcdef01234567",
        "abcdef0123456789abcdef0123456789abcdef01",
      ),
    }),
    environment => {
      const wrapped = withProductionSourceMaps({ reactStrictMode: true }, environment);
      expect(wrapped.webpack).toBeUndefined();
      expect(wrapped.compiler?.runAfterProductionCompile).toBeUndefined();
    },
  ));
});
