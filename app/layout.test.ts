import { expect, test } from "bun:test";

test("the root layout renders the shared Hraness footer after every route", async () => {
  const source = await Bun.file(new URL("./layout.tsx", import.meta.url)).text();
  const children = source.indexOf("{children}");
  const footer = source.indexOf("<HranessSiteFooter");
  const analytics = source.indexOf("<AnalyticsBoundary />");

  expect(source).toContain('from "@hraness/site-footer/react"');
  expect(source).toContain('from "@/components/analytics-boundary"');
  expect(source).toContain('from "./mailing-config"');
  expect(source).toContain("mailingList={aiChartsMailingListConfig()}");
  expect(source).toContain('x: { href: "https://x.com/aichartsio", label: "AI Charts on X" }');
  expect(source).toContain(
    'github: { href: "https://github.com/hraness/aicharts", label: "AI Charts on GitHub" }',
  );
  expect(source).not.toContain("bsky.app");
  expect(source).not.toContain("bluesky");
  expect(children).toBeGreaterThan(-1);
  expect(footer).toBeGreaterThan(children);
  expect(analytics).toBeGreaterThan(footer);
});
