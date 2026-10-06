import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { formatSnapshotCostUsd, formatSnapshotScore } from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import {
  GEMINI_4_ARGON_INTELLIGENCE_SLUG,
  gemini4ArgonCodingAgentPlacement,
  matchesGemini4ArgonCoding,
} from "@/lib/gemini-4-argon-placement";
import { formatCostMultiple } from "@/lib/mimo-v2-6-pro-frontier";
import { PUBLIC_BLOG_SLUGS } from "@/lib/public-analytics-routes";
import { spellOrdinal } from "@/lib/snapshot-placement";

import { BLOG_ARTICLE_ADMISSIONS, HOME_EDITORIAL_SLUGS } from "./article-admissions";
import { BLOG_SOURCES, articleToMarkdown, getBlogArticle } from "./articles";
import { blogEditorialImage } from "./editorial-images";
import { GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT } from "./gemini-4-argon-coding-agent-index-admission";
import {
  GEMINI_4_ARGON,
  GEMINI_4_ARGON_ARTICLE_PUBLISHED_AT,
  GEMINI_4_ARGON_ARTICLE_SLUG,
  createGemini4ArgonCodingArticle,
} from "./gemini-4-argon-coding-agent-index-article";
import { formatCostPercent, pointsPhrase } from "./opus-5-5-coding-agent-index-article";

const INTERNAL_WORDS = ["admission", "admitted", "bounded", "custody", "gate", "lane", "manifest", "provenance", "receipt"];

function snapshots() {
  const codingParsed = parseCodingAgentSnapshot(codingAgentData);
  if (!codingParsed.ok) throw codingParsed.error;
  const intelligenceParsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!intelligenceParsed.ok) throw intelligenceParsed.error;
  return { codingSnapshot: codingParsed.value, intelligenceSnapshot: intelligenceParsed.value };
}

