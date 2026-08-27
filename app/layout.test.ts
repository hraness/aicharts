import { expect, test } from "bun:test";

test("the root layout renders the shared Hraness footer after every route", async () => {
  const source = await Bun.file(new URL("./layout.tsx", import.meta.url)).text();
  const children = source.indexOf("{children}");
  const footer = source.indexOf("<HranessSiteFooter />");

  expect(source).toContain('from "@hraness/site-footer/react"');
  expect(children).toBeGreaterThan(-1);
  expect(footer).toBeGreaterThan(children);
});
