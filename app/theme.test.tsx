import { expect, test } from "bun:test";
import {
  DesignThemeProvider,
  ThemeToggle,
} from "@hraness/design-kit/react";
import { renderToStaticMarkup } from "react-dom/server";

test("appearance starts with System and uses the shared persisted runtime", () => {
  const html = renderToStaticMarkup(
    <DesignThemeProvider storageKey="aicharts-theme">
      <ThemeToggle aria-label="Chart appearance" presentation="menu" />
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
