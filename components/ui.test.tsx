import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TopBar } from "./ui";

test("TopBar owns sticky document-flow behavior by default", () => {
  const markup = renderToStaticMarkup(
    <TopBar actions={<a href="/data">Data</a>} title={<strong>aicharts.io</strong>} />,
  );

  expect(markup).toContain('class="ui-top-bar"');
  expect(markup).toContain('data-sticky="true"');
  expect(markup).toContain('class="ui-top-bar__title"');
  expect(markup).toContain('class="ui-top-bar__actions"');
});

test("TopBar exposes an explicit non-sticky escape hatch", () => {
  const markup = renderToStaticMarkup(
    <TopBar isSticky={false} title="Static context" />,
  );

  expect(markup).not.toContain("data-sticky");
});
