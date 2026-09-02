import { site } from "../site";
import { createAaIndexCostArticle } from "./aa-index-cost-article";
import { createCodingAgentScoreHoldoutsArticle } from "./coding-agent-score-holdouts-article";
import { createOpenModelsCodingAgentsArticle } from "./open-models-coding-agents-article";
import { createSmallModelsHaveArrivedArticle } from "./small-models-have-arrived-article";
import { createTerminalBenchScienceArticle } from "./terminal-bench-science-article";

export const BLOG_SLUGS = [
  "terminal-bench-science",
  "small-models-have-arrived",
  "coding-agent-score-holdouts",
  "open-models-coding-agent-benchmarks",
  "aa-index-cost-coding-agents",
  "mirrorcode-coding-agent-benchmark",
] as const;

export const blogDescription =
  "Sourced analysis of AI model and agent benchmarks: what each evaluation measures, what the results show, and where the evidence stops.";

export type BlogSlug = (typeof BLOG_SLUGS)[number];

export type InlinePart =
  | string
  | Readonly<{
      emphasis?: "em" | "strong";
      href?: string;
      text: string;
    }>;

export type InlineContent = readonly InlinePart[];

export type BlogBlock =
  | Readonly<{
      content: InlineContent;
      type: "paragraph";
    }>
  | Readonly<{
      level: 2 | 3;
      text: string;
      type: "heading";
    }>
  | Readonly<{
      items: readonly InlineContent[];
      style: "ordered" | "unordered";
      type: "list";
    }>
  | Readonly<{
      content: InlineContent;
      label: string;
      type: "callout";
    }>
  | Readonly<{
      caption: string;
      columns: readonly string[];
      rows: readonly (readonly InlineContent[])[];
      type: "table";
    }>;

export interface BlogSource {
  readonly note: string;
  readonly publication: string;
  readonly title: string;
  readonly url: `https://${string}`;
  readonly year: number;
}

export const BLOG_SOURCES = {
  mirrorCode: {
    note:
      "Epoch AI's maintained benchmark page defines the current leaderboard configuration, resource budgets, result snapshot, gotree example, and contamination caveat.",
    publication: "Epoch AI",
    title: "MirrorCode: What's the largest software project AI can complete on its own?",
    url: "https://epoch.ai/MirrorCode",
    year: 2026,
  },
  mirrorCodePaper: {
    note:
      "The MirrorCode paper documents the broader task set and evaluation design. Its configuration differs from the maintained leaderboard summarized here.",
    publication: "arXiv",
    title: "MirrorCode: How Far Can Frontier AI Models Go on Long-Horizon Coding Tasks?",
    url: "https://arxiv.org/abs/2606.30182",
    year: 2026,
  },
  artificialAnalysisCodingAgents: {
    note:
      "The public coding-agents comparison is the upstream source of the checked AI Charts snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.",
    publication: "Artificial Analysis",
    title: "Coding Agents",
    url: "https://artificialanalysis.ai/agents/coding-agents/",
    year: 2026,
  },
  semiAnalysisOpenModels: {
    note:
      "The August 21, 2026 essay reports era-specific open-versus-closed composites, catch-up intervals, and the limits of public-benchmark scores.",
    publication: "SemiAnalysis",
    title: "Are Open Models Catching Up?",
    url: "https://newsletter.semianalysis.com/p/are-open-models-catching-up",
    year: 2026,
  },
  danLuuBenchpocalypse: {
    note:
      "The essay reports the FRE regex-engine loop, the rebar-versus-holdout gap, later interface and haystack cheats, and the claim that the same problem applies to AI software.",
    publication: "Dan Luu",
    title: "The benchmarkpocalypse",
    url: "https://danluu.com/benchpocalypse/",
    year: 2026,
  },
  calvinFrenchOwenSmallModels: {
    note:
      "The August 26, 2026 essay reports GPT-5.6 Luna speed and costs from French-Owen’s research and personalized-news experiments.",
    publication: "calv.info",
    title: "Small Models Have Arrived",
    url: "https://calv.info/small-models-have-arrived",
    year: 2026,
  },
  openAiGpt56Luna: {
    note:
      "The official model page describes GPT-5.6 Luna as a cost-sensitive, high-volume model and lists its current token prices and additional cost conditions.",
    publication: "OpenAI",
    title: "GPT-5.6 Luna Model",
    url: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
    year: 2026,
  },
  terminalBenchScienceAnnouncement: {
    note:
      "Steven Dillmann’s announcement defines Terminal-Bench-Science 0.1, reports the 70-task funnel, named resolution rates, cost and token frontiers, and the living-benchmark roadmap.",
    publication: "Terminal-Bench-Science",
    title: "Terminal-Bench-Science 0.1",
    url: "https://www.terminal-bench-science.ai/announcement",
    year: 2026,
  },
} as const satisfies Record<string, BlogSource>;

