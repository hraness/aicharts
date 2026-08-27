import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";

import { ModelCardShare } from "./model-card-share";

describe("ModelCardShare", () => {
  test("renders a progressively available same-origin PNG download", () => {
    const card = MODEL_CARD_PRESENTATIONS[0];
    expect(card).toBeDefined();
    if (card === undefined) return;
    const markup = renderToStaticMarkup(
      <ModelCardShare
        canonicalUrl={`https://aicharts.io${card.path}`}
        card={card}
        imageUrl={`${card.path}/card.png?v=snapshot`}
      />,
    );
    expect(markup).toContain("Download PNG");
    expect(markup).toContain("download=\"aicharts-");
    expect(markup).toContain("card.png?v=snapshot");
    expect(markup.match(/data-size="compact"/gu)).toHaveLength(5);
    expect(markup).not.toContain('data-size="default"');
    expect(markup).toMatch(/class="hraness-button hraness-copy-button"[^>]*data-size="compact"[^>]*data-variant="quiet"/u);
    expect(markup).not.toContain("Share image");
  });

  test("preserves action hierarchy when the share controls wrap", async () => {
    const stylesheet = await Bun.file(
      new URL("../styles/model-cards.css", import.meta.url),
    ).text();

    expect(stylesheet).toMatch(/@media \(max-width:\s*430px\)[\s\S]*?\.model-card-share__primary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*max-content max-content;/u);
    expect(stylesheet).toMatch(/\.model-card-share__primary > \[data-variant="primary"\]\s*\{[^}]*grid-column:\s*1 \/ -1;/u);
  });
});
