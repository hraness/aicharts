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
    const copyButton = markup.match(/<span\b[^>]*class="([^"]*\bhraness-copy-button\b[^"]*)"[^>]*>(<button\b[^>]*>)/u);
    expect(copyButton).not.toBeNull();
    if (copyButton === null) throw new Error("The copy action must remain a shared button");
    const copyClasses = copyButton[1].split(/\s+/u);
    expect(copyClasses).toContain("hraness-button");
    expect(copyClasses).toContain("hraness-copy-button");
    expect(copyClasses.some((className) => /^x[a-zA-Z0-9_-]+$/u.test(className))).toBe(true);
    expect(copyButton[0]).toContain('data-size="compact"');
    expect(copyButton[0]).toContain('data-variant="quiet"');
    expect(copyButton[2]).toContain('data-slot="button-control"');
    expect(copyButton[2]).not.toContain('disabled=""');
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