export type BlogSourceId = keyof typeof BLOG_SOURCES;

export const BLOG_AUTHORSHIP_DISCLOSURE =
  "Prepared with AI assistance from the cited primary sources and checked site data. AI Charts did not independently rerun the reported benchmarks.";

export interface BlogArticle {
  readonly authorshipDisclosure: typeof BLOG_AUTHORSHIP_DISCLOSURE;
  readonly body: readonly BlogBlock[];
  readonly dek: string;
  readonly focusPhrase: string;
  readonly keywords: readonly string[];
  readonly publishedAt: string;
  readonly relatedSlugs: readonly BlogSlug[];
  readonly section?: string;
  readonly seoDescription: string;
  readonly showChartCta?: boolean;
  readonly slug: BlogSlug;
  readonly sourceIds: readonly BlogSourceId[];
  readonly title: string;
  readonly updatedAt: string;
}

export function paragraph(...content: InlinePart[]): BlogBlock {
  return { content, type: "paragraph" };
}

export function heading(text: string, level: 2 | 3 = 2): BlogBlock {
  return { level, text, type: "heading" };
}

export function callout(label: string, ...content: InlinePart[]): BlogBlock {
  return { content, label, type: "callout" };
}

export function list(...items: readonly InlineContent[]): BlogBlock {
  return { items, style: "unordered", type: "list" };
}

export function table(
  caption: string,
  columns: readonly string[],
  rows: readonly (readonly InlineContent[])[],
): BlogBlock {
  return { caption, columns, rows, type: "table" };
}

