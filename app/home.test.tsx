import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDocument } from "@/components/home-document";
import { homeDocumentModel, homeDocumentText } from "@/lib/site-markdown";

import Home from "./page";
import { homeHeading } from "./site";

describe("homepage agent document", () => {
  test("server-renders an H1 and more than 500 characters of text", () => {
    const document = homeDocumentModel();
    const markup = renderToStaticMarkup(createElement(HomeDocument, { document }));
    const text = homeDocumentText();

    expect(markup).toContain(`<h1 id="home-document-heading">${homeHeading}</h1>`);
    expect(markup).toContain('class="home-document"');
    expect(markup).toContain('href="/data"');
    expect(markup).toContain('href="/llms.txt"');
    expect(markup).toContain('href="/sitemap.xml"');
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain(document.paragraphs[0] ?? "");
  });

  test("keeps the document on the server page beside the chart", async () => {
    const source = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
    expect(source).toContain("<HomeDocument");
    expect(source).toContain("<CodingAgentExplorer");
    expect(Home.name).toBe("Home");
  });
});
