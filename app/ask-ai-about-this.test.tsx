import { expect, test } from "bun:test";
import { buildAskAiProviderLinks } from "@hraness/ui";
import { renderToStaticMarkup } from "react-dom/server";

import ModelsLayout from "./models/layout";
import Home from "./page";
import { site } from "./site";
import { AI_CHARTS_MODELS_URL } from "@/components/project-ask-ai-about-this";

function expectAskAiRow(markup: string, url: string): void {
  expect(markup.match(/aria-label="Ask AI about this"/gu)).toHaveLength(1);
  const providerLinks = buildAskAiProviderLinks(url);
  for (const link of providerLinks) {
    expect(markup).toContain(`data-ask-ai-provider="${link.provider}"`);
    expect(markup).toContain(`href="${link.href.replaceAll("&", "&amp;")}"`);
  }
  const providerAnchors = markup.match(
    /<a\b[^>]*data-ask-ai-provider="[^"]+"[^>]*>/gu,
  ) ?? [];
  expect(providerAnchors).toHaveLength(providerLinks.length);
  for (const anchor of providerAnchors) {
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer nofollow"');
  }
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