const mirrorCodeArticle = {
  authorshipDisclosure: BLOG_AUTHORSHIP_DISCLOSURE,
  slug: "mirrorcode-coding-agent-benchmark",
  title: "MirrorCode: how far can coding agents work on their own?",
  dek:
    "MirrorCode tests whether a coding agent can reimplement a complete program under strict end-to-end tests and project-scale resource budgets.",
  focusPhrase: "MirrorCode coding agent benchmark",
  seoDescription:
    "MirrorCode tests whether coding agents can reimplement complete programs. Learn how the benchmark works, what current results show, and its main limits.",
  keywords: [
    "MirrorCode",
    "coding agent benchmark",
    "long-horizon coding",
    "AI software engineering",
    "Epoch AI",
    "METR",
  ],
  publishedAt: "2026-08-04",
  updatedAt: "2026-08-04",
  sourceIds: ["mirrorCode", "mirrorCodePaper"],
  relatedSlugs: [],
  body: [
    paragraph(
      { href: BLOG_SOURCES.mirrorCode.url, text: "MirrorCode" },
      " is a long-horizon coding benchmark developed by Epoch AI and METR. It asks an agent to reimplement an entire program without access to the original source code. The replacement must match the reference program on end-to-end tests, including held-out tests that the agent cannot inspect while developing.",
    ),
    paragraph(
      "That makes the task different from fixing one repository issue or adding one feature. The agent must infer a complete behavioral contract, build a replacement, and close enough edge cases to satisfy strict evaluation. The benchmark measures sustained autonomous implementation at project scale, under budgets large enough to support hours or days of work.",
    ),
    heading("What MirrorCode measures"),
    paragraph(
      "MirrorCode contains 25 target programs drawn from several areas of computing:",
    ),
    list(
      ["Unix utilities"],
      ["Data serialization and query tools"],
      ["Bioinformatics"],
      ["Language interpreters and static analysis"],
      ["Cryptography and compression"],
    ),
    paragraph(
      "The agent works in a sandbox without internet access and cannot inspect the original repository. It receives enough observable behavior for a replacement to be possible, then must produce the same outputs as the target. Held-out tests prevent success through a lookup table limited to visible examples.",
    ),
    paragraph(
      "MirrorCode is therefore a behavioral reimplementation benchmark. It does not require the replacement to share the original architecture, internal interfaces, or source layout. It asks whether the agent can reproduce externally tested behavior closely enough to count as complete.",
    ),
    heading("Project-scale budgets are part of the result"),
    paragraph(
      "Epoch AI gives agents substantially more time and inference than most software-engineering benchmarks. One of the largest runs reported on the source page cost about $2,600 and continued for 19 days without human intervention. That example belongs to the broader benchmark work, not the current seven-day leaderboard configuration.",
    ),
    paragraph(
      "These budgets make difficult project-scale attempts possible, but they also bound what the result means. MirrorCode shows what an agent can complete when allowed to work for a long time with a large token allowance. It does not show that the same result is economical for routine use or reachable in a normal interactive session.",
    ),
    heading("Current MirrorCode leaderboard results"),
    paragraph(
      "The Epoch AI page captured on August 5, 2026 UTC reports the maintained configuration named ",
      { emphasis: "strong", text: "MirrorCode (ML, +Private, 2L)" },
      ". It uses 15 Medium and Large target programs and excludes the Small bucket. Each target is evaluated in two implementation languages, generally Go and Ada, producing 30 tasks. Each task receives three attempts, with up to 10 billion tokens and seven days per attempt.",
    ),
    table(
      "MirrorCode solve@100% snapshot, captured August 5, 2026 UTC",
      ["Model", "Solve@100%"],
      [
        [["Claude Fable 5"], ["64%"]],
        [["GPT-5.6 Sol"], ["20%"]],
        [["GPT-5.4"], ["16%"]],
        [["GPT-5.5"], ["10%"]],
      ],
    ),
    callout(
      "Configuration matters",
      "These values belong to the dated ML, +Private, 2L leaderboard. They are not directly comparable with the ",
      { href: BLOG_SOURCES.mirrorCodePaper.url, text: "MirrorCode paper" },
      ", which evaluated all 25 targets, used six implementation languages for Small and Medium tasks, and generally used a one-billion-token budget outside the Large tasks. The paper also did not impose the current seven-day limit.",
    ),
    paragraph(
      "A model name and percentage are incomplete without the target subset, language mapping, private tasks, attempt count, token budget, and time limit. The maintained leaderboard can also change after this article's observation date.",
    ),
    heading("The gotree near-solve"),
    paragraph(
      "One run shows both the capability MirrorCode captures and the strictness of its scoring. Claude Opus 4.7 reimplemented gotree, a Go bioinformatics toolkit with roughly 16,000 lines and more than 40 commands. The run lasted 14 hours and cost $251. Epoch AI estimates that a human engineer without AI assistance would need about two to 17 weeks for the same task.",
    ),
    paragraph(
      "The replacement passed 2,000 of 2,001 tests. It failed one edge case in a niche command that manipulates date annotations. Epoch describes the implementation as near-perfect because it covered essentially all scoped functionality, but it was not a strict solve.",
    ),
    paragraph(
      "That distinction prevents a mostly working program from being reported as finished. It also exposes a limitation of a binary solve rate: the score does not show how close an unsuccessful attempt came. The gotree result counts differently from a full solve even though it demonstrates substantial autonomous engineering work.",
    ),
    heading("Data contamination remains a limitation"),
    paragraph(
      "MirrorCode targets are based on open-source programs. A model may have encountered their source, documentation, tests, or related material during pretraining. That could make reimplementation easier than work on a genuinely unseen private program.",
    ),
    paragraph(
      "The benchmark authors used a memorization screen to investigate this risk. Agents succeeded on several targets that passed the screen and failed on some targets where the screen found evidence of memorization. They interpret that pattern as evidence that memorized code did not dominate the results.",
    ),
    paragraph(
      "The screen cannot prove that training data had no influence. Epoch AI expects the measured capability to generalize to unseen codebases, but that remains an inference rather than a result directly established by MirrorCode.",
    ),
    heading("How to interpret MirrorCode"),
    paragraph(
      "MirrorCode provides evidence that leading coding agents can sustain autonomous work across complete software projects. The strongest systems can finish a meaningful share of difficult reimplementation tasks under large budgets. Near-solves such as gotree show that strict completion can understate the amount of working functionality produced.",
    ),
    paragraph(
      "The benchmark does not establish that an agent can maintain an evolving production system, collaborate with a team, resolve ambiguous product requirements, or leave code that remains easy to change. Its question is narrower: can the agent reproduce a complete program's externally tested behavior?",
    ),
    paragraph(
      "That makes MirrorCode a measure of project-scale completion rather than a general claim about maintaining an evolving production codebase.",
    ),
  ],
} as const satisfies BlogArticle;

