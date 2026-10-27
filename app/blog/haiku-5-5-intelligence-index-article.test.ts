import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  CLAUDE_HAIKU_55_INTELLIGENCE_SLUG,
  CLAUDE_HAIKU_55_RELEASE_SLUG,
  GPT_6_LUNA_RELEASE_SLUG,
  anthropicFrontier,
  familyRowsDominatedBy,
  haikuIntelligencePlacement,
  releaseRowsAgainst,
  siblingFamilyRows,
} from "@/lib/claude-haiku-5-5-placement";
import { inputCostShare, reasoningShare, taskCostBreakdown } from "@/lib/claude-opus-5-5-placement";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { formatSnapshotCostUsd, formatSnapshotScore } from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import { comparableTaskCost, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import { PUBLIC_BLOG_SLUGS } from "@/lib/public-analytics-routes";
import { formatFineCostMultiple, spellOrdinal } from "@/lib/snapshot-placement";

import { BLOG_ARTICLE_ADMISSIONS, HOME_EDITORIAL_SLUGS } from "./article-admissions";
import { BLOG_SOURCES, articleToMarkdown, getBlogArticle } from "./articles";
import { blogEditorialImage } from "./editorial-images";
import { HAIKU_55_ARTICLE_ADMISSION_DRAFT } from "./haiku-5-5-intelligence-index-admission";
import {
  CLAUDE_HAIKU_55,
  HAIKU_55_ARTICLE_PUBLISHED_AT,
  HAIKU_55_ARTICLE_SLUG,
  createHaiku55Article,
  haiku55CodingAgentRows,
} from "./haiku-5-5-intelligence-index-article";
import { effortLabel, formatSharePercent } from "./opus-5-5-intelligence-index-article";

const INTERNAL_WORDS = ["admission", "admitted", "bounded", "custody", "gate", "lane", "manifest", "provenance", "receipt"];

function snapshots() {
  const codingParsed = parseCodingAgentSnapshot(codingAgentData);
  if (!codingParsed.ok) throw codingParsed.error;
  const intelligenceParsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!intelligenceParsed.ok) throw intelligenceParsed.error;
  return { codingSnapshot: codingParsed.value, intelligenceSnapshot: intelligenceParsed.value };
}

