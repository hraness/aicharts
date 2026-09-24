import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { homeTaskLinks } from "@/app/site";

import { ChartPageFooter, HomeExploreFooter } from "./chart-navigation";

const footerStyles = await Bun.file(new URL("../styles/chart-footer.css", import.meta.url)).text();
const homeStyles = await Bun.file(new URL("../styles/chart-home.css", import.meta.url)).text();

describe("chart page footer nav", () => {
  test("keeps the shared resource row as a compact chart-page-footer", () => {
    const html = renderToStaticMarkup(createElement(ChartPageFooter));
    expect(html).toContain('class="chart-page-footer"');
    expect(html).toContain('aria-label="Chart resources"');
    expect(html).toContain('href="/data"');
    // One label per destination, matching the site header and 404 links.
    expect(html).toContain('href="/data">Data</a>');
    expect(html).toContain('href="/models">Models</a>');
    expect(html).toContain('href="/blog">Notes</a>');
    expect(html).toContain('href="https://github.com/hraness/aicharts"');
    expect(html).toContain("Open source");
    expect(html).not.toContain("chart-page-footer-stack");
    expect(html).not.toContain("/icons/task-");
  });

  test("homepage explore nav reuses the same footer density and destinations", () => {
    const html = renderToStaticMarkup(createElement(HomeExploreFooter));
    expect(html).toContain('class="chart-page-footer-stack"');
    expect(html.match(/class="chart-page-footer"/gu)).toHaveLength(2);
    expect(html).toContain('aria-label="What do you want to do?"');
    expect(html).toContain('aria-label="Chart resources"');
    expect(html).toContain('href="/benchmarks">All benchmarks');
    for (const link of homeTaskLinks) {
      expect(html).toContain(`href="/benchmarks?task=${link.task}#explore">${link.name}</a>`);
      expect(html).not.toContain(link.description);
    }
    expect(html).toContain('href="/data">Data</a>');
    expect(html).not.toContain("task-discovery");
    expect(html).not.toContain("/icons/task-");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<h2");
  });

  test("footer styles stay compact and home no longer owns a card grid", () => {
    expect(footerStyles).toContain(".chart-page-footer {");
    expect(footerStyles).toContain("font-size: 12px");
    expect(footerStyles).toContain("flex-wrap: wrap");
    expect(footerStyles).toContain(".chart-page-footer-stack");
    expect(homeStyles).not.toContain(".task-discovery");
    expect(homeStyles).not.toContain("task-discovery__icon");
    expect(homeStyles).not.toContain("grid-template-columns: repeat(3");
  });
});
