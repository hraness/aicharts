import { describe, expect, test } from "bun:test";
import { INDEXABLE_ROBOTS } from "@hraness/web-discovery";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import codingAgentData from "@/data/coding-agents.json";
import editorialImageManifest from "@/editorial/images.manifest.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
} from "@/lib/coding-agent-dataset";
import {
  aaIndexCostEfficiencyRows,
  aaIndexCostFrontier,
  codingAgentSnapshotRows,
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import {
  formatAaIndexGap,
  highestAaIndexRow,
  highestAaIndexRowForModel,
  openWeightCodingAgentRows,
} from "@/lib/open-weight-coding-agents";

import nextConfig from "../../next.config";
import sitemap, { blogSitemapEntries } from "../sitemap";
import BlogArticlePage, {
  generateMetadata,
  generateStaticParams,
} from "./[slug]/page";
import { ArticleBody } from "./article-body";
import {
  BLOG_SLUGS,
  BLOG_SOURCES,
  BLOG_AUTHORSHIP_DISCLOSURE,
  articleToMarkdown,
  blogArticleSection,
  blogArticlePath,
  blogArticles,
  blogDescription,
  getBlogArticle,
  headingId,
} from "./articles";
import { BLOG_ARTICLE_ADMISSIONS } from "./article-admissions";
import {
  FRENCH_OWEN_SMALL_MODELS,
  OPENAI_GPT_56_LUNA,
} from "./small-models-have-arrived-article";
import {
  TERMINAL_BENCH_SCIENCE,
} from "./terminal-bench-science-article";
import BlogLayout from "./layout";
import BlogIndex from "./page";
import { atomFeed } from "./atom-feed";
import { GET as getAtomFeed } from "./feed.xml/route";
import {
  BLOG_EDITORIAL_IMAGES,
  EDITORIAL_IMAGE_HEIGHT,
  EDITORIAL_IMAGE_WIDTH,
  blogEditorialImage,
  blogEditorialImages,
} from "./editorial-images";
import {
  BLOG_SOCIAL_IMAGE_PATH,
  blogArticleImagePath,
  blogArticleJsonLd,
  blogArticleMetadata,
  blogCollectionMetadata,
  blogCollectionJsonLd,
  breadcrumbJsonLd,
} from "./seo";

const IMAGE_FREE_SLUG = "small-models-have-arrived" as const;

describe("AI Charts benchmark notes", () => {
  test("uses the shared publication shell with chart discovery", () => {
    const markup = renderToStaticMarkup(
      createElement(
        BlogLayout,
        null,
        createElement("main", { id: "blog-content" }, "Articles"),
      ),
    );

    expect(markup).toContain(
      'class="plain-site plain-publication aicharts-blog"',
    );
    expect(markup).toContain('class="ui-skip-link"');
    expect(markup).toContain('class="plain-header__inner"');
    expect(markup).toContain('class="plain-wordmark" href="/"');
    expect(markup).toContain('class="plain-nav"');
    expect(markup).toContain('href="/blog"');
    expect(markup).toContain('href="/"');
    expect(markup.match(/data-presentation="menu"/gu)).toHaveLength(1);
    const headerStart = markup.indexOf('<header class="plain-header"');
    const headerEnd = markup.indexOf("</header>", headerStart);
    const actionsStart = markup.indexOf(
      'class="plain-header__actions"',
      headerStart,
    );
    const navigationStart = markup.indexOf(
      'aria-label="Blog navigation"',
      actionsStart,
    );
    const navigationEnd = markup.indexOf("</nav>", navigationStart);
    const appearance = markup.indexOf('data-presentation="menu"', actionsStart);
    expect(headerStart).toBeGreaterThan(-1);
    expect(actionsStart).toBeGreaterThan(headerStart);
    expect(navigationStart).toBeGreaterThan(actionsStart);
    expect(navigationEnd).toBeGreaterThan(navigationStart);
    expect(appearance).toBeGreaterThan(navigationEnd);
    expect(appearance).toBeLessThan(headerEnd);
    expect(markup.slice(navigationStart, navigationEnd))
      .not.toContain("hraness-design-theme-toggle");
    expect(markup.slice(appearance, headerEnd)).not.toContain("<a ");
    expect(markup).not.toContain('class="plain-footer"');
    expect(markup).not.toContain('class="hraness-ra-mark"');
  });

  test("publishes admitted complementary articles", () => {
    expect(blogArticles.map(article => article.slug)).toEqual([...BLOG_SLUGS]);
    expect(new Set(BLOG_SLUGS).size).toBe(BLOG_SLUGS.length);

    for (const article of blogArticles) {
      expect(article.title.length).toBeLessThanOrEqual(64);
      expect(article.seoDescription.length).toBeLessThanOrEqual(160);
      expect(article.seoDescription.trim()).toBe(article.seoDescription);
      expect(articleToMarkdown(article)).toContain(`# ${article.title}`);
      expect(articleToMarkdown(article)).toContain(article.dek);
      expect(article.authorshipDisclosure).toBe(BLOG_AUTHORSHIP_DISCLOSURE);
      expect(articleToMarkdown(article)).toContain(BLOG_AUTHORSHIP_DISCLOSURE);
      if (article.slug === "terminal-bench-science") {
        expect(article.publishedAt).toBe("2026-08-31");
        expect(article.updatedAt >= article.publishedAt).toBeTrue();
      } else if (article.slug === "small-models-have-arrived") {
        expect(article.publishedAt).toBe("2026-08-28");
        expect(article.updatedAt >= article.publishedAt).toBeTrue();
      } else if (
        article.slug === "coding-agent-score-holdouts"
        || article.slug === "open-models-coding-agent-benchmarks"
      ) {
        expect(article.publishedAt).toBe("2026-08-26");
        expect(article.updatedAt >= article.publishedAt).toBeTrue();
      } else if (article.slug === "aa-index-cost-coding-agents") {
        expect(article.publishedAt).toBe("2026-08-22");
        expect(article.updatedAt >= article.publishedAt).toBeTrue();
      } else if (article.slug === "mirrorcode-coding-agent-benchmark") {
        expect(article.publishedAt).toBe("2026-08-04");
        expect(article.updatedAt).toBe("2026-08-05");
        expect(articleToMarkdown(article)).toContain("captured August 5, 2026 UTC");
      } else {
        throw new Error(`Unhandled blog article date assertion: ${article.slug}`);
      }

      const headings = article.body
        .filter(block => block.type === "heading")
        .map(block => headingId(block.text));
      expect(new Set(headings).size).toBe(headings.length);

      for (const sourceId of article.sourceIds) {
        expect(BLOG_SOURCES[sourceId]).toBeDefined();
      }
      for (const relatedSlug of article.relatedSlugs) {
        expect(BLOG_SLUGS).toContain(relatedSlug);
        expect(relatedSlug).not.toBe(article.slug);
      }
      for (const block of article.body) {
        if (block.type !== "table") continue;
        expect(block.columns.length).toBeGreaterThanOrEqual(2);
        expect(block.rows.length).toBeGreaterThanOrEqual(2);
        for (const row of block.rows) {
          expect(row.length).toBe(block.columns.length);
        }
      }
    }
  });

  test("fails closed on complete, scored, individually authored admissions", () => {
    expect(Object.keys(BLOG_ARTICLE_ADMISSIONS)).toEqual([...BLOG_SLUGS]);
    for (const article of blogArticles) {
      const admission = BLOG_ARTICLE_ADMISSIONS[article.slug];
      expect(admission.canonicalOwner).toBe(blogArticlePath(article.slug));
      expect(admission.decision).toBe("keep");
      expect(admission.lifecycleState).toBe("indexable");
      expect(admission.reviewedBy).toBe("Codex editorial review");
      expect(admission.humanReviewedOn).toBeNull();
      expect(admission.readerJob.trim()).toBe(admission.readerJob);
      expect(admission.originalContribution.trim())
        .toBe(admission.originalContribution);
      expect(admission.primaryEvidence.trim()).toBe(admission.primaryEvidence);
      expect(admission.harmIfWrong.trim()).toBe(admission.harmIfWrong);
      expect(admission.hostFit.trim()).toBe(admission.hostFit);
      expect(admission.overlapDecision.trim()).toBe(admission.overlapDecision);
      expect(admission.nearestUrls.length).toBeGreaterThan(0);
      for (const neighbor of admission.nearestUrls) {
        expect(BLOG_SLUGS as readonly string[])
          .toContain(neighbor.url.slice("/blog/".length));
        expect(neighbor.url).not.toBe(admission.canonicalOwner);
        expect(neighbor.distinction.trim()).toBe(neighbor.distinction);
      }
      for (const sourceId of admission.primarySourceIds) {
        expect(article.sourceIds).toContain(sourceId);
        expect(BLOG_SOURCES[sourceId]).toBeDefined();
      }
      const scores = Object.values(admission.scores);
      expect(scores.every(score => score > 0)).toBeTrue();
      expect(scores.reduce((sum, score) => sum + score, 0))
        .toBeGreaterThanOrEqual(9);
      const reviewed = new Date(`${admission.reviewedOn}T00:00:00.000Z`);
      const reassess = new Date(`${admission.reassessOn}T00:00:00.000Z`);
      const sourceChecked = new Date(`${admission.sourceCheckedOn}T00:00:00.000Z`);
      expect(sourceChecked.getTime()).toBeLessThanOrEqual(reviewed.getTime());
      const days = (reassess.getTime() - reviewed.getTime()) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(28);
      expect(days).toBeLessThanOrEqual(56);
    }
  });

  test("derives the AA Index versus cost note from the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const article = getBlogArticle("aa-index-cost-coding-agents");
    expect(article).toBeDefined();
    if (article === undefined) return;

    const markup = renderToStaticMarkup(
      createElement(ArticleBody, { blocks: article.body }),
    );
    const leaders = codingAgentSnapshotRows(parsed.value.records).slice(0, 10);
    const frontier = aaIndexCostFrontier(parsed.value.records);
    const efficiency = aaIndexCostEfficiencyRows(parsed.value.records).slice(0, 10);

    expect(markup).toContain(parsed.value.source.url);
    expect(markup).toContain(formatRetrievedAt(parsed.value.source.retrievedAt));
    expect(leaders[0]).toBeDefined();
    for (const row of [...leaders, ...frontier.map(point => ({
      model: point.record.model,
      agent: point.record.agent,
      setting: point.record.setting,
      aaIndex: point.yValue,
      costUsd: point.xValue,
    })), ...efficiency.map(row => ({
      model: row.record.model,
      agent: row.record.agent,
      setting: row.record.setting,
      aaIndex: row.aaIndex,
      costUsd: row.costUsd,
    }))]) {
      expect(markup).toContain(row.model);
      expect(markup).toContain(row.agent);
      expect(markup).toContain(row.setting);
      expect(markup).toContain(formatSnapshotScore(row.aaIndex));
      expect(markup).toContain(formatSnapshotCostUsd(row.costUsd));
    }
  });

  test("derives the open-models note from the checked snapshot and quoted SemiAnalysis figures", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const article = getBlogArticle("open-models-coding-agent-benchmarks");
    expect(article).toBeDefined();
    if (article === undefined) return;

    const markup = renderToStaticMarkup(
      createElement(ArticleBody, { blocks: article.body }),
    );
    const rows = codingAgentSnapshotRows(parsed.value.records);
    const top = highestAaIndexRow(rows);
    const topOpen = highestAaIndexRow(openWeightCodingAgentRows(parsed.value.records));
    const kimi = highestAaIndexRowForModel(rows, "Kimi K2.6");
    const glm = highestAaIndexRowForModel(rows, "GLM-5.2");
    expect(top?.aaIndex).not.toBeNull();
    expect(topOpen?.aaIndex).not.toBeNull();
    if (top?.aaIndex == null || topOpen?.aaIndex == null) return;

    expect(markup).toContain(BLOG_SOURCES.semiAnalysisOpenModels.url);
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/data"');
    expect(markup).toContain('href="/blog/aa-index-cost-coding-agents"');
    expect(markup).toContain(formatRetrievedAt(parsed.value.source.retrievedAt));
    expect(markup).toContain(top.model);
    expect(markup).toContain(formatSnapshotScore(top.aaIndex));
    expect(markup).toContain(topOpen.model);
    expect(markup).toContain(formatSnapshotScore(topOpen.aaIndex));
    expect(markup).toContain(formatAaIndexGap(top.aaIndex, topOpen.aaIndex));
    expect(markup).not.toContain("hraness.com/reading");
    expect(markup).toContain("75.7");
    expect(markup).toContain("56.3");
    expect(markup).toContain("72.4");
    if (kimi !== undefined) {
      expect(markup).toContain(kimi.model);
      expect(markup).toContain(formatSnapshotScore(kimi.aaIndex));
    }
    if (glm !== undefined) {
      expect(markup).toContain(glm.model);
      expect(markup).toContain(formatSnapshotScore(glm.aaIndex));
    }
  });

  test("explains small-model economics from primary sources without internal publishing context", () => {
    const article = getBlogArticle("small-models-have-arrived");
    expect(article).toBeDefined();
    if (article === undefined) return;

    const markup = renderToStaticMarkup(
      createElement(ArticleBody, { blocks: article.body }),
    );
    const markdown = articleToMarkdown(article);

    expect(article.title).toBe("Cheaper AI models can make everyday products viable");
    expect(article.sourceIds).toEqual([
      "calvinFrenchOwenSmallModels",
      "openAiGpt56Luna",
    ]);
    expect(markup).toContain(BLOG_SOURCES.calvinFrenchOwenSmallModels.url);
    expect(markup).toContain(BLOG_SOURCES.openAiGpt56Luna.url);
    expect(markdown).toContain("one person’s experiment");
    expect(markdown).toContain("cheapest model that meets the requirement");
    expect(markdown).toContain("cost of a successful result");
    expect(markup).toContain(FRENCH_OWEN_SMALL_MODELS.reported.lunaSpeed);
    expect(markup).toContain(FRENCH_OWEN_SMALL_MODELS.reported.newsEvalLuna);
    expect(markup).toContain(FRENCH_OWEN_SMALL_MODELS.reported.newsEvalSonnet);
    expect(markup).toContain(FRENCH_OWEN_SMALL_MODELS.reported.researchThread);
    expect(markup).toContain(OPENAI_GPT_56_LUNA.pricing.inputPerMillionTokens);
    expect(markup).toContain(OPENAI_GPT_56_LUNA.pricing.outputPerMillionTokens);
    expect(markdown).toContain("$3 versus $30 over 30 days");
    expect(markdown).toContain("## Related analysis");
    expect(markdown).toContain(
      "https://aicharts.io/blog/aa-index-cost-coding-agents",
    );
    expect(markup).toContain('href="/blog/terminal-bench-science"');
    expect(markdown).not.toContain("Current coding-agent comparison");
    expect(markdown).not.toContain("Hraness reading");
    expect(markdown).not.toContain("stored row");
    expect(markdown).not.toContain("mint a");
    expect(markdown).not.toContain("scoreboard");
    expect(markdown).not.toContain("checked snapshot");
  });

  test("explains the Terminal-Bench-Science result without duplicating a reading digest", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const article = getBlogArticle("terminal-bench-science");
    expect(article).toBeDefined();
    if (article === undefined) return;

    const markup = renderToStaticMarkup(
      createElement(ArticleBody, { blocks: article.body }),
    );
    const markdown = articleToMarkdown(article);
    const leaders = currentCodingAgentBenchmarkLeaders(parsed.value);
    const terminalLeader = leaders.find(leader => leader.definition.id === "terminalBench");
    expect(terminalLeader).toBeDefined();
    if (terminalLeader === undefined) return;

    expect(article.title).toBe("What Terminal-Bench-Science’s 30% result measures");
    expect(article.sourceIds).toEqual([
      "terminalBenchScienceAnnouncement",
      "artificialAnalysisCodingAgents",
    ]);
    expect(markup).toContain(BLOG_SOURCES.terminalBenchScienceAnnouncement.url);
    expect(markup).toContain(BLOG_SOURCES.artificialAnalysisCodingAgents.url);
    expect(markup).toContain('href="/"');
    expect(markup).toContain(formatRetrievedAt(parsed.value.source.retrievedAt));
    expect(markdown).toContain(TERMINAL_BENCH_SCIENCE.quotes.scientistsSetTheBar);
    expect(markdown).toContain(TERMINAL_BENCH_SCIENCE.quotes.strongestResolvesThirty);
    expect(markdown).toContain(TERMINAL_BENCH_SCIENCE.quotes.taskFunnel);
    expect(markdown).toContain(TERMINAL_BENCH_SCIENCE.quotes.solMatchesFableCost);
    expect(article.nextStep?.links.map(link => link.href)).toEqual([
      "/data#terminal-bench-science",
      "/data/terminal-bench-science-0-1.json",
    ]);
    expect(markdown).toContain("Inspect the version-pinned scientific benchmark");
    const nextStepAt = markdown.indexOf(
      "## Inspect the version-pinned scientific benchmark",
    );
    const sourcesAt = markdown.indexOf("## Sources");
    const relatedAt = markdown.indexOf("## Related analysis");
    expect(nextStepAt).toBeGreaterThan(-1);
    expect(nextStepAt).toBeLessThan(sourcesAt);
    expect(sourcesAt).toBeLessThan(relatedAt);
    expect(markdown).not.toContain("### Inspect the version-pinned scientific benchmark");
    expect(markdown).toContain("Cost and tokens change the comparison");
    expect(markdown).not.toContain("not a product win");
    expect(markdown).not.toContain("This page is");
    expect(markup).not.toContain("https://hraness.com/reading/terminal-bench-science-0-1");
    expect(markup).toContain(TERMINAL_BENCH_SCIENCE.reported.peakResolution);
    expect(markup).toContain(TERMINAL_BENCH_SCIENCE.reported.costSol);
    expect(markup).toContain(TERMINAL_BENCH_SCIENCE.reported.costFable5);
    expect(markup).toContain(TERMINAL_BENCH_SCIENCE.reported.costOpus5);
    expect(markup).toContain(TERMINAL_BENCH_SCIENCE.reported.fableTokens);
    expect(markup).toContain(TERMINAL_BENCH_SCIENCE.reported.solTokens);
    expect(markup).toContain(TERMINAL_BENCH_SCIENCE.reported.glmOpenLead);
    expect(markup).toContain(terminalLeader.record.model);
    expect(markup).toContain(terminalLeader.record.agent);
    expect(markup).toContain(terminalLeader.record.setting);
    expect(markup).toContain(formatBenchmarkScore(terminalLeader.value));
    for (const row of TERMINAL_BENCH_SCIENCE.leaderboard) {
      expect(markup).toContain(row.model);
      expect(markup).toContain(row.harness);
      expect(markup).toContain(row.resolution);
    }
  });

  test("derives the holdout note from fetched Luu quotes and the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const article = getBlogArticle("coding-agent-score-holdouts");
    expect(article).toBeDefined();
    if (article === undefined) return;

    const markup = renderToStaticMarkup(
      createElement(ArticleBody, { blocks: article.body }),
    );
    const markdown = articleToMarkdown(article);
    const leaders = currentCodingAgentBenchmarkLeaders(parsed.value);
    const aaLeader = leaders.find(leader => leader.definition.id === "aaIndex");
    expect(aaLeader).toBeDefined();
    if (aaLeader === undefined) return;

    expect(markup).toContain(BLOG_SOURCES.danLuuBenchpocalypse.url);
    expect(markup).toContain(BLOG_SOURCES.artificialAnalysisCodingAgents.url);
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/data"');
    expect(markup).toContain(formatRetrievedAt(parsed.value.source.retrievedAt));
    expect(markdown).toContain(
      "LLMs not only make this trivial, they do it by default, making formerly trustworthy benchmarks meaningless unless you audit the result or trust someone who did.",
    );
    expect(markdown).toContain(
      "It's trivial to \"win\" a non-trivial benchmark in a meaningless way even when you instruct agents to not reward hack or overfit to win the benchmark",
    );
    expect(markdown).toContain(
      "Once again, telling the LLM there's a holdout set worked better than just telling the LLM to do generalized work or not overfit or cheat",
    );
    expect(markdown).toContain(
      "Another aspect of the benchmarkpocalypse is that, at least for now, LLMs are good at doing bad benchmarking",
    );
    expect(markup).not.toContain("hraness.com/reading");
    expect(markup).toContain("1.4x faster");
    expect(markup).toContain("10x slower");
    expect(markup).toContain("2.4x slower");
    expect(markup).toContain("GPT-5.6 Sol");
    expect(markup).toContain(aaLeader.record.model);
    expect(markup).toContain(aaLeader.record.agent);
    expect(markup).toContain(formatBenchmarkScore(aaLeader.value));
    for (const leader of leaders) {
      expect(markup).toContain(leader.record.model);
      expect(markup).toContain(formatBenchmarkScore(leader.value));
    }
  });

  test("keeps sources unique, descriptive, and HTTPS-only", () => {
    const sources = Object.values(BLOG_SOURCES);
    expect(new Set(sources.map(source => source.url)).size).toBe(sources.length);
    for (const source of sources) {
      expect(source.title.trim()).toBe(source.title);
      expect(source.note.trim()).toBe(source.note);
      expect(new URL(source.url).protocol).toBe("https:");
    }
  });

  test("renders semantic article content with crawlable primary sources", () => {
    const markup = blogArticles.map(article =>
      renderToStaticMarkup(
        createElement(ArticleBody, { blocks: article.body }),
      )).join("\n");

    expect(markup).toContain("<h2");
    expect(markup).toContain("<aside");
    expect(markup).toContain("<ul");
    expect(markup).toContain("<table");
    expect(markup).toContain('scope="row"');
    expect(markup).toContain(`href="${BLOG_SOURCES.mirrorCode.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.artificialAnalysisCodingAgents.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.semiAnalysisOpenModels.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.danLuuBenchpocalypse.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.calvinFrenchOwenSmallModels.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.openAiGpt56Luna.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.terminalBenchScienceAnnouncement.url}"`);
  });

  test("renders the index, static routes, breadcrumbs, dates, and sources", async () => {
    const indexMarkup = renderToStaticMarkup(createElement(BlogIndex));
    expect(indexMarkup).toContain("AI model and agent benchmark analysis");
    expect(indexMarkup).toContain(blogDescription);
    expect(indexMarkup).toContain("The first collection focuses on coding agents.");
    expect(indexMarkup).toContain("Explore the coding-agent chart");
    expect(indexMarkup).toContain("Method");
    expect(indexMarkup.match(/rel="preload"/gu)).toHaveLength(1);
    for (const article of blogArticles) {
      expect(indexMarkup).toContain(`href="${blogArticlePath(article.slug)}"`);
      const editorialImage = blogEditorialImage(article.slug);
      if (editorialImage !== undefined) {
        expect(indexMarkup).toContain(
          encodeURIComponent(editorialImage.src),
        );
      } else {
        expect(article.slug).toBe(IMAGE_FREE_SLUG);
        expect(indexMarkup).not.toContain(
          encodeURIComponent(`/images/blog/${article.slug}.webp`),
        );
      }

      const page = await BlogArticlePage({
        params: Promise.resolve({ slug: article.slug }),
      });
      const markup = renderToStaticMarkup(page);
      expect(markup).toContain(
        'class="plain-publication__breadcrumbs"',
      );
      expect(markup).toContain(
        `<span aria-current="page">${article.title}</span>`,
      );
      expect(markup).toContain(`dateTime="${article.publishedAt}"`);
      expect(markup).toContain("By AI Charts · AI-assisted");
      expect(markup).toContain(article.authorshipDisclosure);
      if (editorialImage !== undefined) {
        expect(markup).toContain(editorialImage.caption);
        expect(markup).toContain(editorialImage.alt);
      } else {
        expect(article.slug).toBe(IMAGE_FREE_SLUG);
        expect(markup).not.toContain("<figure");
      }
      if ("nextStep" in article && article.nextStep !== undefined) {
        expect(markup).toContain(article.nextStep.title);
        for (const link of article.nextStep.links) {
          expect(markup).toContain(`href="${link.href}"`);
        }
        expect(markup).not.toContain("Current comparison: coding agents");
      } else if ("showChartCta" in article && article.showChartCta === false) {
        expect(markup).not.toContain("Current comparison: coding agents");
      } else {
        expect(markup).toContain("Current comparison: coding agents");
      }
      for (const sourceId of article.sourceIds) {
        expect(markup).toContain(`href="${BLOG_SOURCES[sourceId].url}"`);
      }
    }

    expect(generateStaticParams()).toEqual(
      blogArticles.map(article => ({ slug: article.slug })),
    );
    expect(getBlogArticle("not-an-article")).toBeUndefined();
  });

  test("layers shared controls below repository-owned publication CSS", async () => {
    const [globals, publication] = await Promise.all([
      Bun.file(new URL("../globals.css", import.meta.url)).text(),
      Bun.file(new URL("../../styles/plain-publication.css", import.meta.url)).text(),
    ]);
    expect(globals).toStartWith('@import "@hraness/design-kit/styles.css";');
    expect(globals).toContain('@import "../styles/plain-site.css";');
    expect(globals).toContain('@import "../styles/plain-publication.css";');
    expect(publication).toContain(".plain-site.plain-publication");
  });
});

