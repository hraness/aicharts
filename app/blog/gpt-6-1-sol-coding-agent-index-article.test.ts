import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { gpt61SolCodingAgentPlacement } from "@/lib/gpt-6-1-sol-placement";
import { spellOrdinal } from "@/lib/snapshot-placement";

import { PUBLIC_BLOG_SLUGS } from "@/lib/public-analytics-routes";

import { BLOG_ARTICLE_ADMISSIONS } from "./article-admissions";
import { GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT } from "./gpt-6-1-sol-coding-agent-index-admission";
import {
  GPT_6_1_SOL,
  GPT_6_1_SOL_ARTICLE_PUBLISHED_AT,
  GPT_6_1_SOL_ARTICLE_SLUG,
  createGpt61SolArticle,
  gpt61SolArticleMarkdown,
} from "./gpt-6-1-sol-coding-agent-index-article";

describe("GPT-6.1 Sol coding-agent note", () => {
  test("derives the live snapshot placement and keeps the Index as a two-unit callout", () => {
    const article = createGpt61SolArticle();
    const markdown = gpt61SolArticleMarkdown(article);
    const codingParsed = parseCodingAgentSnapshot(codingAgentData);
    if (!codingParsed.ok) throw codingParsed.error;
    const placement = gpt61SolCodingAgentPlacement(codingParsed.value.records);
    expect(article.slug).toBe(GPT_6_1_SOL_ARTICLE_SLUG);
    expect(article.publishedAt).toBe(GPT_6_1_SOL_ARTICLE_PUBLISHED_AT);
    expect(article.updatedAt >= article.publishedAt).toBeTrue();
    expect(article.title.length).toBeLessThanOrEqual(64);
    expect(article.dek.length).toBeLessThanOrEqual(200);
    expect(article.seoDescription.length).toBeLessThanOrEqual(160);
    expect(markdown).toContain(GPT_6_1_SOL.openAi.headlineClaim);
    expect(markdown).toContain(GPT_6_1_SOL.openAi.vendorDeepSwe);
    expect(markdown).toContain(GPT_6_1_SOL.openAi.notInChat);
    expect(markdown).toContain(GPT_6_1_SOL.artificialAnalysis.summaryLine);
    expect(markdown).toContain("Two charts, two units");
    expect(markdown).toContain("does not rank it with coding-agent scores");
    expect(markdown).toContain("/blog/gpt-6-sol-coding-agent-index");
    expect(markdown).not.toContain("—");
    expect(markdown).not.toContain("refresh");
    expect(markdown).not.toContain("schema");
    expect(markdown).not.toContain("effort ladder");
    expect(markdown).not.toContain("0.0 points");
    if (placement !== undefined) {
      expect(markdown).toContain(configurationScore(placement.record.benchmarks.aaIndex));
      expect(markdown).toContain(formatSnapshotCostUsd(placement.record.economics.costUsd));
      expect(markdown).toContain(`${spellOrdinal(placement.rank)} of the ${placement.indexedCount}`);
      if (placement.record.setting !== "max") {
        expect(article.title).toContain("not max");
      }
      const frontierSettings = placement.settingsOnFrontier.map(row => row.setting);
      if (frontierSettings.length > 0 && frontierSettings.length < placement.settings.length) {
        expect(markdown.toLowerCase()).toContain(frontierSettings[0] ?? "");
      }
    }
  });

  test("states the Codex · GPT-6.1 Sol placement from the records it is given", () => {
    const codingParsed = parseCodingAgentSnapshot(codingAgentData);
    if (!codingParsed.ok) throw codingParsed.error;
    const intelligenceParsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!intelligenceParsed.ok) throw intelligenceParsed.error;
    const codingSnapshot = codingParsed.value;
    const intelligenceSnapshot = intelligenceParsed.value;
    const placed = gpt61SolCodingAgentPlacement(codingSnapshot.records);
    const subject = placed?.record;
    if (subject === undefined || subject.benchmarks.aaIndex === null || subject.economics.costUsd === null) {
      throw new Error("Checked snapshot must store a Codex · GPT-6.1 Sol row.");
    }

    const withoutRow = createGpt61SolArticle({
      ...codingSnapshot,
      records: codingSnapshot.records.filter(record => record.model !== "GPT-6.1 Sol"),
    }, intelligenceSnapshot);
    const withoutRowMarkdown = gpt61SolArticleMarkdown(withoutRow);
    expect(withoutRow.title).toBe("Codex · GPT-6.1 Sol on the coding-agent chart");
    expect(withoutRowMarkdown).toContain("stores no Codex · GPT-6.1 Sol row with an AA Index and a cost");
    expect(withoutRowMarkdown).toContain("cannot rank the row or place it on the cost frontier");
    expect(withoutRowMarkdown).toContain("cannot list the Codex effort settings");
    expect(withoutRowMarkdown).toContain("cannot walk the cost frontier down from it");
    expect(withoutRowMarkdown).toContain("cannot split the index into its components");
    expect(withoutRowMarkdown).toContain("cannot compare the two generations");
    expect(withoutRowMarkdown).not.toContain("| Coding agents (AA Index) |");
    expect(withoutRowMarkdown).not.toContain("| Setting | AA Index |");

    const withoutIntelligence = createGpt61SolArticle(codingSnapshot, {
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.slug !== "gpt-6-1-sol"),
    });
    const withoutIntelligenceMarkdown = gpt61SolArticleMarkdown(withoutIntelligence);
    expect(withoutIntelligenceMarkdown).toContain("stores no comparable GPT-6.1 Sol max-effort row");
    expect(withoutIntelligenceMarkdown).not.toContain("| Intelligence Index |");

    const alone = createGpt61SolArticle({
      ...codingSnapshot,
      records: [subject],
      updates: [],
    }, intelligenceSnapshot);
    const aloneMarkdown = gpt61SolArticleMarkdown(alone);
    expect(alone.dek).not.toContain("Max scores");
    expect(aloneMarkdown).toContain("No configuration scores higher.");
    expect(aloneMarkdown).toContain("nothing to list beneath it");
    expect(aloneMarkdown).toContain("no frontier vertex scores below");
    expect(aloneMarkdown).toContain("does not store both Codex · GPT-6 Sol and Codex · GPT-6.1 Sol");
    expect(aloneMarkdown).not.toContain("update log records");

    const twin = {
      ...subject,
      agent: "Twin Harness",
      benchmarks: {
        ...subject.benchmarks,
        aaIndex: subject.benchmarks.aaIndex + 0.5,
        sweAtlas: (subject.benchmarks.sweAtlas ?? 0) - 10,
        terminalBench: (subject.benchmarks.terminalBench ?? 0) + 1,
      },
      economics: { ...subject.economics, costUsd: subject.economics.costUsd / 2 },
      id: "twin",
      seriesId: "Twin Harness:twin",
      seriesLabel: "Twin Harness · Twin",
    };
    const demoted = createGpt61SolArticle({
      ...codingSnapshot,
      records: [...codingSnapshot.records, twin],
    }, intelligenceSnapshot);
    const demotedMarkdown = gpt61SolArticleMarkdown(demoted);
    expect(demotedMarkdown).toContain("Twin Harness · Twin");
    expect(demotedMarkdown).toContain("is not on it: one configuration costs the same or less per task and scores at least as high");

    const laterRetrieval = createGpt61SolArticle({
      ...codingSnapshot,
      source: { ...codingSnapshot.source, retrievedAt: "2026-12-01T08:00:00.000Z" },
    }, intelligenceSnapshot);
    expect(laterRetrieval.updatedAt).toBe("2026-12-01");
    expect(gpt61SolArticleMarkdown(laterRetrieval)).toContain("Dec 1, 2026, 8:00 AM UTC");

    const expensive = createGpt61SolArticle({
      ...codingSnapshot,
      records: codingSnapshot.records.map(record => (
        record.model === "GPT-6.1 Sol"
          ? { ...record, economics: { ...record.economics, costUsd: 123_456.78 } }
          : record
      )),
    }, intelligenceSnapshot);
    expect(expensive.title).toBe(
      `${"GPT-6.1 Sol"}’s best Codex row is ${formatSnapshotScore(subject.benchmarks.aaIndex)}, not max`,
    );
    expect(expensive.title.length).toBeLessThanOrEqual(64);
    expect(expensive.title).not.toContain("$123,456.78");
  });

  test("admission scores meet the keep gate and the note is publicly registered", () => {
    const scores = Object.values(GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT.scores);
    expect(scores.every(score => score > 0)).toBeTrue();
    expect(scores.reduce((sum, score) => sum + score, 0)).toBeGreaterThanOrEqual(9);
    expect(GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT.canonicalOwner).toBe(`/blog/${GPT_6_1_SOL_ARTICLE_SLUG}`);
    expect(GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT.reviewerType).toBe("ai");
    expect(GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT.humanReviewedOn).toBeNull();
    expect(PUBLIC_BLOG_SLUGS as readonly string[]).toContain(GPT_6_1_SOL_ARTICLE_SLUG);
    expect(Object.keys(BLOG_ARTICLE_ADMISSIONS)).toContain(GPT_6_1_SOL_ARTICLE_SLUG);
    expect(BLOG_ARTICLE_ADMISSIONS[GPT_6_1_SOL_ARTICLE_SLUG]).toEqual(GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT);
  });
});

function configurationScore(value: number): string {
  return formatSnapshotScore(value);
}