export const blogArticles = [
  createTerminalBenchScienceArticle(),
  createSmallModelsHaveArrivedArticle(),
  createCodingAgentScoreHoldoutsArticle(),
  createOpenModelsCodingAgentsArticle(),
  createAaIndexCostArticle(),
  mirrorCodeArticle,
] as const satisfies readonly BlogArticle[];

export function blogArticlePath(slug: BlogSlug): `/blog/${BlogSlug}` {
  return `/blog/${slug}`;
}

export function getBlogArticle(slug: string): BlogArticle | undefined {
  return blogArticles.find(article => article.slug === slug);
}

export function blogArticleSection(article: BlogArticle): string {
  return article.section ?? "Coding agent benchmarks";
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function inlineText(content: InlineContent): string {
  return content.map(part => typeof part === "string" ? part : part.text).join(" ");
}

export function inlineMarkdown(content: InlineContent): string {
  return content.map((part) => {
    if (typeof part === "string") return part;
    let text = part.text;
    if (part.emphasis === "strong") text = `**${text}**`;
    if (part.emphasis === "em") text = `*${text}*`;
    if (part.href !== undefined) text = `[${text}](${part.href})`;
    return text;
  }).join("");
}

export type BlogArticleMarkdownImage = Readonly<{
  alt: string;
  caption: string;
  credit: string;
  src: string;
}>;

export function articleToMarkdown(
  article: BlogArticle,
  editorialImage?: BlogArticleMarkdownImage,
): string {
  const published = article.publishedAt === article.updatedAt
    ? article.publishedAt
    : `${article.publishedAt}, updated ${article.updatedAt}`;
  const blocks = article.body.map((block) => {
    if (block.type === "heading") {
      return `${"#".repeat(block.level)} ${block.text}`;
    }
    if (block.type === "paragraph") return inlineMarkdown(block.content);
    if (block.type === "callout") {
      return `> **${block.label}**\n>\n> ${inlineMarkdown(block.content)}`;
    }
    if (block.type === "list") {
      const marker = block.style === "ordered" ? "1." : "-";
      return block.items.map(item => `${marker} ${inlineMarkdown(item)}`).join("\n");
    }
    const header = `| ${block.columns.join(" | ")} |`;
    const divider = `| ${block.columns.map(() => "---").join(" | ")} |`;
    const rows = block.rows.map(row => `| ${row.map(inlineMarkdown).join(" | ")} |`);
    return [`*${block.caption}*`, header, divider, ...rows].join("\n");
  });
  const sources = article.sourceIds.map((sourceId) => {
    const source = BLOG_SOURCES[sourceId];
    return `- [${source.title}](${source.url}). ${source.publication}, ${source.year}. ${source.note}`;
  });
  const chartLink = article.showChartCta === false
    ? []
    : ["", `[Current coding-agent comparison](${site.origin}/)`];
  const relatedLinks = article.relatedSlugs.map((slug) => {
    const relatedArticle = getBlogArticle(slug);
    if (relatedArticle === undefined) {
      throw new Error(`Unknown related blog article: ${slug}`);
    }
    return `- [${relatedArticle.title}](${site.origin}${blogArticlePath(slug)})`;
  });
  return [
    `# ${article.title}`,
    "",
    article.dek,
    "",
    `Published ${published}.`,
    "",
    article.authorshipDisclosure,
    "",
    ...(editorialImage === undefined ? [] : [
      `![${editorialImage.alt}](${new URL(editorialImage.src, site.origin)})`,
      "",
      `*${editorialImage.caption} ${editorialImage.credit}*`,
      "",
    ]),
    ...blocks.flatMap(block => [block, ""]),
    ...(sources.length === 0 ? [] : ["## Sources", "", ...sources, ""]),
    "Reported results apply to the named source, workload, configuration, and observation date. They do not establish performance on every task or product.",
    "",
    "## Related analysis",
    "",
    ...relatedLinks,
    ...chartLink,
    "",
  ].join("\n");
}

function blockText(block: BlogBlock): string {
  if (block.type === "heading") return block.text;
  if (block.type === "paragraph" || block.type === "callout") {
    return inlineText(block.content);
  }
  if (block.type === "list") return block.items.map(inlineText).join(" ");
  return block.rows.flatMap(row => row.map(inlineText)).join(" ");
}

export function articleWordCount(article: BlogArticle): number {
  return [article.title, article.dek, ...article.body.map(blockText)]
    .join(" ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .length;
}

export function articleReadingMinutes(article: BlogArticle): number {
  return Math.max(1, Math.ceil(articleWordCount(article) / 220));
}
