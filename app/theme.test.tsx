import { expect, test } from "bun:test";
import {
  DesignThemeProvider,
  ThemeMenuButton,
} from "@hraness/design-kit/react";
import { renderToStaticMarkup } from "react-dom/server";

import GlobalError from "./global-error";
import NotFound from "./not-found";

test("appearance starts with System and uses the shared persisted runtime", () => {
  const html = renderToStaticMarkup(
    <DesignThemeProvider storageKey="aicharts-theme">
      <ThemeMenuButton aria-label="Chart appearance" />
    </DesignThemeProvider>,
  );

  expect(html).toContain("aicharts-theme");
  expect(html).toContain('data-hraness-design-theme-guard=""');
  expect(html).toContain('data-theme-value="system"');
  expect(html).toContain('aria-label="Chart appearance: System"');
});

test("AI Charts does not keep a second theme runtime", async () => {
  const [layout, controls] = await Promise.all([
    Bun.file(new URL("./layout.tsx", import.meta.url)).text(),
    Bun.file(new URL("../components/ui.tsx", import.meta.url)).text(),
  ]);

  expect(layout).toContain('<DesignThemeProvider storageKey="aicharts-theme">');
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
});
