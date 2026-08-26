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
    expect(markup).not.toContain("Share image");
  });
});
