import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import UsagePage from "./page";

describe("usage page", () => {
  const markup = renderToStaticMarkup(createElement(UsagePage));

  test("points at the published collector release without typing a version", () => {
    expect(markup).toContain('<a href="https://github.com/hraness/aicharts/releases/latest">GitHub Releases</a>');
    expect(markup).toContain("Account sync runs on macOS only.");
    expect(markup).not.toContain("no packaged release yet");
    expect(markup).not.toMatch(/v?0\.1\.0/u);
  });

  test("names similar local-log tools with a checked date", () => {
    const similarAt = markup.indexOf('<h2 id="usage-similar-title">Similar tools</h2>');
    expect(similarAt).toBeGreaterThan(markup.indexOf('id="usage-title"'));
    expect(similarAt).toBeLessThan(markup.indexOf('id="usage-setup-title"'));
    expect(markup).toContain('<a href="https://ccusage.com">ccusage</a>');
    expect(markup).toContain('<a href="https://tokscale.ai">Tokscale</a>');
    expect(markup).toContain("Checked Sep 28, 2026.");
  });
});
