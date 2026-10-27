import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import { inputCostShare, reasoningShare, taskCostBreakdown } from "@/lib/claude-opus-5-5-placement";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { formatSnapshotCostUsd, formatSnapshotScore } from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import {
  KIMI_CREATOR_SLUG,
  KIMI_K3_1_PRO_INTELLIGENCE_SLUG,
  KIMI_K3_1_PRO_RELEASE_SLUG,
  kimiK31ProIntelligencePlacement,
} from "@/lib/kimi-k3-1-pro-placement";
import { comparableTaskCost, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import { costSideRows, creatorRowsAgainst } from "@/lib/muse-wonder-placement";
import { PUBLIC_BLOG_SLUGS } from "@/lib/public-analytics-routes";
import { formatFineCostMultiple, spellOrdinal } from "@/lib/snapshot-placement";

import { BLOG_ARTICLE_ADMISSIONS, HOME_EDITORIAL_SLUGS } from "./article-admissions";
import { BLOG_SOURCES, articleToMarkdown, getBlogArticle } from "./articles";
import { blogEditorialImage } from "./editorial-images";
import { KIMI_K3_1_PRO_ARTICLE_ADMISSION_DRAFT } from "./kimi-k3-1-pro-intelligence-index-admission";
import {
  KIMI_K3_1_PRO,
  KIMI_K3_1_PRO_ARTICLE_PUBLISHED_AT,
  KIMI_K3_1_PRO_ARTICLE_SLUG,
  createKimiK31ProArticle,
  kimiK31ProCodingAgentRows,
  moonshotCodingAgentRows,
} from "./kimi-k3-1-pro-intelligence-index-article";
import { formatSharePercent } from "./opus-5-5-intelligence-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

const INTERNAL_WORDS = ["admission", "admitted", "bounded", "custody", "gate", "lane", "manifest", "provenance", "receipt"];

function snapshots() {
  const codingParsed = parseCodingAgentSnapshot(codingAgentData);
  if (!codingParsed.ok) throw codingParsed.error;
  const intelligenceParsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!intelligenceParsed.ok) throw intelligenceParsed.error;
  return { codingSnapshot: codingParsed.value, intelligenceSnapshot: intelligenceParsed.value };
}

