import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import { inputCostShare, reasoningShare, taskCostBreakdown } from "@/lib/claude-opus-5-5-placement";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { formatSnapshotCostUsd, formatSnapshotScore } from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import { comparableIntelligenceRecords } from "@/lib/intelligence-efficiency";
import { comparableTaskCost, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import {
  META_CREATOR_SLUG,
  MUSE_WONDER_INTELLIGENCE_SLUG,
  MUSE_WONDER_RELEASE_SLUG,
  MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS,
  costSideRows,
  creatorFrontier,
  creatorRowsAgainst,
  museWonderIntelligencePlacement,
  vendorComparisonRows,
} from "@/lib/muse-wonder-placement";
import { PUBLIC_BLOG_SLUGS } from "@/lib/public-analytics-routes";
import { formatFineCostMultiple, spellOrdinal } from "@/lib/snapshot-placement";

import { BLOG_ARTICLE_ADMISSIONS, HOME_EDITORIAL_SLUGS } from "./article-admissions";
import { BLOG_SOURCES, articleToMarkdown, getBlogArticle } from "./articles";
import { blogEditorialImage } from "./editorial-images";
import { MUSE_WONDER_ARTICLE_ADMISSION_DRAFT } from "./muse-wonder-intelligence-index-admission";
import {
  MUSE_WONDER,
  MUSE_WONDER_ARTICLE_PUBLISHED_AT,
  MUSE_WONDER_ARTICLE_SLUG,
  createMuseWonderArticle,
  museWonderCodingAgentRows,
} from "./muse-wonder-intelligence-index-article";
import { formatSharePercent } from "./opus-5-5-intelligence-index-article";

const INTERNAL_WORDS = ["admission", "admitted", "bounded", "custody", "gate", "lane", "manifest", "provenance", "receipt"];

function snapshots() {
  const codingParsed = parseCodingAgentSnapshot(codingAgentData);
  if (!codingParsed.ok) throw codingParsed.error;
  const intelligenceParsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!intelligenceParsed.ok) throw intelligenceParsed.error;
  return { codingSnapshot: codingParsed.value, intelligenceSnapshot: intelligenceParsed.value };
}

