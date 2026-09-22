import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SiteHeader } from "./site-header";

test("the shared header renders the canonical product wordmark on the shared foil hook", () => {
  const markup = renderToStaticMarkup(createElement(SiteHeader, { current: "/" }));

  expect(markup).toContain('class="hraness-marketing-header__brand"');
  expect(markup).toContain('data-foil=""');
  expect(markup).toContain('src="/icon.png"');
  expect(markup).toContain("> AI Charts</a>");
  expect(markup).not.toContain("◉");
  expect(markup).not.toContain(">aicharts.io<");
});

test("publishes the design-kit sticky offset from the in-flow marketing header", async () => {
  const source = await Bun.file(new URL("./site-header.tsx", import.meta.url)).text();

  expect(source).toContain('from "@hraness/design-kit/react"');
  expect(source).toContain("StickyOffsetSync");
  expect(source).toContain("hraness-marketing-header");
  expect(source).not.toContain("data-position=\"fixed\"");
  expect(source).not.toContain("--hraness-marketing-main-offset");
});