describe("Kimi K3.1 Pro Intelligence Index note", () => {
  test("places the row from the same rows the chart plots", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const article = getBlogArticle(KIMI_K3_1_PRO_ARTICLE_SLUG);
    expect(article).toBeDefined();
    if (article === undefined) return;
    const markdown = articleToMarkdown(article);

    expect(article.publishedAt).toBe(KIMI_K3_1_PRO_ARTICLE_PUBLISHED_AT);
    expect(article.updatedAt >= article.publishedAt).toBeTrue();
    expect(article.section).toBe("AI model benchmarks");
    expect(article.sourceIds).toEqual([
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisKimiK31ProModel",
      "moonshotKimiK31Pro",
      "kimiK31ProApiGuide",
      "openRouterKimiK31Pro",
      "artificialAnalysisCodingAgents",
    ]);
    for (const sourceId of article.sourceIds) {
      expect(markdown).toContain(BLOG_SOURCES[sourceId].url);
    }
    expect(article.nextStep?.links.map(link => link.href))
      .toEqual(["/#intelligence-index", "/models/kimi/kimi-k3-1-pro/index", "/coding"]);
    expect(article.relatedSlugs).toEqual([
      "muse-wonder-intelligence-index",
      "opus-5-5-intelligence-index",
      "mimo-v2-6-pro-cost-frontier",
    ]);
    expect(markdown).toContain(formatRetrievedAt(intelligenceSnapshot.source.retrievedAt));
    expect(markdown).toContain(formatRetrievedAt(codingSnapshot.source.retrievedAt));
    expect(markdown).toContain(intelligenceSnapshot.benchmark.version);
    for (const evaluation of intelligenceSnapshot.benchmark.evaluations) {
      expect(markdown).toContain(evaluation);
    }
    expect(markdown).toContain("aicharts did not run Kimi K3.1 Pro");
    expect(markdown).toContain("nothing on this site confirms or contradicts them");
    expect(markdown).toContain("a reader quoting either should name its cohort");
    expect(markdown).toContain("the release post’s promise does not move it");
    expect(markdown).not.toContain("would sit");
    expect(markdown).toContain("each competitor’s score is the higher of the figure in its own post and the official Terminal-Bench 4.0 leaderboard");
    expect(markdown).toContain("every sentence about the weights release are");
    expect(markdown).toContain("per million tokens**");

    // Every quotation is verbatim from the fetched primary pages.
    for (const quote of Object.values(KIMI_K3_1_PRO.moonshot)) {
      expect(markdown).toContain(quote);
    }
    for (const quote of Object.values(KIMI_K3_1_PRO.artificialAnalysis)) {
      expect(markdown).toContain(quote);
    }
    for (const quote of Object.values(KIMI_K3_1_PRO.openRouter)) {
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
    expect(markdown).not.toContain("less than");
    expect(markdown).not.toContain(" tie ");
    for (const word of INTERNAL_WORDS) {
      expect(markdown.toLowerCase()).not.toContain(word);
    }
    for (const line of markdown.split("\n")) {
      expect(line).not.toMatch(/^(#+ )?\d/u);
      expect(line).not.toMatch(/[.!?] \d/u);
    }
    expect(article.title).not.toMatch(/^What .* measures$/u);
    expect(article.title).not.toContain("leads the");
    expect(article.title).not.toContain("pairs a");
    expect(article.title).not.toContain("scores ");
    expect(article.title).not.toContain("with $");
    expect(article.title.length).toBeLessThanOrEqual(64);
    expect(article.dek.length).toBeLessThanOrEqual(200);
    expect(article.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(article.seoDescription.length).toBeLessThanOrEqual(160);

    const placement = kimiK31ProIntelligencePlacement(intelligenceSnapshot.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const { record } = placement;
    const score = formatSnapshotScore(record.intelligenceIndex);
    const cost = formatSnapshotCostUsd(comparableTaskCost(record));
    const breakdown = taskCostBreakdown(record);
    expect(record.effort).toBeNull();
    expect(record.creator.slug).toBe(KIMI_CREATOR_SLUG);
    expect(markdown).toContain(`## Inside the ${cost} per task`);
    expect(markdown).toContain(`**Where the ${cost} goes at `);
    expect(markdown).toContain(`puts the same row ${spellOrdinal(placement.rank)} of ${placement.cohortSize}`);
    expect(markdown).toContain(`${placement.cheaperCount} of the ${placement.cohortSize} cost less`);
    expect(article.dek).toContain(`${spellOrdinal(placement.rank)} of ${placement.cohortSize} and ${placement.onCostFrontier ? "on" : "off"} the cost frontier`);

    // The rows above and their creators come from the placement, never from prose.
    const [soleCreator] = placement.creatorsAbove;
    if (placement.creatorsAbove.length === 1 && soleCreator !== undefined) {
      expect(article.title).toBe(`Only ${soleCreator} rows outrank Kimi K3.1 Pro’s ${score} at ${cost} a task`);
      expect(article.seoDescription).toContain(`Only ${spellCount(placement.rowsAbove.length)} ${soleCreator} rows outrank it, at `);
      expect(markdown).toContain(`and all ${spellCount(placement.rowsAbove.length)} are ${soleCreator}’s.`);
      expect(markdown).toContain(`## The highest row from outside ${soleCreator}`);
      expect(markdown).toContain(`is the highest-scoring configuration from any creator other than ${soleCreator}`);
      expect(markdown).toContain(`## ${spellOrdinal(placement.rank).charAt(0).toUpperCase()}${spellOrdinal(placement.rank).slice(1)} of ${placement.cohortSize}, behind `);
    }
    for (const row of placement.rowsAbove) {
      expect(row.record.intelligenceIndex).toBeGreaterThan(record.intelligenceIndex);
      expect(markdown).toContain(`${row.record.name} at ${formatSnapshotScore(row.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(row.record))} per task`);
      if (placement.rowsAbove.length >= 2) {
        expect(markdown).toContain(`| ${row.record.name} | ${formatSnapshotScore(row.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(row.record))} | ${formatPointGap(row.gapPoints)} | ${formatFineCostMultiple(row.costMultiple)} |`);
      }
    }
    if (placement.cheapestHigher !== undefined) {
      expect(markdown).toContain(`The cheapest configuration that scores higher is ${placement.cheapestHigher.record.name}, at ${formatFineCostMultiple(placement.cheapestHigher.multiple)} the Kimi K3.1 Pro cost`);
      expect(markdown).not.toContain("its cost for");
    }

    // Frontier facts come from the placement.
    if (placement.onCostFrontier) {
      expect(markdown).toContain("The row is on the chart’s cost frontier");
      expect(placement.dominators).toEqual([]);
      if (placement.frontier.up !== undefined) {
        expect(markdown).toContain(`the vertex above it is ${placement.frontier.up.record.name} at `);
        expect(markdown).toContain(`for ${formatFineCostMultiple(placement.frontier.up.costMultiple)} the cost`);
      }
      if (placement.frontier.down !== undefined) {
        expect(markdown).toContain(`The vertex below it is ${placement.frontier.down.record.name} at `);
        expect(markdown).toContain(`pays ${formatFineCostMultiple(placement.frontier.down.costMultiple)} the Kimi K3.1 Pro cost`);
      }
    } else {
      expect(markdown).toContain("The row is off the chart’s cost frontier.");
      expect(placement.dominators.length).toBeGreaterThan(0);
      for (const dominator of placement.dominators) {
        expect(markdown).toContain(`${dominator.name} at ${formatSnapshotScore(dominator.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(dominator))} per task (${formatFineCostMultiple(comparableTaskCost(dominator) / comparableTaskCost(record))} the Kimi K3.1 Pro cost)`);
      }
    }
    for (const neighbor of placement.neighbors) {
      expect(markdown).toContain(`${neighbor.name} at ${formatSnapshotScore(neighbor.intelligenceIndex)} for `);
    }

    // The other-creator table lists one row per creator, none of them Kimi.
    expect(placement.otherCreatorBests.length).toBeGreaterThan(0);
    for (const row of placement.otherCreatorBests) {
      expect(row.record.creator.slug).not.toBe(KIMI_CREATOR_SLUG);
      expect(markdown).toContain(`| ${row.creatorName} | ${row.record.name} | ${formatSnapshotScore(row.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(row.record))} | ${formatPointGap(row.gapPoints)} | ${formatFineCostMultiple(row.costMultiple)} | ${row.creatorRowCount} |`);
    }
    expect(new Set(placement.otherCreatorBests.map(row => row.creatorName)).size).toBe(placement.otherCreatorBests.length);

    // The single row has no effort ladder to tabulate.
    expect(placement.effortLadder).toHaveLength(1);
    expect(placement.otherModes).toEqual([]);
    expect(markdown).toContain("so every figure below is that single row");
    expect(markdown).not.toContain("| Effort level |");

    // Cost components and their cohort ranks come from the breakdown.
    expect(markdown).toContain(`Input-side cost makes up ${formatSnapshotCostUsd(breakdown.input)} of the ${cost} per task, ${formatSharePercent(inputCostShare(record))} of the bill, and output the remaining ${formatSnapshotCostUsd(breakdown.output)}`);
    expect(markdown).toContain(`cache reads at ${formatSnapshotCostUsd(breakdown.cacheRead)}`);
    expect(markdown).toContain(`cache writes at ${formatSnapshotCostUsd(breakdown.cacheWrite)}`);
    expect(markdown).toContain(`are ${formatSharePercent(reasoningShare(record))} reasoning tokens`);
    expect(markdown).toContain(`the input side as a whole is the ${spellOrdinal(placement.partRanks.input.rank)}-largest and the output side the ${spellOrdinal(placement.partRanks.output.rank)}-largest`);
    const sides = costSideRows(record, placement.rowsAbove.map(row => row.record));
    for (const row of sides) {
      expect(markdown).toContain(`| ${row.record.name} | ${formatSnapshotScore(row.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(row.record))} | ${formatSnapshotCostUsd(row.inputCost)} | ${formatSnapshotCostUsd(row.outputCost)} | ${formatSharePercent(row.inputShare)} | ${formatFineCostMultiple(row.costMultiple)} |`);
    }
    if (sides.length > 0) {
      expect(markdown).toContain(`| ${record.name} | ${score} | ${cost} | ${formatSnapshotCostUsd(breakdown.input)} | ${formatSnapshotCostUsd(breakdown.output)} | ${formatSharePercent(inputCostShare(record))} | 1.0x |`);
    }

    // The weights paragraph states the chart's flag, never the vendor's claim as a chart fact.
    expect(placement.weights.open).toBe(record.weights?.open);
    if (placement.weights.open === false) {
      expect(markdown).toContain(`flags the ${record.name} row as closed`);
      expect(markdown).toContain("## Closed on the chart, with weights promised");
    }
    expect(markdown).toContain(`${placement.weights.openCount} are flagged open, ${placement.weights.closedCount} closed`);
    if (placement.weights.highestOpen !== undefined && placement.weights.open !== true) {
      expect(placement.weights.highestOpen.record.weights?.open).toBeTrue();
      expect(markdown).toContain(`The highest-scoring open-weights row is ${placement.weights.highestOpen.record.name} at `);
    }
    const family = creatorRowsAgainst(intelligenceSnapshot.records, record, KIMI_CREATOR_SLUG);
    for (const row of family) {
      expect(row.record.creator.slug).toBe(KIMI_CREATOR_SLUG);
      expect(markdown).toContain(`${row.record.name} at ${formatSnapshotScore(row.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(row.record))} per task`);
    }
    if (placement.siblings.length === 0) {
      expect(markdown).toContain("nor a Kimi K3.1 Pro Highspeed row");
    }

    // Coding-agent scores come only from stored Kimi K3.1 Pro rows.
    const kimiCodingRows = kimiK31ProCodingAgentRows(codingSnapshot.records);
    const moonshotRows = moonshotCodingAgentRows(codingSnapshot.records);
    if (kimiCodingRows.length === 0) {
      expect(markdown).toContain("no row runs Kimi K3.1 Pro in any harness, so this note has no coding-agent score for the model and does not estimate one");
      expect(markdown).toContain("No row on the coding-agent chart runs Kimi K3.1 Pro yet.");
      expect(markdown).not.toContain("| Coding agents (AA Index) |");
      for (const row of moonshotRows) {
        expect(markdown).toContain(`${row.seriesLabel} (${row.setting}) at ${formatSnapshotScore(row.benchmarks.aaIndex)} on AA Index`);
      }
    } else {
      expect(markdown).toContain("| Configuration | Coding agents (AA Index) | Cost per task |");
      expect(markdown).toContain("scored on three coding benchmarks inside a harness rather than on the Intelligence Index");
      for (const row of kimiCodingRows) {
        expect(markdown).toContain(row.seriesLabel);
        expect(markdown).toContain(formatSnapshotScore(row.benchmarks.aaIndex));
      }
    }

    // The slug is public, has a complete record, and stays off the curated homepage modules.
    expect(PUBLIC_BLOG_SLUGS as readonly string[]).toContain(KIMI_K3_1_PRO_ARTICLE_SLUG);
    expect(HOME_EDITORIAL_SLUGS as readonly string[]).not.toContain(KIMI_K3_1_PRO_ARTICLE_SLUG);
    expect(BLOG_ARTICLE_ADMISSIONS[KIMI_K3_1_PRO_ARTICLE_SLUG]).toBe(KIMI_K3_1_PRO_ARTICLE_ADMISSION_DRAFT);
    expect(blogEditorialImage(article.slug)?.slug).toBe(article.slug);
  });

  test("records the review the page shows", () => {
    const record = KIMI_K3_1_PRO_ARTICLE_ADMISSION_DRAFT;
    const total = Object.values(record.scores).reduce((sum, score) => sum + score, 0);
    expect(total).toBe(11);
    expect(Object.values(record.scores).every(score => score > 0)).toBeTrue();
    expect(record.lifecycleState).toBe("indexable");
    expect(record.reviewerType).toBe("ai");
    expect(record.reviewedBy).toBe("Claude Fable 5.1");
    expect(record.humanReviewedOn).toBeNull();
    expect(record.reviewedOn).toBe("2026-10-27");
    expect(record.sourceCheckedOn).toBe("2026-10-27");
    expect(record.sourceCheckedOn <= record.reviewedOn).toBeTrue();
    const reviewed = Date.parse(`${record.reviewedOn}T00:00:00.000Z`);
    const reassess = Date.parse(`${record.reassessOn}T00:00:00.000Z`);
    const days = (reassess - reviewed) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(56);
    expect(record.nearestUrls.map(entry => entry.url)).toEqual([
      "/blog/muse-wonder-intelligence-index",
      "/blog/opus-5-5-intelligence-index",
      "/blog/mimo-v2-6-pro-cost-frontier",
    ]);
    const article = getBlogArticle(KIMI_K3_1_PRO_ARTICLE_SLUG);
    expect(([...record.primarySourceIds] as string[]).toSorted()).toEqual([...(article?.sourceIds ?? [])].toSorted());
  });

  test("states the placement from the records it is given", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const placed = kimiK31ProIntelligencePlacement(intelligenceSnapshot.records);
    if (placed === undefined) throw new Error("Checked snapshot must store a Kimi K3.1 Pro row.");

    const withoutKimi = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.release.slug !== KIMI_K3_1_PRO_RELEASE_SLUG),
    }, codingSnapshot);
    const withoutKimiMarkdown = articleToMarkdown(withoutKimi);
    expect(withoutKimi.title).toBe("Kimi K3.1 Pro on the Intelligence Index snapshot");
    expect(withoutKimi.dek.length).toBeLessThanOrEqual(200);
    expect(withoutKimi.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(withoutKimi.seoDescription.length).toBeLessThanOrEqual(160);
    expect(withoutKimiMarkdown).toContain("## Rank among comparable configurations");
    expect(withoutKimiMarkdown).toContain("## The best row of each other creator");
    expect(withoutKimiMarkdown).toContain("## Inside the cost per task");
    expect(withoutKimiMarkdown).toContain("cannot rank the model or place it against the cost frontier");
    expect(withoutKimiMarkdown).toContain("cannot set the model against the best row of each other creator");
    expect(withoutKimiMarkdown).toContain("cannot split the cost per task into its components");
    expect(withoutKimiMarkdown).toContain("cannot say how the chart flags the row");
    expect(withoutKimiMarkdown).toContain("stores no Kimi K3.1 Pro row to describe");
    expect(withoutKimiMarkdown).not.toContain("| Input-side cost |");
    expect(withoutKimiMarkdown).not.toContain("undefined");
    expect(withoutKimiMarkdown).not.toContain("NaN");

    const alone = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.release.slug === KIMI_K3_1_PRO_RELEASE_SLUG),
    }, codingSnapshot);
    const aloneMarkdown = articleToMarkdown(alone);
    expect(alone.title).toBe(`Kimi K3.1 Pro tops the Intelligence Index at ${formatSnapshotScore(placed.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(placed.record))}`);
    expect(alone.dek).toContain("first of 1 and on the cost frontier.");
    expect(aloneMarkdown).toContain("## First of 1, with no row above it");
    expect(aloneMarkdown).toContain("No configuration scores higher.");
    expect(aloneMarkdown).toContain("No frontier vertex sits above it.");
    expect(aloneMarkdown).toContain("No frontier vertex sits below it, so it is the cheapest configuration on the frontier.");
    expect(aloneMarkdown).toContain("no comparable configuration costs less, and none costs more");
    expect(aloneMarkdown).toContain("No other configuration scores within one index point of it.");
    expect(aloneMarkdown).toContain("so there is no other creator to set the row against");
    expect(aloneMarkdown).toContain("is the only Kimi row on the chart with a measured cost per task");
    expect(aloneMarkdown).toContain("No comparable configuration is flagged open.");
    expect(aloneMarkdown).not.toContain("| Input-side cost |");
    expect(aloneMarkdown).not.toContain("undefined");
    expect(aloneMarkdown).not.toContain("NaN");

    const [topAbove] = placed.rowsAbove;
    if (topAbove === undefined) throw new Error("Checked snapshot must rank a row above Kimi K3.1 Pro.");
    const mixedCreators = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.id === topAbove.record.id ? { ...record, creator: { id: "other", name: "Other Lab", slug: "other" } } : record
      )),
    }, codingSnapshot);
    const mixedMarkdown = articleToMarkdown(mixedCreators);
    expect(mixedCreators.title).toBe(`Kimi K3.1 Pro ranks ${spellOrdinal(placed.rank)} of ${placed.cohortSize} at ${formatSnapshotScore(placed.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(placed.record))} a task`);
    expect(mixedMarkdown).toContain("## The best row of each other creator");
    expect(mixedMarkdown).toContain("score higher than Kimi K3.1 Pro, from Other Lab and ");
    expect(mixedMarkdown).toContain("| Other Lab | ");
    expect(mixedMarkdown).not.toContain("highest-scoring configuration from any creator other than");

    const dominated = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.id === topAbove.record.id && record.costUsdPerTask !== null
          ? { ...record, costUsdPerTask: { ...record.costUsdPerTask, total: comparableTaskCost(placed.record) / 2 } }
          : record
      )),
    }, codingSnapshot);
    const dominatedMarkdown = articleToMarkdown(dominated);
    expect(dominated.dek).toContain("off the cost frontier");
    expect(dominatedMarkdown).toContain("The row is off the chart’s cost frontier.");
    expect(dominatedMarkdown).toContain(`${topAbove.record.name} at ${formatSnapshotScore(topAbove.record.intelligenceIndex)} for `);
    expect(dominatedMarkdown).not.toContain("the vertex above it is");

    const openFlag = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.slug === KIMI_K3_1_PRO_INTELLIGENCE_SLUG ? { ...record, weights: { license: null, open: true, sourceUrl: null } } : record
      )),
    }, codingSnapshot);
    const openMarkdown = articleToMarkdown(openFlag);
    expect(openMarkdown).toContain("flags the Kimi K3.1 Pro row as open weights");
    expect(openMarkdown).not.toContain("The highest-scoring open-weights row is");

    const noFlag = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.slug === KIMI_K3_1_PRO_INTELLIGENCE_SLUG ? { ...record, weights: undefined } : record
      )),
    }, codingSnapshot);
    expect(articleToMarkdown(noFlag)).toContain("carries no weights flag for the Kimi K3.1 Pro row");
    expect(articleToMarkdown(noFlag)).toContain("1 carries no flag");

    const [moonshotRow] = moonshotCodingAgentRows(codingSnapshot.records);
    if (moonshotRow === undefined) throw new Error("Checked coding snapshot must store a Moonshot AI row.");
    const twin = {
      ...moonshotRow,
      id: "kimi-twin",
      model: "Kimi K3.1 Pro",
      seriesId: "Kimi Code CLI:Kimi K3.1 Pro",
      seriesLabel: "Kimi Code CLI · Kimi K3.1 Pro",
      setting: "max",
    };
    const withCodingRow = createKimiK31ProArticle(intelligenceSnapshot, {
      ...codingSnapshot,
      records: [...codingSnapshot.records.filter(record => !record.model.includes("Kimi K3.1 Pro")), twin],
    });
    const withCodingRowMarkdown = articleToMarkdown(withCodingRow);
    expect(kimiK31ProCodingAgentRows([...codingSnapshot.records, twin]).map(row => row.id)).toEqual(["kimi-twin"]);
    expect(withCodingRowMarkdown).toContain("stores one configuration that runs Kimi K3.1 Pro");
    expect(withCodingRowMarkdown).toContain("| Configuration | Coding agents (AA Index) | Cost per task |");
    expect(withCodingRowMarkdown).toContain("The coding-agent chart stores one configuration running Kimi K3.1 Pro");
    expect(withCodingRowMarkdown).not.toContain("undefined");

    const withoutMoonshot = createKimiK31ProArticle(intelligenceSnapshot, {
      ...codingSnapshot,
      records: codingSnapshot.records.filter(record => record.providerId !== "moonshot_ai"),
    });
    expect(articleToMarkdown(withoutMoonshot)).toContain("The snapshot stores no Moonshot AI row at all.");

    const laterRetrieval = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      source: { ...intelligenceSnapshot.source, retrievedAt: "2026-12-01T08:00:00.000Z" },
    }, codingSnapshot);
    expect(laterRetrieval.updatedAt).toBe("2026-12-01");
    expect(articleToMarkdown(laterRetrieval)).toContain("Dec 1, 2026, 8:00 AM UTC");

    const expensive = createKimiK31ProArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.slug === KIMI_K3_1_PRO_INTELLIGENCE_SLUG && record.costUsdPerTask !== null
          ? { ...record, costUsdPerTask: { ...record.costUsdPerTask, total: 1_234_567_890.12, input: 1_234_567_000, cacheRead: 1_234_567_000 } }
          : record
      )),
    }, codingSnapshot);
    expect(expensive.title.length).toBeLessThanOrEqual(64);
    expect(expensive.title).toBe(`Kimi K3.1 Pro ranks ${spellOrdinal(placed.rank)} of ${placed.cohortSize} on the Intelligence Index`);
    expect(expensive.dek.length).toBeLessThanOrEqual(200);
  });
});
