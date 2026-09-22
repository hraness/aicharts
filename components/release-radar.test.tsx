import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelReleaseRadars } from "./release-radar";
import { FIRST_PARTY_RELEASE_HIGHLIGHTS } from "@/lib/first-party-release-collection";

test("radar rows use the shared equal-height card-row contract and reserve meta space", () => {
  const markup = renderToStaticMarkup(createElement(ModelReleaseRadars));

  expect(markup).toContain('class="hraness-marketing-card-row"');
  expect(markup).toContain("hraness-marketing-card__meta");
  expect(markup).toContain("model-release-radar__early-score");
  if (FIRST_PARTY_RELEASE_HIGHLIGHTS.length > 0) {
    expect(markup).toContain("First-party release radar");
    expect(markup).toContain("first-party-release-radar-title");
  }
  const cards = markup.match(/<li\b/gu)?.length ?? 0;
  expect(cards).toBeGreaterThan(0);
  expect(markup.match(/hraness-marketing-card__meta/gu)).toHaveLength(cards);
});