describe("Muse Wonder Intelligence Index note", () => {
  test("places the row from the same rows the chart plots", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const article = getBlogArticle(MUSE_WONDER_ARTICLE_SLUG);
    expect(article).toBeDefined();
    if (article === undefined) return;
    const markdown = articleToMarkdown(article);

    expect(article.publishedAt).toBe(MUSE_WONDER_ARTICLE_PUBLISHED_AT);
    expect(article.updatedAt >= article.publishedAt).toBeTrue();
    expect(article.section).toBe("AI model benchmarks");
    expect(article.sourceIds).toEqual([
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisMuseWonderModel",
      "metaMuseWonder",
      "metaMuseWonderModel",
      "artificialAnalysisCodingAgents",
    ]);
    for (const sourceId of article.sourceIds) {
      expect(markdown).toContain(BLOG_SOURCES[sourceId].url);
    }
    expect(article.nextStep?.links.map(link => link.href))
      .toEqual(["/#intelligence-index", "/models/meta/muse-wonder/index", "/coding"]);
    expect(article.relatedSlugs).toEqual([
      "opus-5-5-intelligence-index",
      "haiku-5-5-intelligence-index",
      "mimo-v2-6-pro-cost-frontier",
    ]);
    expect(markdown).toContain(formatRetrievedAt(intelligenceSnapshot.source.retrievedAt));
    expect(markdown).toContain(formatRetrievedAt(codingSnapshot.source.retrievedAt));
    expect(markdown).toContain(intelligenceSnapshot.benchmark.version);
    for (const evaluation of intelligenceSnapshot.benchmark.evaluations) {
      expect(markdown).toContain(evaluation);
    }
    expect(markdown).toContain("aicharts did not run Muse Wonder");
    expect(markdown).toContain("reports vendor-selected runs that this site does not chart");
    expect(markdown).toContain("a reader should quote the rank with its cohort");
    expect(markdown).toContain("Muse Wonder Full is on no chart here");
    expect(markdown).toContain("is not derived here from a list price");

    // Every quotation is verbatim from the fetched primary pages.
    for (const quote of Object.values(MUSE_WONDER.meta)) {
      expect(markdown).toContain(quote);
    }
    for (const quote of Object.values(MUSE_WONDER.artificialAnalysis)) {
      expect(markdown).toContain(quote);
    }

    expect(markdown).not.toContain("—");
    expect(markdown).not.toContain("refresh");
    expect(markdown).not.toContain("schema");
    expect(markdown).not.toContain("`");
    expect(markdown).not.toContain("This note answers");
    expect(markdown).not.toContain("checked snapshot");
    expect(markdown).not.toContain("0.0 points");
    expect(markdown).not.toContain("0.00 points");
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
    expect(article.title).not.toContain("tops the");
    expect(article.title).not.toContain("pairs a");
    expect(article.title).not.toContain("scores ");
    expect(article.title.length).toBeLessThanOrEqual(64);
    expect(article.dek.length).toBeLessThanOrEqual(200);
    expect(article.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(article.seoDescription.length).toBeLessThanOrEqual(160);

    const placement = museWonderIntelligencePlacement(intelligenceSnapshot.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const { record } = placement;
    const score = formatSnapshotScore(record.intelligenceIndex);
    const cost = formatSnapshotCostUsd(comparableTaskCost(record));
    const breakdown = taskCostBreakdown(record);
    expect(record.effort?.slug).toBe("max");
    expect(record.creator.slug).toBe(META_CREATOR_SLUG);
    expect(article.title).toBe(`Muse Wonder: ${score} at ${cost}, with ${formatSnapshotCostUsd(breakdown.input)} of it on the input side`);
    expect(article.dek).toContain(`${spellOrdinal(placement.rank)} of ${placement.cohortSize} configurations`);
    expect(article.dek).toContain(`Input-side cost is ${formatSharePercent(inputCostShare(record))} of the bill.`);
    expect(markdown).toContain(`## Ranked ${spellOrdinal(placement.rank)} of ${placement.cohortSize}, ${placement.onCostFrontier ? "on" : "off"} the cost frontier`);
    expect(markdown).toContain(`## Where the ${cost} goes`);
    expect(markdown).toContain(`puts the same row ${spellOrdinal(placement.rank)} of ${placement.cohortSize} on the index`);
    expect(markdown).toContain(`${placement.cheaperCount} of the ${placement.cohortSize} cost less per task`);
    expect(markdown).toContain(`The leader, ${placement.leader.name}, scores `);

    // Frontier facts come from the placement, never from prose.
    if (placement.onCostFrontier) {
      expect(markdown).toContain("The row is on the chart’s cost frontier");
      expect(placement.dominators).toEqual([]);
    } else {
      expect(markdown).toContain("The row is off the chart’s cost frontier.");
      expect(placement.dominators.length).toBeGreaterThan(0);
      for (const dominator of placement.dominators) {
        expect(markdown).toContain(`${dominator.name} at ${formatSnapshotScore(dominator.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(dominator))} per task (${formatFineCostMultiple(comparableTaskCost(dominator) / comparableTaskCost(record))} the Muse Wonder cost)`);
      }
    }
    for (const neighbor of placement.neighbors) {
      expect(markdown).toContain(`${neighbor.name} at ${formatSnapshotScore(neighbor.intelligenceIndex)} for `);
    }
    for (const row of placement.sameRoundedScore) {
      expect(formatSnapshotScore(row.record.intelligenceIndex)).toBe(score);
      expect(row.record.intelligenceIndex).not.toBe(record.intelligenceIndex);
      expect(markdown).toContain(`at one decimal ${row.record.name} shows the same ${score}`);
      expect(markdown).toContain(`${formatFineCostMultiple(row.costMultiple)} the Muse Wonder cost, for a score that prints the same`);
    }
    for (const entry of placement.closestBelow) {
      expect(markdown).toContain(`| ${entry.record.name} | ${formatSnapshotScore(entry.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(entry.record))} | `);
      expect(markdown).toContain(`| ${formatFineCostMultiple(entry.costMultiple)} |`);
    }

    // The single row has no effort ladder to tabulate.
    expect(placement.effortLadder).toHaveLength(1);
    expect(placement.otherModes).toEqual([]);
    expect(markdown).toContain("there is no effort ladder to tabulate");
    expect(markdown).not.toContain("| Effort level |");

    // Cost components and their cohort ranks come from the breakdown.
    expect(markdown).toContain(`${formatSnapshotCostUsd(breakdown.input)} is input-side cost and ${formatSnapshotCostUsd(breakdown.output)} is output`);
    expect(markdown).toContain(`cache writes at ${formatSnapshotCostUsd(breakdown.cacheWrite)}`);
    expect(markdown).toContain(`cache reads at ${formatSnapshotCostUsd(breakdown.cacheRead)}`);
    expect(markdown).toContain(`Input-side cost is ${formatSharePercent(inputCostShare(record))} of the total.`);
    expect(markdown).toContain(`${formatSharePercent(reasoningShare(record))} of them reasoning tokens`);
    if (placement.partRanks.cacheWrite.rank === 1) {
      expect(markdown).toContain("no row on the chart pays more for that line");
      expect(markdown).toContain("the row’s cache-write line is the largest of any row on the chart");
      expect(placement.partRanks.cacheWrite.atLeastAsLarge.map(row => row.id)).toEqual([record.id]);
    }
    expect(markdown).toContain(`Its input-side bill is the ${spellOrdinal(placement.partRanks.input.rank)}-largest and its output-side bill the ${spellOrdinal(placement.partRanks.output.rank)}-largest`);
    const above = comparableIntelligenceRecords(intelligenceSnapshot.records).filter(candidate => candidate.intelligenceIndex > record.intelligenceIndex);
    expect(above).toHaveLength(placement.rank - 1);
    if (above.every(candidate => inputCostShare(candidate) < inputCostShare(record))) {
      expect(markdown).toContain("Every configuration ranked above it spends a smaller share of its bill on input");
      expect(markdown).toContain(`is ${formatSharePercent(Math.max(...above.map(inputCostShare)))}.`);
    }
    const sides = costSideRows(record, [...placement.dominators, ...placement.sameRoundedScore.map(row => row.record)]);
    for (const row of sides) {
      expect(markdown).toContain(`| ${row.record.name} | ${formatSnapshotScore(row.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(row.record))} | ${formatSnapshotCostUsd(row.inputCost)} | ${formatSnapshotCostUsd(row.cacheWriteCost)} | ${formatSnapshotCostUsd(row.outputCost)} | ${formatSharePercent(row.inputShare)} | ${formatFineCostMultiple(row.costMultiple)} |`);
    }
    expect(markdown).toContain(`| ${record.name} | ${score} | ${cost} | ${formatSnapshotCostUsd(breakdown.input)} | ${formatSnapshotCostUsd(breakdown.cacheWrite)} | ${formatSnapshotCostUsd(breakdown.output)} | ${formatSharePercent(inputCostShare(record))} | 1.0x |`);
    const outputHeavier = sides.filter(row => row.outputCost > breakdown.output);
    for (const row of outputHeavier) {
      expect(markdown).toContain(`${formatSnapshotCostUsd(row.inputCost)} against ${formatSnapshotCostUsd(breakdown.input)} for ${row.record.name}`);
    }

    // The family comparison derives from the Meta rows alone.
    const family = creatorRowsAgainst(intelligenceSnapshot.records, record);
    expect(family.length).toBeGreaterThan(0);
    for (const row of family) {
      expect(row.record.creator.slug).toBe(META_CREATOR_SLUG);
      expect(markdown).toContain(`| ${row.record.name} | ${formatSnapshotScore(row.record.intelligenceIndex)} | ${formatSnapshotCostUsd(comparableTaskCost(row.record))} | ${formatPointGap(row.gapPoints)} | ${formatFineCostMultiple(row.costMultiple)} | ${row.onFamilyFrontier ? "yes" : "no"} |`);
    }
    const frontier = creatorFrontier(intelligenceSnapshot.records);
    expect(markdown).toContain(`the vertices are ${frontier.slice(0, 2).map(vertex => vertex.name).join(", ")}`);
    if (frontier[0]?.id === record.id && frontier[1] !== undefined) {
      expect(markdown).toContain(`${record.name} is the top vertex, and the step up to it from ${frontier[1].name} at `);
    }

    // Meta's Intelligence Index row is checked against the chart rows for the API models.
    const vendor = vendorComparisonRows(intelligenceSnapshot.records, MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS);
    expect(vendor.every(row => row.record !== undefined)).toBeTrue();
    for (const row of vendor) {
      if (row.record === undefined) continue;
      expect(row.record.effort?.slug).toBe("max");
      expect(markdown).toContain(`${row.record.name} at ${formatSnapshotScore(row.record.intelligenceIndex)}`);
    }
    expect(String(Math.round(record.intelligenceIndex))).toBe(MUSE_WONDER.meta.indexWonder);
    expect(markdown).toContain("Each rounds to the whole number in Meta’s row, so on the Intelligence Index line Meta’s table and this chart agree.");

    // No coding-agent score is invented.
    expect(museWonderCodingAgentRows(codingSnapshot.records)).toEqual([]);
    expect(markdown).toContain("## No Muse Wonder row on the coding-agent chart");
    expect(markdown).toContain("no row runs Muse Wonder in any harness, so this note has no coding-agent score for the model and does not estimate one");
    expect(markdown).toContain("The coding-agent chart stores no Muse Wonder row");
    expect(markdown).toContain("Muse Code · Muse Spark 1.3 (max) at ");
    expect(markdown).not.toContain("| Coding agents (AA Index) |");

    // The slug is public, has a complete record, and stays off the curated homepage modules.
    expect(PUBLIC_BLOG_SLUGS as readonly string[]).toContain(MUSE_WONDER_ARTICLE_SLUG);
    expect(HOME_EDITORIAL_SLUGS as readonly string[]).not.toContain(MUSE_WONDER_ARTICLE_SLUG);
    expect(BLOG_ARTICLE_ADMISSIONS[MUSE_WONDER_ARTICLE_SLUG]).toBe(MUSE_WONDER_ARTICLE_ADMISSION_DRAFT);
    expect(blogEditorialImage(article.slug)?.slug).toBe(article.slug);
  });

  test("records the review the page shows", () => {
    const record = MUSE_WONDER_ARTICLE_ADMISSION_DRAFT;
    const total = Object.values(record.scores).reduce((sum, score) => sum + score, 0);
    expect(total).toBe(11);
    expect(Object.values(record.scores).every(score => score > 0)).toBeTrue();
    expect(record.lifecycleState).toBe("indexable");
    expect(record.reviewerType).toBe("ai");
    expect(record.reviewedBy).toBe("Claude Fable 5.1");
    expect(record.humanReviewedOn).toBeNull();
    expect(record.reviewedOn).toBe("2026-10-21");
    expect(record.sourceCheckedOn).toBe("2026-10-21");
    expect(record.sourceCheckedOn <= record.reviewedOn).toBeTrue();
    const reviewed = Date.parse(`${record.reviewedOn}T00:00:00.000Z`);
    const reassess = Date.parse(`${record.reassessOn}T00:00:00.000Z`);
    const days = (reassess - reviewed) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(56);
    expect(record.nearestUrls.map(entry => entry.url)).toEqual([
      "/blog/opus-5-5-intelligence-index",
      "/blog/haiku-5-5-intelligence-index",
      "/blog/mimo-v2-6-pro-cost-frontier",
    ]);
    const article = getBlogArticle(MUSE_WONDER_ARTICLE_SLUG);
    expect(([...record.primarySourceIds] as string[]).toSorted()).toEqual([...(article?.sourceIds ?? [])].toSorted());
  });

  test("states the placement from the records it is given", () => {
    const { codingSnapshot, intelligenceSnapshot } = snapshots();
    const placed = museWonderIntelligencePlacement(intelligenceSnapshot.records);
    if (placed === undefined) throw new Error("Checked snapshot must store a Muse Wonder row.");

    const withoutWonder = createMuseWonderArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.release.slug !== MUSE_WONDER_RELEASE_SLUG),
    }, codingSnapshot);
    const withoutWonderMarkdown = articleToMarkdown(withoutWonder);
    expect(withoutWonder.title).toBe("Muse Wonder on the Intelligence Index snapshot");
    expect(withoutWonder.dek.length).toBeLessThanOrEqual(200);
    expect(withoutWonder.seoDescription.length).toBeGreaterThanOrEqual(110);
    expect(withoutWonder.seoDescription.length).toBeLessThanOrEqual(160);
    expect(withoutWonderMarkdown).toContain("## Rank among comparable configurations");
    expect(withoutWonderMarkdown).toContain("## Where the cost per task goes");
    expect(withoutWonderMarkdown).toContain("cannot rank the model or place it against the cost frontier");
    expect(withoutWonderMarkdown).toContain("cannot split the cost per task into its components");
    expect(withoutWonderMarkdown).toContain("cannot measure the model against the other Meta rows");
    expect(withoutWonderMarkdown).toContain("The chart cannot check those figures without the corresponding rows.");
    expect(withoutWonderMarkdown).toContain("stores no Muse Wonder row to describe");
    expect(withoutWonderMarkdown).not.toContain("| Input-side cost |");
    expect(withoutWonderMarkdown).not.toContain("undefined");
    expect(withoutWonderMarkdown).not.toContain("NaN");

    const withoutFamily = createMuseWonderArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => (
        record.creator.slug !== META_CREATOR_SLUG || record.release.slug === MUSE_WONDER_RELEASE_SLUG
      )),
    }, codingSnapshot);
    const withoutFamilyMarkdown = articleToMarkdown(withoutFamily);
    expect(withoutFamilyMarkdown).toContain("is the only Meta row on the chart and there is no Meta-only frontier to draw");
    expect(withoutFamilyMarkdown).not.toContain("| On the Meta-only frontier |");

    const alone = createMuseWonderArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => record.release.slug === MUSE_WONDER_RELEASE_SLUG),
    }, codingSnapshot);
    const aloneMarkdown = articleToMarkdown(alone);
    expect(alone.dek).toContain("The row is on the cost frontier.");
    expect(aloneMarkdown).toContain("## Ranked first of 1, on the cost frontier");
    expect(aloneMarkdown).toContain("No configuration scores higher.");
    expect(aloneMarkdown).toContain("The row is on the chart’s cost frontier");
    expect(aloneMarkdown).toContain("no comparable configuration costs less per task, and none costs more");
    expect(aloneMarkdown).toContain("No other configuration scores within one index point of it.");
    expect(aloneMarkdown).toContain("No configuration scores higher, so there is no higher-ranked row to compare that share with.");
    expect(aloneMarkdown).toContain("The chart cannot check those figures without the corresponding rows.");
    expect(aloneMarkdown).not.toContain("| Input-side cost |");
    expect(aloneMarkdown).not.toContain("undefined");
    expect(aloneMarkdown).not.toContain("NaN");

    const withoutSameScore = createMuseWonderArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.filter(record => !placed.sameRoundedScore.some(row => row.record.id === record.id)),
    }, codingSnapshot);
    const withoutSameScoreMarkdown = articleToMarkdown(withoutSameScore);
    expect(withoutSameScoreMarkdown).not.toContain("prints the same");
    expect(withoutSameScoreMarkdown).toContain("The table splits the bill of each row that beats Muse Wonder on both axes into its two sides");

    const exactTie = createMuseWonderArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        placed.sameRoundedScore.some(row => row.record.id === record.id)
          ? { ...record, intelligenceIndex: placed.record.intelligenceIndex }
          : record
      )),
    }, codingSnapshot);
    expect(articleToMarkdown(exactTie)).not.toContain("prints the same");

    const [metaRow] = codingSnapshot.records.filter(record => record.providerId === META_CREATOR_SLUG);
    if (metaRow === undefined) throw new Error("Checked coding snapshot must store a Meta row.");
    const twin = {
      ...metaRow,
      id: "wonder-twin",
      model: "Muse Wonder",
      seriesId: "Muse Code:Muse Wonder",
      seriesLabel: "Muse Code · Muse Wonder",
      setting: "max",
    };
    const withCodingRow = createMuseWonderArticle(intelligenceSnapshot, {
      ...codingSnapshot,
      records: [...codingSnapshot.records, twin],
    });
    const withCodingRowMarkdown = articleToMarkdown(withCodingRow);
    expect(museWonderCodingAgentRows([...codingSnapshot.records, twin]).map(row => row.id)).toEqual(["wonder-twin"]);
    expect(withCodingRowMarkdown).toContain("## Muse Wonder on the coding-agent chart");
    expect(withCodingRowMarkdown).toContain("stores one configuration that runs Muse Wonder");
    expect(withCodingRowMarkdown).toContain("| Configuration | Coding agents (AA Index) | Cost per task |");
    expect(withCodingRowMarkdown).toContain("scored on three coding benchmarks inside a harness rather than on the Intelligence Index");
    expect(withCodingRowMarkdown).not.toContain("No Muse Wonder row on the coding-agent chart");
    expect(withCodingRowMarkdown).not.toContain("undefined");

    const laterRetrieval = createMuseWonderArticle({
      ...intelligenceSnapshot,
      source: { ...intelligenceSnapshot.source, retrievedAt: "2026-12-01T08:00:00.000Z" },
    }, codingSnapshot);
    expect(laterRetrieval.updatedAt).toBe("2026-12-01");
    expect(articleToMarkdown(laterRetrieval)).toContain("Dec 1, 2026, 8:00 AM UTC");

    const expensive = createMuseWonderArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.slug === MUSE_WONDER_INTELLIGENCE_SLUG && record.costUsdPerTask !== null
          ? { ...record, costUsdPerTask: { ...record.costUsdPerTask, total: 1_234_567_890.12, input: 1_234_567_000, cacheWrite: 1_234_567_000 } }
          : record
      )),
    }, codingSnapshot);
    expect(expensive.title.length).toBeLessThanOrEqual(64);
    expect(expensive.title).toBe(`Muse Wonder scores ${formatSnapshotScore(placed.record.intelligenceIndex)} on the Intelligence Index`);
    expect(expensive.dek.length).toBeLessThanOrEqual(200);

    const rescored = createMuseWonderArticle({
      ...intelligenceSnapshot,
      records: intelligenceSnapshot.records.map(record => (
        record.slug === MUSE_WONDER_INTELLIGENCE_SLUG ? { ...record, intelligenceIndex: record.intelligenceIndex + 1 } : record
      )),
    }, codingSnapshot);
    expect(articleToMarkdown(rescored)).toContain("no longer rounds to the figure in Meta’s row, so the chart has moved since Meta published the table");
  });
});