describe("Gemini 4 Argon coding-agent note", () => {
  test("places Antigravity CLI · Gemini 4 Argon from the same rows the chart plots", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const article = getBlogArticle(GEMINI_4_ARGON_ARTICLE_SLUG);
    expect(article).toBeDefined();
    if (article === undefined) return;
    const markdown = articleToMarkdown(article);

    expect(article.publishedAt).toBe(GEMINI_4_ARGON_ARTICLE_PUBLISHED_AT);
    expect(article.updatedAt >= article.publishedAt).toBeTrue();
    expect(article.section).toBe("AI model benchmarks");
    expect(article.sourceIds).toEqual([
      "artificialAnalysisCodingAgents",
      "googleGemini4Argon",
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisGemini4ArgonModel",
    ]);
    for (const sourceId of article.sourceIds) {
      expect(markdown).toContain(BLOG_SOURCES[sourceId].url);
    }
    expect(article.nextStep?.links.map(link => link.href))
      .toEqual(["/coding", "/models/google/gemini-4-argon/default", "/data"]);
    expect(article.relatedSlugs).toEqual([
      "sonnet-5-5-coding-agent-index",
      "opus-5-5-coding-agent-index",
      "gpt-6-1-sol-coding-agent-index",
      "aa-index-cost-coding-agents",
    ]);
    expect(markdown).toContain(formatRetrievedAt(codingSnapshot.source.retrievedAt));
    expect(markdown).toContain(formatRetrievedAt(intelligenceSnapshot.source.retrievedAt));
    expect(markdown).toContain(intelligenceSnapshot.benchmark.version);
    expect(markdown).toContain("Two charts, two units");
    expect(markdown).toContain("aicharts did not run Gemini 4 Argon");

    // Every quotation is verbatim from the fetched primary pages.
    for (const quote of Object.values(GEMINI_4_ARGON.google)) {
      expect(markdown).toContain(quote);
    }
    for (const quote of Object.values(GEMINI_4_ARGON.artificialAnalysis)) {
      expect(markdown).toContain(quote);
    }

    expect(markdown).not.toContain("—");
    expect(markdown).not.toContain("refresh");
    expect(markdown).not.toContain("schema");
    expect(markdown).not.toContain("`");
    expect(markdown).not.toContain("This note answers");
    expect(markdown).not.toContain("checked snapshot");
    expect(markdown).not.toContain("0.0 points");
    expect(markdown).not.toContain("undefined");
    expect(markdown).not.toContain("NaN");
    for (const word of INTERNAL_WORDS) {
      expect(markdown.toLowerCase()).not.toContain(word);
    }
    expect(article.title).not.toMatch(/^What .* measures$/u);
    expect(article.title).not.toContain("leads the");
    expect(article.title).not.toContain("tops the");
    expect(article.title.length).toBeLessThanOrEqual(64);
    expect(article.dek.length).toBeLessThanOrEqual(200);
    expect(article.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(article.seoDescription.length).toBeLessThanOrEqual(160);

    const coding = gemini4ArgonCodingAgentPlacement(codingSnapshot.records);
    expect(coding).toBeDefined();
    if (coding === undefined) return;
    const score = formatSnapshotScore(coding.record.benchmarks.aaIndex);
    const cost = formatSnapshotCostUsd(coding.record.economics.costUsd);
    expect(article.title).toContain(score);
    const maxShare = Math.max(...coding.higherCostShares.map(share => share.costShare));
    if (coding.higherCostShares.length > 0 && maxShare < 1) {
      expect(article.title).toBe(`Gemini 4 Argon at ${score}: every higher row costs at least ${formatCostMultiple(1 / maxShare)}`);
    }
    expect(markdown).toContain(`${spellOrdinal(coding.rank)} of the ${coding.indexedCount} configurations`);
    expect(markdown).toContain("Neither rank corrects the other.");
    expect(markdown).not.toContain("standing is higher");
    expect(markdown).toContain("none of which appears on the coding-agent chart");
    for (const evaluation of intelligenceSnapshot.benchmark.evaluations) {
      if (evaluation.startsWith("AutomationBench")) {
        expect(markdown).toContain(`${evaluation} is Artificial Analysis’s own variant of one of them`);
      }
    }
    for (const component of coding.components) {
      const ties = codingSnapshot.records.filter(record => (
        record.id !== coding.record.id && record.benchmarks[component.metric] === component.value
      ));
      if (ties.length > 0) {
        expect(markdown).toContain(`${spellOrdinal(component.rank)} of ${component.count}, tied with `);
      }
      for (const tie of ties) {
        expect(markdown).toContain(tie.seriesLabel);
      }
    }
    expect(markdown).toContain(`${spellOrdinal(coding.costRank)} highest cost of the ${coding.costedCount}`);
    for (const share of coding.higherCostShares) {
      expect(markdown).toContain(`charges ${formatSnapshotCostUsd(share.record.economics.costUsd)} for ${pointsPhrase(share.pointsAbove)} more`);
      expect(markdown).toContain(`| ${formatCostPercent(share.costShare)} |`);
    }
    if (coding.cheapestHigher !== undefined) {
      expect(markdown).toContain(`at ${formatCostMultiple(coding.cheapestHigher.multiple)} the Argon row’s cost`);
    }
    const [firstBelow] = coding.frontierBelow;
    if (firstBelow !== undefined) {
      expect(markdown).toContain(`${pointsPhrase(firstBelow.pointsBelow)} lower for`);
      expect(markdown).toContain(`${formatCostPercent(firstBelow.costMultiple)} of the ${cost}`);
    }
    for (const component of coding.components) {
      expect(markdown).toContain(`${spellOrdinal(component.rank)} of ${component.count}`);
    }
    const deepSwe = coding.componentContrasts.find(contrast => contrast.metric === "deepSwe");
    if (deepSwe !== undefined && deepSwe.gapPoints > 0) {
      const bestValue = deepSwe.bestOther.benchmarks.deepSwe;
      const tied = codingSnapshot.records.filter(record => (
        record.id !== coding.record.id && record.benchmarks.deepSwe === bestValue
      ));
      for (const record of tied) {
        expect(markdown).toContain(record.seriesLabel);
      }
      if (tied.length > 1) expect(markdown).toContain(", tied.");
    }

    // The slug is public, admitted, and stays off the curated homepage modules.
    expect(PUBLIC_BLOG_SLUGS as readonly string[]).toContain(GEMINI_4_ARGON_ARTICLE_SLUG);
    expect(HOME_EDITORIAL_SLUGS as readonly string[]).not.toContain(GEMINI_4_ARGON_ARTICLE_SLUG);
    expect(blogEditorialImage(article.slug)?.slug).toBe(article.slug);
  });

  test("states the placement from the records it is given", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const placed = gemini4ArgonCodingAgentPlacement(codingSnapshot.records);
    const subject = placed?.record;
    if (subject === undefined) {
      throw new Error("Checked snapshot must store an Antigravity CLI · Gemini 4 Argon row.");
    }

    const withoutRow = createGemini4ArgonCodingArticle({
      ...codingSnapshot,
      records: codingSnapshot.records.filter(record => !matchesGemini4ArgonCoding(record)),
    }, intelligenceSnapshot);
    const withoutRowMarkdown = articleToMarkdown(withoutRow);
    expect(withoutRow.title).toBe("Antigravity CLI · Gemini 4 Argon on the coding-agent chart");
    expect(withoutRow.dek.length).toBeLessThanOrEqual(200);
    expect(withoutRow.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(withoutRow.seoDescription.length).toBeLessThanOrEqual(160);
    expect(withoutRowMarkdown).toContain("stores no Antigravity CLI · Gemini 4 Argon row with an AA Index and a cost");
    expect(withoutRowMarkdown).toContain("cannot rank the row or place it on the cost frontier");
    expect(withoutRowMarkdown).toContain("cannot state what the rows above it cost");
    expect(withoutRowMarkdown).toContain("cannot walk the cost frontier down from it");
    expect(withoutRowMarkdown).toContain("cannot split the index into its components");
    expect(withoutRowMarkdown).toContain("Gemini 4 Argon’s row would be the model inside Antigravity CLI");
    expect(withoutRowMarkdown).not.toContain("| Coding agents (AA Index) |");
    expect(withoutRowMarkdown).not.toContain("update log records");
    expect(withoutRowMarkdown).not.toContain("undefined");

    const withoutIntelligence = createGemini4ArgonCodingArticle(codingSnapshot, {
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.slug !== GEMINI_4_ARGON_INTELLIGENCE_SLUG),
    });
    const withoutIntelligenceMarkdown = articleToMarkdown(withoutIntelligence);
    expect(withoutIntelligenceMarkdown).toContain("stores no comparable Gemini 4 Argon row");
    expect(withoutIntelligenceMarkdown).not.toContain("| Intelligence Index |");
    expect(withoutIntelligenceMarkdown).not.toContain("Two charts, two units");

    const alone = createGemini4ArgonCodingArticle({
      ...codingSnapshot,
      records: [subject],
      updates: [],
    }, intelligenceSnapshot);
    const aloneMarkdown = articleToMarkdown(alone);
    expect(alone.dek).not.toContain("Every row above it");
    expect(aloneMarkdown).toContain("No configuration scores higher.");
    expect(aloneMarkdown).toContain("the only configuration that carries a cost");
    expect(aloneMarkdown).toContain("nothing to list beneath it");
    expect(aloneMarkdown).toContain("no higher row to price its score against");
    expect(aloneMarkdown).toContain("no frontier vertex scores below");
    expect(aloneMarkdown).toContain("No other Google model carries a costed row");
    expect(aloneMarkdown).toContain("no other configuration carries a component score");
    expect(aloneMarkdown).not.toContain("update log records");
    expect(aloneMarkdown).not.toContain("undefined");

    const twin = {
      ...subject,
      agent: "Twin Harness",
      benchmarks: {
        ...subject.benchmarks,
        aaIndex: subject.benchmarks.aaIndex + 0.5,
        deepSwe: (subject.benchmarks.deepSwe ?? 0) + 1,
      },
      economics: { ...subject.economics, costUsd: subject.economics.costUsd / 2 },
      id: "twin",
      seriesId: "Twin Harness:twin",
      seriesLabel: "Twin Harness · Twin",
    };
    const demoted = createGemini4ArgonCodingArticle({
      ...codingSnapshot,
      records: [...codingSnapshot.records, twin],
    }, intelligenceSnapshot);
    const demotedMarkdown = articleToMarkdown(demoted);
    expect(demotedMarkdown).toContain("Twin Harness · Twin");
    expect(demotedMarkdown).toContain("is not on it: one configuration costs the same or less per task and scores at least as high");
    expect(demotedMarkdown).toContain("What the rows above it cost");
    expect(demotedMarkdown).not.toContain("Every configuration that scores above Argon costs more per task");
    expect(demotedMarkdown).toContain(`Twin Harness · Twin (default) scores ${pointsPhrase(1)} higher on DeepSWE v1.1`);

    const laterRetrieval = createGemini4ArgonCodingArticle({
      ...codingSnapshot,
      source: { ...codingSnapshot.source, retrievedAt: "2026-12-01T08:00:00.000Z" },
    }, intelligenceSnapshot);
    expect(laterRetrieval.updatedAt).toBe("2026-12-01");
    expect(articleToMarkdown(laterRetrieval)).toContain("Dec 1, 2026, 8:00 AM UTC");

    const expensive = createGemini4ArgonCodingArticle({
      ...codingSnapshot,
      records: codingSnapshot.records.map(record => (
        matchesGemini4ArgonCoding(record)
          ? { ...record, economics: { ...record.economics, costUsd: 1_234_567_890.12 } }
          : record
      )),
    }, intelligenceSnapshot);
    expect(expensive.title.length).toBeLessThanOrEqual(64);
    expect(expensive.title).not.toContain("every higher row costs");
    expect(expensive.title).not.toContain("$1,234,567,890.12");
    expect(expensive.title).toContain(formatSnapshotScore(subject.benchmarks.aaIndex));
    expect(demoted.title).toBe(`Antigravity CLI · Gemini 4 Argon: ${formatSnapshotScore(subject.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(subject.economics.costUsd)} a task`);
  });

  test("admission scores meet the keep gate and the record is registered", () => {
    const scores = Object.values(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT.scores);
    expect(scores.every(score => score > 0)).toBeTrue();
    expect(scores.reduce((sum, score) => sum + score, 0)).toBeGreaterThanOrEqual(9);
    expect(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT.canonicalOwner).toBe(`/blog/${GEMINI_4_ARGON_ARTICLE_SLUG}`);
    expect(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT.drafting).toBe("ai");
    expect(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT.reviewerType).toBe("ai");
    expect(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT.humanReviewedOn).toBeNull();
    expect(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT.lifecycleState).toBe("indexable");
    expect(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT.nearestUrls.map(entry => entry.url)).toEqual([
      "/blog/sonnet-5-5-coding-agent-index",
      "/blog/opus-5-5-coding-agent-index",
      "/blog/gpt-6-1-sol-coding-agent-index",
      "/blog/aa-index-cost-coding-agents",
    ]);
    expect(BLOG_ARTICLE_ADMISSIONS[GEMINI_4_ARGON_ARTICLE_SLUG]).toEqual(GEMINI_4_ARGON_ARTICLE_ADMISSION_DRAFT);
  });
});
