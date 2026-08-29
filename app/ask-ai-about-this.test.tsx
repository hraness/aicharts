import { expect, test } from "bun:test";
import { buildAskAiProviderLinks } from "@hraness/ui";
import { renderToStaticMarkup } from "react-dom/server";

import ModelsLayout from "./models/layout";
import Home from "./page";
import { site } from "./site";
import { AI_CHARTS_MODELS_URL } from "@/components/project-ask-ai-about-this";

function expectAskAiRow(markup: string, url: string): void {
  expect(markup.match(/aria-label="Ask AI about this"/gu)).toHaveLength(1);
  for (const link of buildAskAiProviderLinks(url)) {
    expect(markup).toContain(`data-ask-ai-provider="${link.provider}"`);
    expect(markup).toContain(`href="${link.href.replaceAll("&", "&amp;")}"`);
  }
  expect(markup.match(/target="_blank"/gu)).toHaveLength(4);
  expect(markup.match(/rel="noopener noreferrer nofollow"/gu)).toHaveLength(4);
}

test("server-renders the project subject on the comparison chart", () => {
  expectAskAiRow(renderToStaticMarkup(<Home />), site.origin);
});

test("server-renders the distinct model-card subject through its route layout", () => {
  const markup = renderToStaticMarkup(
    <ModelsLayout><main>model card route</main></ModelsLayout>,
  );
  expectAskAiRow(markup, AI_CHARTS_MODELS_URL);
});