describe("Claude Haiku 5.5 Intelligence Index note", () => {
  test("places the max row from the same rows the chart plots", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const article = getBlogArticle(HAIKU_55_ARTICLE_SLUG);
    expect(article).toBeDefined();
    if (article === undefined) return;
    const markdown = articleToMarkdown(article);

    expect(article.publishedAt).toBe(HAIKU_55_ARTICLE_PUBLISHED_AT);
    expect(article.updatedAt >= article.publishedAt).toBeTrue();
    expect(article.section).toBe("AI model benchmarks");
    expect(article.sourceIds).toEqual([
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisClaudeHaiku55Model",
      "anthropicClaudeHaiku55",
      "artificialAnalysisCodingAgents",
    ]);
    for (const sourceId of article.sourceIds) {
      expect(markdown).toContain(BLOG_SOURCES[sourceId].url);
    }
    expect(article.nextStep?.links.map(link => link.href))
      .toEqual(["/#intelligence-index", "/models/anthropic/claude-haiku-5-5/index", "/coding"]);
    expect(article.relatedSlugs).toEqual([
      "opus-5-5-intelligence-index",
      "mimo-v2-6-pro-cost-frontier",
      "small-models-have-arrived",
    ]);
    expect(markdown).toContain(formatRetrievedAt(intelligenceSnapshot.source.retrievedAt));
    expect(markdown).toContain(formatRetrievedAt(codingSnapshot.source.retrievedAt));
    expect(markdown).toContain(intelligenceSnapshot.benchmark.version);
    for (const evaluation of intelligenceSnapshot.benchmark.evaluations) {
      expect(markdown).toContain(evaluation);
    }
    expect(markdown).toContain("aicharts did not run Claude Haiku 5.5");
    expect(markdown).toContain("Those are vendor numbers; none of them appears on an aicharts chart.");
    expect(markdown).toContain("names no default level, so this note places none");
    expect(markdown).toContain("The two numbers answer different questions and neither corrects the other.");
    expect(markdown).toContain("What this note does not say");

    // Every quotation is verbatim from the fetched primary pages.
    for (const quote of Object.values(CLAUDE_HAIKU_55.anthropic)) {
      expect(markdown).toContain(quote);
    }
    for (const quote of Object.values(CLAUDE_HAIKU_55.artificialAnalysis)) {
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
    expect(markdown).not.toContain("cheapest frontier");
    expect(markdown).not.toContain("less than");
    for (const word of INTERNAL_WORDS) {
      expect(markdown.toLowerCase()).not.toContain(word);
    }
    for (const line of markdown.split("\n")) {
      expect(line).not.toMatch(/^(#+ )?\d/u);
      expect(line).not.toMatch(/[.!?] \d/u);
    }
    expect(article.title).not.toMatch(/^What .* measures$/u);
    expect(article.title).not.toContain("leads the");
    expect(article.title).not.toContain("tops the");
    expect(article.title).not.toContain("pairs a");
    expect(article.title.length).toBeLessThanOrEqual(64);
    expect(article.dek.length).toBeLessThanOrEqual(200);
    expect(article.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(article.seoDescription.length).toBeLessThanOrEqual(160);

    const placement = haikuIntelligencePlacement(intelligenceSnapshot.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const { record } = placement;
    const score = formatSnapshotScore(record.intelligenceIndex);
    const cost = formatSnapshotCostUsd(comparableTaskCost(record));
    expect(record.effort?.slug).toBe("max");
    expect(article.title).toContain(score);
    expect(article.title).toContain(cost);
    expect(article.title).toBe(
      placement.onCostFrontier
        ? `Haiku 5.5 scores ${score} at ${cost}, on the cost frontier`
        : placement.dominators.length === 1
          ? `Haiku 5.5 scores ${score} at ${cost}, one row off the cost frontier`
          : `Haiku 5.5 scores ${score} at ${cost}, off the cost frontier`,
    );
    expect(article.dek).toContain(`${spellOrdinal(placement.rank)} of ${placement.cohortSize} configurations`);
    expect(markdown).toContain(`## Ranked ${spellOrdinal(placement.rank)} of ${placement.cohortSize}, `);
    expect(markdown).toContain(`## What the ${cost} pays for`);
    expect(markdown).toContain(`the row is ${spellOrdinal(placement.rank)} of ${placement.cohortSize}`);
    expect(markdown).toContain(`${placement.cheaperCount} cost less per task than the ${cost}`);
    expect(markdown).toContain(`the leader, ${placement.leader.name}, is `);

    // Frontier facts come from the placement, never from prose.
    if (placement.onCostFrontier) {
      expect(markdown).toContain("The row is on the chart’s cost frontier");
    } else {
      expect(markdown).toContain("The row is not on the chart’s cost frontier");
      for (const dominator of placement.dominators) {
        expect(markdown).toContain(dominator.name);
      }
      const [onlyDominator] = placement.dominators;
      if (onlyDominator !== undefined && placement.dominators.length === 1 && placement.cheapestHigher?.record.id === onlyDominator.id) {
        expect(markdown).toContain(`one row keeps it off: ${onlyDominator.name} scores`);
        expect(markdown).toContain("It is also the cheapest configuration that scores higher.");
        expect(article.dek).toContain("One cheaper row keeps the max row off the cost frontier");
      }
    }
    for (const level of placement.frontierLevels) {
      expect(markdown).toContain(`${level.record.name} at ${formatSnapshotScore(level.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(level.record))} per task`);
      if (level.above !== undefined) expect(markdown).toContain(`sits below ${level.above.name} at `);
      if (level.below !== undefined) expect(markdown).toContain(`the next vertex down, ${level.below.name} at `);
    }
    for (const neighbor of placement.neighbors) {
      expect(markdown).toContain(`${neighbor.name} at ${formatSnapshotScore(neighbor.intelligenceIndex)} for `);
    }
    for (const entry of placement.closestBelow) {
      expect(markdown).toContain(`| ${entry.record.name} | ${formatSnapshotScore(entry.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(entry.record))} | `);
      expect(markdown).toContain(`| ${formatFineCostMultiple(entry.costMultiple)} |`);
    }

    // The effort ladder and cost components are tabulated from the rows.
    expect(placement.effortLadder.length).toBeGreaterThanOrEqual(2);
    for (const step of placement.effortLadder) {
      const label = effortLabel(step.record);
      const breakdown = taskCostBreakdown(step.record);
      expect(markdown).toContain(`| ${label} | ${formatSnapshotScore(step.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(step.record))} | `);
      expect(markdown).toContain(`| ${formatSharePercent(reasoningShare(step.record))} | `);
      expect(markdown).toContain(`| ${label} | ${formatSnapshotCostUsd(breakdown.input)} | ${formatSnapshotCostUsd(breakdown.cacheRead)} | ${formatSnapshotCostUsd(breakdown.output)} | ${formatSnapshotCostUsd(breakdown.reasoning)} | ${formatSharePercent(inputCostShare(step.record))} |`);
      if (step.pointsOverCheaper !== null && step.costMultipleOverCheaper !== null) {
        expect(markdown).toContain(`| ${formatPointGap(step.pointsOverCheaper)} | ${formatFineCostMultiple(step.costMultipleOverCheaper)} |`);
      }
    }
    expect(markdown).toContain("Each step multiplies the cost per task by between ");

    // The family comparison derives from the Anthropic rows alone.
    for (const row of siblingFamilyRows(intelligenceSnapshot.records, record)) {
      expect(markdown).toContain(`| ${row.record.name} | ${formatSnapshotScore(row.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(row.record))} | ${formatPointGap(row.gapPoints)} | ${formatFineCostMultiple(row.costMultiple)} | ${row.onFamilyFrontier ? "yes" : "no"} |`);
    }
    for (const entry of familyRowsDominatedBy(intelligenceSnapshot.records, CLAUDE_HAIKU_55_RELEASE_SLUG)) {
      expect(markdown).toContain(`${entry.record.name} scores `);
      expect(markdown).toContain(`below ${entry.dominator.name} at ${formatFineCostMultiple(entry.costMultipleOfDominator)} its cost`);
    }
    const frontier = anthropicFrontier(intelligenceSnapshot.records);
    expect(markdown).toContain(`the vertices are ${frontier.slice(0, 2).map(vertex => vertex.name).join(", ")}`);
    const firstHaiku = frontier.findIndex(vertex => vertex.release.slug === CLAUDE_HAIKU_55_RELEASE_SLUG);
    if (firstHaiku > 0 && frontier.slice(firstHaiku).every(vertex => vertex.release.slug === CLAUDE_HAIKU_55_RELEASE_SLUG)) {
      expect(markdown).toContain(`Below ${frontier[firstHaiku - 1]?.name ?? ""} at `);
      expect(markdown).toContain("every vertex is a Claude Haiku 5.5 row");
    }

    // GPT-6 Luna is placed only from its own rows.
    const luna = releaseRowsAgainst(intelligenceSnapshot.records, GPT_6_LUNA_RELEASE_SLUG, record);
    const [lunaTop] = luna;
    if (lunaTop === undefined) {
      expect(markdown).toContain("has no comparable row in the snapshot");
    } else {
      expect(markdown).toContain(`from ${lunaTop.record.name} at ${formatSnapshotScore(lunaTop.record.intelligenceIndex)} for `);
      expect(markdown).toContain(`at ${formatFineCostMultiple(lunaTop.costMultiple)} its cost`);
    }

    // Coding-agent scores come only from stored Haiku rows.
    const haikuCodingRows = haiku55CodingAgentRows(codingSnapshot.records);
    if (haikuCodingRows.length === 0) {
      expect(markdown).toContain("## No Haiku row on the coding-agent chart yet");
      expect(markdown).toContain("no row runs Claude Haiku 5.5 in any harness, so this note has no coding-agent score for the model and does not estimate one");
      expect(markdown).toContain("The coding-agent chart stores no Claude Haiku 5.5 row");
      expect(markdown).not.toContain("| Coding agents (AA Index) |");
    } else {
      expect(markdown).toContain("## Claude Haiku 5.5 on the coding-agent chart");
      expect(markdown).toContain("scored on three coding benchmarks inside a harness rather than on the Intelligence Index");
      expect(markdown).toContain("| Configuration | Coding agents (AA Index) | Cost per task |");
      expect(markdown).not.toContain("No Haiku row on the coding-agent chart yet");
      for (const row of haikuCodingRows) {
        expect(markdown).toContain(row.seriesLabel);
        expect(markdown).toContain(formatSnapshotScore(row.benchmarks.aaIndex));
      }
    }

    // The slug is public, has a complete record, and stays off the curated homepage modules.
    expect(PUBLIC_BLOG_SLUGS as readonly string[]).toContain(HAIKU_55_ARTICLE_SLUG);
    expect(HOME_EDITORIAL_SLUGS as readonly string[]).not.toContain(HAIKU_55_ARTICLE_SLUG);
    expect(BLOG_ARTICLE_ADMISSIONS[HAIKU_55_ARTICLE_SLUG]).toBe(HAIKU_55_ARTICLE_ADMISSION_DRAFT);
    expect(blogEditorialImage(article.slug)?.slug).toBe(article.slug);
  });

  test("records the review the page shows", () => {
    const record = HAIKU_55_ARTICLE_ADMISSION_DRAFT;
    const total = Object.values(record.scores).reduce((sum, score) => sum + score, 0);
    expect(total).toBe(11);
    expect(Object.values(record.scores).every(score => score > 0)).toBeTrue();
    expect(record.lifecycleState).toBe("indexable");
    expect(record.reviewerType).toBe("ai");
    expect(record.reviewedBy).toBe("Claude Fable 5.1");
    expect(record.humanReviewedOn).toBeNull();
    expect(record.reviewedOn).toBe("2026-10-12");
    expect(record.sourceCheckedOn).toBe("2026-10-12");
    const reviewed = Date.parse(`${record.reviewedOn}T00:00:00.000Z`);
    const reassess = Date.parse(`${record.reassessOn}T00:00:00.000Z`);
    const days = (reassess - reviewed) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(56);
    expect(record.nearestUrls.map(entry => entry.url)).toEqual([
      "/blog/opus-5-5-intelligence-index",
      "/blog/sonnet-5-5-coding-agent-index",
      "/blog/mimo-v2-6-pro-cost-frontier",
      "/blog/small-models-have-arrived",
    ]);
    const article = getBlogArticle(HAIKU_55_ARTICLE_SLUG);
    expect(([...record.primarySourceIds] as string[]).toSorted()).toEqual([...(article?.sourceIds ?? [])].toSorted());
  });

  test("states the placement from the records it is given", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const placed = haikuIntelligencePlacement(intelligenceSnapshot.records);
    if (placed === undefined) throw new Error("Checked snapshot must store a Claude Haiku 5.5 max row.");

    const withoutHaiku = createHaiku55Article({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.release.slug !== CLAUDE_HAIKU_55_RELEASE_SLUG),
    }, codingSnapshot);
    const withoutHaikuMarkdown = articleToMarkdown(withoutHaiku);
    expect(withoutHaiku.title).toBe("Claude Haiku 5.5 on the Intelligence Index snapshot");
    expect(withoutHaiku.dek.length).toBeLessThanOrEqual(200);
    expect(withoutHaiku.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(withoutHaiku.seoDescription.length).toBeLessThanOrEqual(160);
    expect(withoutHaikuMarkdown).toContain("## Rank among comparable configurations");
    expect(withoutHaikuMarkdown).toContain("## What the cost per task pays for");
    expect(withoutHaikuMarkdown).toContain("cannot rank the model or place it against the cost frontier");
    expect(withoutHaikuMarkdown).toContain("cannot tabulate the model’s effort levels");
    expect(withoutHaikuMarkdown).toContain("cannot split the cost per task into its components");
    expect(withoutHaikuMarkdown).toContain("cannot measure the model against the other Anthropic rows");
    expect(withoutHaikuMarkdown).toContain("has no comparable row in the snapshot, so the chart cannot place the two side by side");
    expect(withoutHaikuMarkdown).not.toContain("| Effort level |");
    expect(withoutHaikuMarkdown).not.toContain("undefined");
    expect(withoutHaikuMarkdown).not.toContain("NaN");

    const maxOnly = createHaiku55Article({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => (
        record.release.slug !== CLAUDE_HAIKU_55_RELEASE_SLUG || record.slug === CLAUDE_HAIKU_55_INTELLIGENCE_SLUG
      )),
    }, codingSnapshot);
    const maxOnlyMarkdown = articleToMarkdown(maxOnly);
    expect(maxOnlyMarkdown).toContain("stores no other comparable Claude Haiku 5.5 effort level");
    expect(maxOnlyMarkdown).toContain("The Claude Haiku 5.5 rows differ only in effort level.");
    expect(maxOnlyMarkdown).not.toContain("| Effort level |");
    expect(maxOnlyMarkdown).not.toContain("lower effort level");
    expect(maxOnlyMarkdown).not.toContain("undefined");

    const withoutLuna = createHaiku55Article({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.release.slug !== GPT_6_LUNA_RELEASE_SLUG),
    }, codingSnapshot);
    expect(articleToMarkdown(withoutLuna)).toContain("has no comparable row in the snapshot, so the chart cannot place the two side by side");

    const withoutFamily = createHaiku55Article({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => (
        record.creator.slug !== "anthropic" || record.release.slug === CLAUDE_HAIKU_55_RELEASE_SLUG
      )),
    }, codingSnapshot);
    const withoutFamilyMarkdown = articleToMarkdown(withoutFamily);
    expect(withoutFamilyMarkdown).toContain("stores no comparable Claude Sonnet 5.5 or Claude Opus 5.5 row");
    expect(withoutFamilyMarkdown).toContain("No row from another Anthropic release is beaten on both score and cost by a Haiku row.");
    expect(withoutFamilyMarkdown).toContain("Every vertex is a Claude Haiku 5.5 row.");
    expect(withoutFamilyMarkdown).not.toContain("| On the Anthropic-only frontier |");

    const alone = createHaiku55Article({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.release.slug === CLAUDE_HAIKU_55_RELEASE_SLUG),
    }, codingSnapshot);
    const aloneMarkdown = articleToMarkdown(alone);
    expect(alone.title).toContain("on the cost frontier");
    expect(alone.title).not.toContain("off the cost frontier");
    expect(aloneMarkdown).toContain("No configuration scores higher.");
    expect(aloneMarkdown).toContain("The row is on the chart’s cost frontier");
    expect(aloneMarkdown).toContain("No other configuration scores within one index point of it.");
    expect(aloneMarkdown).toContain("is the top vertex");
    expect(aloneMarkdown).toContain("and is the lowest-cost vertex.");
    expect(aloneMarkdown).not.toContain("undefined");
    expect(aloneMarkdown).not.toContain("NaN");

    const [anthropicRow] = codingSnapshot.records.filter(record => record.providerId === "anthropic");
    if (anthropicRow === undefined) throw new Error("Checked coding snapshot must store an Anthropic row.");
    const withoutHaikuCoding = {
      ...codingSnapshot,
      records: codingSnapshot.records.filter(record => !record.model.includes("Haiku 5.5")),
    };
    const twin = {
      ...anthropicRow,
      id: "haiku-twin",
      model: "Claude Haiku 5.5",
      seriesId: "Claude Code:Claude Haiku 5.5",
      seriesLabel: "Claude Code · Haiku 5.5",
      setting: "max",
    };
    const withCodingRow = createHaiku55Article(intelligenceSnapshot, {
      ...withoutHaikuCoding,
      records: [...withoutHaikuCoding.records, twin],
    });
    const withCodingRowMarkdown = articleToMarkdown(withCodingRow);
    expect(haiku55CodingAgentRows([...withoutHaikuCoding.records, twin]).map(row => row.id)).toEqual(["haiku-twin"]);
    expect(withCodingRowMarkdown).toContain("## Claude Haiku 5.5 on the coding-agent chart");
    expect(withCodingRowMarkdown).toContain("stores one configuration that runs Claude Haiku 5.5");
    expect(withCodingRowMarkdown).toContain("| Configuration | Coding agents (AA Index) | Cost per task |");
    expect(withCodingRowMarkdown).toContain("scored on three coding benchmarks inside a harness rather than on the Intelligence Index");
    expect(withCodingRowMarkdown).not.toContain("No Haiku row on the coding-agent chart yet");
    expect(withCodingRowMarkdown).not.toContain("undefined");

    const laterRetrieval = createHaiku55Article({
      ...intelligenceSnapshot,
      source: { ...intelligenceSnapshot.source, retrievedAt: "2026-12-01T08:00:00.000Z" },
    }, codingSnapshot);
    expect(laterRetrieval.updatedAt).toBe("2026-12-01");
    expect(articleToMarkdown(laterRetrieval)).toContain("Dec 1, 2026, 8:00 AM UTC");

    const expensive = createHaiku55Article({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.slug === CLAUDE_HAIKU_55_INTELLIGENCE_SLUG && record.costUsdPerTask !== null
          ? { ...record, costUsdPerTask: { ...record.costUsdPerTask, total: 1_234_567_890.12 } }
          : record
      )),
    }, codingSnapshot);
    expect(expensive.title.length).toBeLessThanOrEqual(64);
    expect(expensive.title).toBe(`Claude Haiku 5.5 scores ${formatSnapshotScore(placed.record.intelligenceIndex)} on the Intelligence Index`);
    expect(expensive.dek.length).toBeLessThanOrEqual(200);
  });
});
