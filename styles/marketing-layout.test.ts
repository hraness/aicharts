import { expect, test } from "bun:test";

const stylesheet = await Bun.file(new URL("./marketing-layout.css", import.meta.url)).text();

function firstRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"))?.groups?.body ?? "";
}

test("the local marketing layout stand-in publishes the shared clearance and card-row names", () => {
  expect(stylesheet).toContain("--hraness-marketing-header-height: 3.5rem");
  expect(stylesheet).toContain("--hraness-marketing-sticky-clearance: var(--hraness-marketing-header-height)");
  expect(stylesheet).toContain("--hraness-marketing-main-offset: var(--hraness-marketing-sticky-clearance)");
  expect(firstRule("html")).toContain("scroll-padding-block-start: var(--hraness-marketing-sticky-clearance)");
  expect(firstRule(".hraness-marketing-main")).toContain("padding-block-start: var(--hraness-marketing-main-offset)");
  expect(firstRule(".hraness-marketing-card-row")).toContain("align-items: stretch");
  expect(firstRule(".hraness-marketing-card-row")).toContain("display: grid");
  expect(firstRule(".hraness-marketing-card-row__meta")).toContain("-webkit-line-clamp: 2");
  expect(firstRule(".hraness-marketing-card-row__meta")).toContain("min-block-size: calc(2 * 1.35em)");
  expect(stylesheet).toMatch(
    /@media \(max-width:\s*48rem\)[\s\S]*?--hraness-marketing-header-height:\s*5\.25rem/u,
  );
});
