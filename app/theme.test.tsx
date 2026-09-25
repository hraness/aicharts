import { expect, test } from "bun:test";
import {
  DesignPaletteProvider,
  ThemeMenuButton,
} from "@hraness/design-kit/react";
import { renderToStaticMarkup } from "react-dom/server";

import GlobalError from "./global-error";
import NotFound from "./not-found";

test("appearance starts Tokyo Night, System and uses the shared persisted runtime", () => {
  const html = renderToStaticMarkup(
    <DesignPaletteProvider
      defaultPreference={{ palette: "tokyo-night", mode: "system" }}
      legacyStorageKey="aicharts-theme"
    >
      <ThemeMenuButton aria-label="Chart appearance" />
    </DesignPaletteProvider>,
  );

  expect(html).toContain('data-presentation="menu"');
  expect(html).toContain('aria-label="Chart appearance: Tokyo Night, System"');
});

test("AI Charts does not keep a second theme runtime", async () => {
  const [layout, controls] = await Promise.all([
    Bun.file(new URL("./layout.tsx", import.meta.url)).text(),
    Bun.file(new URL("../components/ui.tsx", import.meta.url)).text(),
  ]);

  expect(layout).toContain("DesignPaletteProvider");
  expect(layout).toContain('legacyStorageKey="aicharts-theme"');
  expect(layout).toContain('data-palette="tokyo-night"');
  expect(layout).toContain('src="/theme-bootstrap.js"');
  expect(controls).toContain('from "@hraness/design-kit/react"');
  expect(controls).not.toContain("localStorage");
  expect(controls).not.toContain("matchMedia");
});

test("fallback documents remain control-free", () => {
  const globalError = renderToStaticMarkup(
    <GlobalError error={new Error("render failed")} reset={() => undefined} />,
  );
  const notFound = renderToStaticMarkup(<NotFound />);

  expect(`${globalError}${notFound}`).not.toContain("hraness-design-theme-toggle");
  expect(globalError).toContain('<meta content="light dark" name="color-scheme"/>');
  expect(globalError).toContain(
    '<meta content="#e1e2e7" media="(prefers-color-scheme: light)" name="theme-color"/>',
  );
  expect(globalError).toContain(
    '<meta content="#1a1b26" media="(prefers-color-scheme: dark)" name="theme-color"/>',
  );
  expect(notFound).toContain("<h1>Page not found</h1>");
  expect(notFound).toContain('href="/"');
  expect(notFound).toContain('href="/data"');
  expect(notFound).toContain('href="/blog"');
  expect(notFound).toContain('href="/llms.txt"');
  expect(notFound).toContain('href="/sitemap.xml"');
});