describe("AI Charts blog discovery", () => {
  test("keeps dynamic article images independent of monorepo files", () => {
    expect(nextConfig.outputFileTracingIncludes).toBeUndefined();
  });

  test("aligns article canonicals, social images, and static metadata", async () => {
    for (const article of blogArticles) {
      const path = blogArticlePath(article.slug);
      const metadata = blogArticleMetadata(article);
      const generated = await generateMetadata({
        params: Promise.resolve({ slug: article.slug }),
      });
      const editorialImage = blogEditorialImage(article.slug);

      expect(generated).toEqual(metadata);
      expect(metadata.title).toBe(article.title);
      expect(metadata.description).toBe(article.seoDescription);
      expect(metadata.alternates).toEqual({
        canonical: `https://aicharts.io${path}`,
      });
      expect(metadata.openGraph).toMatchObject({
        type: "article",
        url: `https://aicharts.io${path}`,
        title: article.title,
        description: article.seoDescription,
        publishedTime: `${article.publishedAt}T00:00:00.000Z`,
        modifiedTime: `${article.updatedAt}T00:00:00.000Z`,
        section: blogArticleSection(article),
      });
      if (editorialImage === undefined) {
        expect(metadata.openGraph).not.toHaveProperty("images");
        expect(metadata.twitter).toMatchObject({ card: "summary" });
        expect(metadata.twitter).not.toHaveProperty("images");
      } else {
        const image = `https://aicharts.io${editorialImage.socialSrc}`;
        expect(blogArticleImagePath(article.slug)).toBe(editorialImage.socialSrc);
        expect(metadata.openGraph).toMatchObject({
          images: [{
            alt: editorialImage.alt,
            height: EDITORIAL_IMAGE_HEIGHT,
            url: image,
            width: EDITORIAL_IMAGE_WIDTH,
          }],
        });
        expect(metadata.twitter).toMatchObject({
          card: "summary_large_image",
          images: [{ url: image }],
        });
      }
      expect(metadata.robots).toEqual(INDEXABLE_ROBOTS);
    }

    const imageLessArticle = getBlogArticle(IMAGE_FREE_SLUG);
    expect(imageLessArticle).toBeDefined();
    if (imageLessArticle === undefined) return;
    const imageLess = blogArticleMetadata(imageLessArticle);
    expect(imageLess.openGraph).not.toHaveProperty("images");
    expect(imageLess.twitter).toMatchObject({ card: "summary" });
    expect(imageLess.twitter).not.toHaveProperty("images");
  });

  test("validates each registered editorial image without requiring one per article", async () => {
    expect(blogEditorialImage(IMAGE_FREE_SLUG)).toBeUndefined();
    expect(blogEditorialImages.length).toBeLessThan(blogArticles.length);
    for (const slug of Object.keys(BLOG_EDITORIAL_IMAGES)) {
      expect(BLOG_SLUGS as readonly string[]).toContain(slug);
    }
    expect(new Set(blogEditorialImages.map(image => image.sha256)).size)
      .toBe(blogEditorialImages.length);

    for (const image of blogEditorialImages) {
      expect(image.src).toBe(`/images/blog/${image.slug}.webp`);
      expect(image.width).toBe(1536);
      expect(image.height).toBe(864);
      expect(image.alt.trim()).toBe(image.alt);
      expect(image.caption.trim()).toBe(image.caption);
      expect(image.sha256).toMatch(/^[a-f0-9]{64}$/u);

      const file = Bun.file(new URL(`../../public${image.src}`, import.meta.url));
      expect(await file.exists()).toBeTrue();
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(await file.arrayBuffer());
      expect(hasher.digest("hex")).toBe(image.sha256);
    }

    expect(editorialImageManifest.generator.package).toBe("@hraness/atet@3.1.2");
    expect(editorialImageManifest.images.map(entry => entry.slug).sort())
      .toEqual(blogEditorialImages.map(image => image.slug).sort());
    for (const image of blogEditorialImages) {
      const entry = editorialImageManifest.images.find(candidate =>
        candidate.slug === image.slug);
      expect(entry).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.master.path).toBe(image.src);
      expect(entry.master.width).toBe(image.width);
      expect(entry.master.height).toBe(image.height);
      expect(entry.master.sha256).toBe(image.sha256);
      expect(entry.promptSha256).toBe(image.provenance.promptSha256);
      expect(entry.receiptPath.endsWith(image.provenance.receipt)).toBeTrue();
      expect(entry.jobPath.endsWith(image.provenance.job)).toBeTrue();
      const file = Bun.file(new URL(`../../public${image.src}`, import.meta.url));
      expect(entry.master.bytes).toBe(file.size);
    }
  });

  test("publishes an Atom feed with the same representative image", async () => {
    const xml = atomFeed();
    const response = getAtomFeed();
    expect(response.headers.get("content-type"))
      .toBe("application/atom+xml; charset=utf-8");
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml.match(/<entry>/gu)).toHaveLength(blogArticles.length);
    for (const article of blogArticles) {
      const image = blogEditorialImage(article.slug);
      if (image !== undefined) {
        expect(xml).toContain(
          `href="https://aicharts.io${image.src}" rel="enclosure" type="image/webp"`,
        );
        expect(xml).toContain(image.alt);
        expect(xml).toContain(image.caption);
      }
    }
    const imageFreeArticle = getBlogArticle(IMAGE_FREE_SLUG);
    expect(imageFreeArticle).toBeDefined();
    if (imageFreeArticle === undefined) return;
    const imageFreeUrl = `https://aicharts.io${blogArticlePath(IMAGE_FREE_SLUG)}`;
    const imageFreeStart = xml.indexOf(`<id>${imageFreeUrl}</id>`);
    const imageFreeEnd = xml.indexOf("</entry>", imageFreeStart);
    const imageFreeEntry = xml.slice(imageFreeStart, imageFreeEnd);
    expect(imageFreeStart).toBeGreaterThan(-1);
    expect(imageFreeEntry).not.toContain('rel="enclosure"');
    expect(imageFreeEntry).not.toContain(`/images/blog/${IMAGE_FREE_SLUG}.webp`);
    expect(imageFreeEntry).toContain("AI-assisted editorial workflow");
    expect(imageFreeEntry).toContain("Prepared with AI assistance");
    const imageLessFeed = atomFeed(() => undefined);
    expect(imageLessFeed.match(/<entry>/gu)).toHaveLength(blogArticles.length);
    expect(imageLessFeed).not.toContain('rel="enclosure"');
    expect(imageLessFeed).not.toContain("&lt;figure&gt;");
    expect(blogCollectionMetadata.alternates).toMatchObject({
      types: {
        "application/atom+xml": "https://aicharts.io/blog/feed.xml",
      },
    });
  });

  test("publishes truthful collection, article, and breadcrumb schema", () => {
    const collection = blogCollectionJsonLd();
    expect(collection).toMatchObject({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "AI model and agent benchmark analysis",
      url: "https://aicharts.io/blog",
      primaryImageOfPage:
        "https://aicharts.io/blog/opengraph-image",
    });
    expect(collection.mainEntity.numberOfItems).toBe(blogArticles.length);

    for (const article of blogArticles) {
      const structured = blogArticleJsonLd(article);
      expect(structured).toMatchObject({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: article.title,
        description: article.seoDescription,
        datePublished: `${article.publishedAt}T00:00:00.000Z`,
        dateModified: `${article.updatedAt}T00:00:00.000Z`,
        isAccessibleForFree: true,
        creditText: article.authorshipDisclosure,
      });
      const image = blogEditorialImage(article.slug);
      if (image === undefined) {
        expect(structured).not.toHaveProperty("image");
      } else {
        expect(structured.image).toBe(`https://aicharts.io${image.src}`);
      }
      expect(structured.citation).toEqual(
        article.sourceIds.map(sourceId => BLOG_SOURCES[sourceId].url),
      );
      expect(structured.articleSection).toBe(blogArticleSection(article));
      expect(structured).not.toHaveProperty("review");
      expect(structured).not.toHaveProperty("aggregateRating");
    }

    const imageLessCollection = blogCollectionJsonLd(() => undefined);
    for (const item of imageLessCollection.mainEntity.itemListElement) {
      expect(item).not.toHaveProperty("image");
    }
    expect(blogArticleJsonLd(blogArticles[0], null)).not.toHaveProperty("image");
    const liveImageFree = getBlogArticle(IMAGE_FREE_SLUG);
    expect(liveImageFree).toBeDefined();
    if (liveImageFree !== undefined) {
      expect(blogArticleJsonLd(liveImageFree)).not.toHaveProperty("image");
      const liveItem = collection.mainEntity.itemListElement.find(item =>
        item.url.endsWith(blogArticlePath(IMAGE_FREE_SLUG)));
      expect(liveItem).not.toHaveProperty("image");
    }

    const smallModels = getBlogArticle("small-models-have-arrived");
    expect(smallModels).toBeDefined();
    if (smallModels !== undefined) {
      expect(blogArticleMetadata(smallModels).category).toBe("AI model economics");
      expect(blogArticleJsonLd(smallModels).articleSection)
        .toBe("AI model economics");
    }

    const science = getBlogArticle("terminal-bench-science");
    expect(science).toBeDefined();
    if (science !== undefined) {
      expect(blogArticleMetadata(science).category).toBe(
        "Scientific agent benchmarks",
      );
      expect(blogArticleJsonLd(science).articleSection)
        .toBe("Scientific agent benchmarks");
    }

    expect(breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Blog", path: "/blog" },
    ])).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { item: "https://aicharts.io/", position: 1 },
        { item: "https://aicharts.io/blog", position: 2 },
      ],
    });
  });

  test("lists every public blog route and social image in the sitemap", () => {
    const entries = sitemap();
    const urls = entries.map(entry => entry.url);
    const expectedRoutes = [
      "https://aicharts.io/",
      "https://aicharts.io/data",
      "https://aicharts.io/blog",
      ...blogArticles.map(article =>
        `https://aicharts.io${blogArticlePath(article.slug)}`),
    ];
    expect(new Set(urls).size).toBe(urls.length);
    for (const route of expectedRoutes) expect(urls).toContain(route);

    const collection = entries.find(entry => entry.url.endsWith("/blog"));
    expect(collection?.images).toEqual([
      `https://aicharts.io${BLOG_SOCIAL_IMAGE_PATH}`,
    ]);
    for (const article of blogArticles) {
      const entry = entries.find(candidate =>
        candidate.url.endsWith(blogArticlePath(article.slug)));
      expect(entry?.lastModified).toBe(article.updatedAt);
      const image = blogEditorialImage(article.slug);
      if (image === undefined) {
        expect(entry).not.toHaveProperty("images");
      } else {
        expect(entry?.images).toEqual([
          `https://aicharts.io${image.src}`,
        ]);
      }
    }
    for (const entry of blogSitemapEntries(() => undefined)) {
      expect(entry).not.toHaveProperty("images");
    }
    const liveImageFree = entries.find(entry =>
      entry.url.endsWith(blogArticlePath(IMAGE_FREE_SLUG)));
    expect(liveImageFree).toBeDefined();
    expect(liveImageFree).not.toHaveProperty("images");
  });

  test("emits a website identity and links the chart to the blog", async () => {
    const [layoutSource, chartSource, headerSource] = await Promise.all([
      Bun.file(new URL("../layout.tsx", import.meta.url)).text(),
      Bun.file(
        new URL("../../components/coding-agent-explorer.tsx", import.meta.url),
      ).text(),
      Bun.file(new URL("../../components/site-header.tsx", import.meta.url)).text(),
    ]);

    expect(layoutSource).toContain('"@type": "WebSite"');
    expect(chartSource).toContain('<Link href="/blog">Analysis</Link>');
    expect(headerSource).toContain('{ href: "/blog", label: "Blog" }');
  });
});
