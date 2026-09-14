import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackedChartLink } from "./tracked-chart-link";

describe("editorial comparison links", () => {
  test("opens the coding chart named by its analytics event without a legacy redirect", () => {
    for (const sourceKind of ["blog_article", "blog_index"] as const) {
      const markup = renderToStaticMarkup(
        <TrackedChartLink className="comparison-link" sourceKind={sourceKind}>
          Current comparison: coding agents
        </TrackedChartLink>,
      );
      expect(markup).toContain('href="/coding"');
      expect(markup).toContain('class="comparison-link"');
      expect(markup).toContain("Current comparison: coding agents");
      expect(markup).not.toContain('href="/"');
    }
  });
});
