import { expect, test } from "bun:test";

test("the root layout renders the shared Hraness footer after every route", async () => {
  const source = await Bun.file(new URL("./layout.tsx", import.meta.url)).text();
  const children = source.indexOf("{children}");
  const footer = source.indexOf(
    "<HranessSiteFooter mailingList={aiChartsMailingListConfig()} />",
  );
  const analytics = source.indexOf("<AnalyticsBoundary />");

  expect(source).toContain('from "@hraness/site-footer/react"');
  expect(source).toContain('from "@/components/analytics-boundary"');
  expect(source).toContain('from "./mailing-config"');
  expect(children).toBeGreaterThan(-1);
  expect(footer).toBeGreaterThan(children);
  expect(analytics).toBeGreaterThan(footer);
});
