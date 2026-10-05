import { describe, expect, test } from "bun:test";
import { platformLabel } from "@hraness/design-kit";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { markdownForPath } from "@/lib/site-markdown";

import UsagePage from "./page";
import { usageDashboard, usageHero, usageLocalReport, usageSetup } from "./content";
import { usageInstallPlatforms } from "./install";

const PAGE_URL = "https://aicharts.io/usage";

function decode(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function visibleText(html: string): string {
  return decode(html.replace(/<[^>]+>/gu, "")).replace(/\s+/gu, " ").trim();
}

/** Markdown reduced to the words a reader sees, for comparison with page text. */
function markdownText(markdown: string): string {
  return markdown
    .replace(/^```.*$/gmu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^#+ /gmu, "")
    .replace(/^(?:- |\d+\. )/gmu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/^\*([^*]+)\*$/gmu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

const page = renderToStaticMarkup(createElement(UsagePage));
const fullMain = page.slice(page.indexOf("<main"), page.indexOf("</main>"));
// The dashboard figure is an illustration with made-up numbers, and the
// trailing navigation is site chrome. Section kickers repeat the heading below.
const main = fullMain
  .replace(/<figure\b[\s\S]*?<\/figure>/gu, "")
  .replace(/<nav class="chart-page-footer"[\s\S]*?<\/nav>/gu, "")
  .replace(/<(p|span) class="usage-eyebrow">[^<]*<\/\1>/gu, "");
const document = markdownForPath("/usage");
const markdown = document.body;
const readable = markdownText(markdown);

describe("usage page Markdown", () => {
  test("is found and served as Markdown", () => {
    expect(document.found).toBeTrue();
    expect(document.contentType).toBe("text/markdown; charset=utf-8");
    expect(markdown).not.toContain("undefined");
    expect(markdown).not.toContain("[object Object]");
    expect(markdownForPath("/usage/")).toEqual(document);
  });

  test("keeps the page's heading outline", () => {
    const pageHeadings = [...main.matchAll(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gu)]
      .map(([, level, inner]) => `${"#".repeat(Number(level))} ${visibleText(inner!)}`);
    const markdownHeadings = markdown.split("\n").filter(line => /^#{1,2} /u.test(line));
    expect(pageHeadings.length).toBeGreaterThan(4);
    expect(markdownHeadings).toEqual(pageHeadings);
  });

  test("contains every heading, paragraph, and list item a visitor reads", () => {
    const blocks = [
      ...[...main.matchAll(/<(h[1-3]|p)\b[^>]*>([\s\S]*?)<\/\1>/gu)].map(([, , inner]) => visibleText(inner!)),
      ...[...main.matchAll(/<li\b[^>]*>([^<]*)<\/li>/gu)].map(([, inner]) => visibleText(inner!)),
    ].filter(block => block !== "");
    expect(blocks.length).toBeGreaterThan(30);
    for (const block of blocks) expect(readable, block).toContain(block);
    expect(markdown).toContain(`${usageLocalReport.eyebrow}. `);
  });

  test("links every destination the page links", () => {
    const hrefs = [...main.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gu)].map(([, href]) => decode(href!));
    expect(hrefs.length).toBeGreaterThan(8);
    for (const href of hrefs) {
      const target = /^https?:\/\//u.test(href) ? href : new URL(href, PAGE_URL).toString();
      expect(markdown, href).toContain(`](${target})`);
    }
  });

  test("carries every install and setup command with its note", () => {
    const pageText = decode(fullMain.replace(/<[^>]+>/gu, ""));
    for (const platform of usageInstallPlatforms) {
      if ("unavailable" in platform) {
        expect(pageText).toContain(platform.unavailableNote);
        expect(markdown).toContain(`**${platformLabel(platform.id)}**\n\n${platform.unavailableNote}`);
        continue;
      }
      expect(pageText).toContain(platform.command);
      expect(pageText).toContain(platform.note);
      expect(markdown).toContain(`**${platformLabel(platform.id)}** · ${platform.shell}\n\n\`\`\`sh\n${platform.command}\n\`\`\`\n\n${platform.note}`);
    }
    for (const { command, note } of [usageSetup.enroll, usageLocalReport.report]) {
      expect(pageText).toContain(command);
      expect(pageText).toContain(note);
      expect(markdown).toContain(`\`\`\`sh\n${command}\n\`\`\`\n\n*${note}*`);
    }
    for (const platform of usageHero.platforms) {
      expect(pageText).toContain(platform.note);
      expect(markdown).toContain(`${platformLabel(platform.id)} (${platform.note})`);
    }
  });

  test("leaves out the illustrative dashboard and its made-up numbers", () => {
    expect(fullMain).toContain(usageDashboard.illustrationCaption);
    expect(markdown).not.toContain(usageDashboard.illustrationCaption);
    expect(markdown).not.toContain("aicharts.example");
  });
});
