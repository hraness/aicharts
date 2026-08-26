import { site } from "../site";
import { createAaIndexCostArticle } from "./aa-index-cost-article";
import { createCodingAgentScoreHoldoutsArticle } from "./coding-agent-score-holdouts-article";
import { createCodingAgentScoresStillNeedExpertiseArticle } from "./coding-agent-scores-still-need-expertise-article";
import { createOpenModelsCodingAgentsArticle } from "./open-models-coding-agents-article";

export const BLOG_SLUGS = [
  "coding-agent-scores-still-need-expertise",
  "coding-agent-score-holdouts",
  "open-models-coding-agent-benchmarks",
  "aa-index-cost-coding-agents",
  "mirrorcode-coding-agent-benchmark",
  "slopcodebench-long-horizon-coding-agents",
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
  slopCodeBench: {
    note:
      "The paper defines SlopCodeBench, reports the 15-agent evaluation, calibrates its two static quality measures, and analyzes prompt interventions and limitations.",
    publication: "arXiv",
    title: "SlopCodeBench: Benchmarking How Coding Agents Degrade Over Long-Horizon Iterative Tasks",
    url: "https://arxiv.org/abs/2603.24755",
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
  hranessOpenModelsReading: {
    note:
      "The Hraness reading note is a dated digest of the SemiAnalysis essay, used here as a crawlable companion citation rather than a substitute for the original.",
    publication: "Hraness",
    title: "Hraness reading note: Are Open Models Catching Up?",
    url: "https://hraness.com/reading/are-open-models-catching-up",
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
  hranessBenchpocalypseReading: {
    note:
      "The Hraness reading note is a dated digest of Dan Luu’s essay, used here as a crawlable companion citation rather than a substitute for the original.",
    publication: "Hraness",
    title: "Hraness reading note: The benchmarkpocalypse",
    url: "https://hraness.com/reading/the-benchmarkpocalypse",
    year: 2026,
  },
  larsFayeExpertise: {
    note:
      "The July 22, 2026 essay argues that coding assistants demand the expertise they also prevent novices from forming, and treats generation as a leaky abstraction.",
    publication: "Lars Faye",
    title: "AI Coding will Prevent Expertise",
    url: "https://larsfaye.com/articles/ai-coding-will-prevent-expertise",
    year: 2026,
  },
  hranessFayeReading: {
    note:
      "The Hraness reading note is a dated digest of Lars Faye’s essay, used here as a crawlable companion citation rather than a substitute for the original.",
    publication: "Hraness",
    title: "Hraness reading note: AI Coding will Prevent Expertise",
    url: "https://hraness.com/reading/ai-coding-will-prevent-expertise",
    year: 2026,
  },
  seanGoedeckeExpertise: {
    note:
      "The July 24, 2026 essay argues that LLMs amplify domain expertise rather than flatten it, and that specifying and judging a result remain human constraints.",
    publication: "Sean Goedecke",
    title: "LLMs reward expertise",
    url: "https://www.seangoedecke.com/llms-reward-expertise/",
    year: 2026,
  },
  hranessGoedeckeReading: {
    note:
      "The Hraness reading note is a dated digest of Sean Goedecke’s essay, used here as a crawlable companion citation rather than a substitute for the original.",
    publication: "Hraness",
    title: "Hraness reading note: LLMs reward expertise",
    url: "https://hraness.com/reading/llms-reward-expertise",
    year: 2026,
  },
} as const satisfies Record<string, BlogSource>;

export type BlogSourceId = keyof typeof BLOG_SOURCES;

export interface BlogArticle {
  readonly body: readonly BlogBlock[];
  readonly dek: string;
  readonly focusPhrase: string;
  readonly keywords: readonly string[];
  readonly publishedAt: string;
  readonly relatedSlugs: readonly BlogSlug[];
  readonly seoDescription: string;
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
  relatedSlugs: ["slopcodebench-long-horizon-coding-agents"],
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
      "That makes MirrorCode a measure of project-scale completion. The ",
      { href: "/blog/slopcodebench-long-horizon-coding-agents", text: "SlopCodeBench results" },
      " cover a complementary question: what happens to correctness and code structure as an agent repeatedly extends its own work. Reading both separates finishing a large specification from preserving software quality over time.",
    ),
  ],
} as const satisfies BlogArticle;

const slopCodeBenchArticle = {
  slug: "slopcodebench-long-horizon-coding-agents",
  title: "SlopCodeBench: coding agents degrade on long tasks",
  dek:
    "SlopCodeBench follows agents as they repeatedly extend their own code, measuring correctness, cost, structural erosion, and verbosity at each checkpoint.",
  focusPhrase: "SlopCodeBench long-horizon coding agents",
  seoDescription:
    "SlopCodeBench follows agents through repeated code changes. Its results show low strict pass rates, rising code erosion, verbosity, and cost.",
  keywords: [
    "SlopCodeBench",
    "long-horizon coding agents",
    "coding agent benchmark",
    "AI code quality",
    "structural erosion",
    "agentic software engineering",
  ],
  publishedAt: "2026-08-04",
  updatedAt: "2026-08-04",
  sourceIds: ["slopCodeBench"],
  relatedSlugs: ["mirrorcode-coding-agent-benchmark"],
  body: [
    paragraph(
      { href: BLOG_SOURCES.slopCodeBench.url, text: "SlopCodeBench" },
      " measures how coding agents behave when they repeatedly extend software they previously wrote. The May 2026 paper evaluates 15 coding agents on 36 problems containing 196 checkpoints. Each checkpoint adds requirements to the agent's existing workspace, exposing how early design choices affect later work.",
    ),
    paragraph(
      "No evaluated agent completed every checkpoint of any problem. GPT-5.5 achieved the highest strict checkpoint solve rate at 14.8%. The paper also reports that its two targeted code-quality measures deteriorated during most trajectories while average cost per checkpoint rose as projects progressed.",
    ),
    heading("What SlopCodeBench measures"),
    paragraph(
      "Each problem begins with an empty workspace. The agent receives a specification, implements it, and carries that implementation into the next checkpoint. Later requirements can reward a flexible initial design or expose shortcuts embedded in earlier code. Problems contain three to eight checkpoints.",
    ),
    paragraph(
      "One example begins as a command-line source search tool with exact and regular-expression matching. Later checkpoints add languages, structural pattern matching, selectors, and automatic fixes. An early architecture organized around one language and one matching mode becomes part of the next checkpoint's starting state.",
    ),
    paragraph(
      "Specifications describe observable command-line or API behavior. They do not prescribe internal interfaces, structure, or architecture. Test suites remain hidden, including held-out cases beyond the examples in the specification. The task design is language-agnostic, although the paper evaluates only Python implementations because of experimental cost.",
    ),
    callout(
      "Workspace persists, conversation does not",
      "Each checkpoint starts in a fresh container with the previous workspace but no prior conversation context. The agent must understand and modify the code it left behind rather than relying on conversational memory.",
    ),
    heading("How correctness is scored"),
    paragraph(
      "A strict solve requires the workspace to pass the current checkpoint's tests and regression tests from earlier checkpoints. An isolated solve excludes earlier regression tests, helping distinguish failure on the new requirement from damage inherited from prior work. A core solve counts behavior explicitly described or demonstrated by the specification.",
    ),
    table(
      "Selected SlopCodeBench results",
      ["Measure", "Reported result"],
      [
        [["Problems completed end to end"], ["0 of 36"]],
        [["Best strict checkpoint solve rate"], ["14.8%, GPT-5.5"]],
        [["Best isolated checkpoint solve rate"], ["28.1%, GPT-5.5"]],
        [["Core pass rate, early to late"], ["64.6% to 35.5%"]],
        [["Mean cost per checkpoint, early to late"], ["2.2× increase"]],
      ],
    ),
    paragraph(
      "Across the evaluated configurations, core correctness fell from 64.6% near the beginning of a problem to 35.5% at the end. Error-handling correctness fell from 80.1% to 62.2%. Mean cost per checkpoint increased 2.2 times, while the proportion of lines changed declined from 97.4% early in a project to 29.5% late in the project.",
    ),
    paragraph(
      "This combination describes agents spending more while making increasingly localized changes to larger inherited workspaces. It does not by itself identify the cause of each failure, but it shows why a single final pass rate misses important trajectory behavior.",
    ),
    heading("How the paper measures code quality"),
    paragraph(
      "The authors define two static measures for following code changes across checkpoints: structural erosion and verbosity.",
    ),
    list(
      [
        { emphasis: "strong", text: "Structural erosion" },
        " is the share of a codebase's cyclomatic-complexity mass concentrated in functions whose complexity exceeds 10. The score rises when more control-flow complexity accumulates inside already-complex functions.",
      ],
      [
        { emphasis: "strong", text: "Verbosity" },
        " is the proportion of source lines affected by structural duplication or one of 137 targeted AST rules. The rules identify patterns such as unnecessary intermediates, redundant checks, and avoidable constructions.",
      ],
    ),
    paragraph(
      "These metrics cover concentrated complexity, duplication, and particular redundant patterns. They are not complete measures of maintainability, architecture, readability, or long-term development cost. A high score does not prove that software is unusable, and a low score does not prove that its design is sound.",
    ),
    heading("Quality deteriorates during iteration"),
    paragraph(
      "Structural erosion increased in 77% of agent trajectories and verbosity increased in 75.5%. The average number of functions with cyclomatic complexity of at least 10 rose from 3.6 to 23.7. Mean maximum cyclomatic complexity increased from 27.5 to 69.0. Structural duplication grew by 96%, while the density of other AST-rule violations changed by only 0.3%.",
    ),
    paragraph(
      "The duplication result suggests that much of the measured verbosity came from copying and extending existing structures rather than introducing new categories of violation. Iteration made small structural choices accumulate.",
    ),
    heading("Comparison with open-source Python repositories"),
    paragraph(
      "The paper calibrates its measures against 473 open-source Python repositories and 13,667 sampled commits. Agent checkpoints averaged 0.44 verbosity and 0.68 erosion. The repository panel averaged 0.19 verbosity and 0.34 erosion. Under the paper's definitions, agent code was 2.3 times more verbose and 2.0 times more eroded.",
    ),
    paragraph(
      "The trajectory comparison produced a larger gap. Agent verbosity grew about seven times faster per checkpoint than the median rate in the repository histories, while erosion grew about five times faster.",
    ),
    callout(
      "Calibration is not a matched experiment",
      "The repository panel provides a reference distribution, not a controlled comparison of equivalent tasks. Human commits reflect code review, team practices, project maturity, and development processes that differ from the benchmark environment.",
    ),
    heading("Prompting improves the starting point"),
    paragraph(
      "The researchers tested an anti-slop prompt and a plan-first prompt on GPT-5.3 Codex, GPT-5.4, and GPT-5.5. The anti-slop prompt reduced average verbosity by 27.5% to 35.6%, depending on the model, and reduced erosion by 34.3% to 57.6%. The improvement usually changed the level at which code started, not the rate at which it degraded across checkpoints.",
    ),
    paragraph(
      "The interventions introduced trade-offs. Anti-slop prompting reduced average strict correctness by 2.4 percentage points, while plan-first prompting reduced it by 3.6 points. Across the tested configurations, the modified prompts raised average cost per checkpoint by 12.1%.",
    ),
    heading("Limits on the result"),
    paragraph(
      "SlopCodeBench evaluates one implementation language, a fixed set of hand-authored problems, and a particular snapshot of models and native agent harnesses. Results can change with model updates, tools, context management, or different checkpoint designs. Hidden tests measure only the behavior encoded by the benchmark authors.",
    ),
    paragraph(
      "The quality measures are targeted static indicators, and the open-source calibration is not a matched maintenance study. These limits do not erase the observed trajectory, but they constrain claims about production codebases or maintainability as a whole.",
    ),
    heading("How to interpret SlopCodeBench"),
    paragraph(
      "SlopCodeBench identifies a gap between satisfying a current specification and preserving a codebase's capacity to absorb later changes. Current agents can pass individual checkpoints, but their prior design choices often become liabilities as requirements accumulate.",
    ),
    paragraph(
      "The benchmark supports evaluating coding agents as maintainers of evolving software, with correctness, cost, regression behavior, and structural change considered together. It does not establish a universal limit on autonomous development. It provides evidence that iterative degradation remains a distinct weakness under these long-horizon conditions.",
    ),
    paragraph(
      "For a complementary view of project-scale completion, read the ",
      { href: "/blog/mirrorcode-coding-agent-benchmark", text: "MirrorCode benchmark summary" },
      ". MirrorCode asks whether an agent can reproduce a complete program under strict behavioral tests, while SlopCodeBench asks what happens as the agent repeatedly changes the code it chose to build.",
    ),
  ],
} as const satisfies BlogArticle;

export const blogArticles = [
  createCodingAgentScoresStillNeedExpertiseArticle(),
  createCodingAgentScoreHoldoutsArticle(),
  createOpenModelsCodingAgentsArticle(),
  createAaIndexCostArticle(),
  mirrorCodeArticle,
  slopCodeBenchArticle,
] as const satisfies readonly BlogArticle[];

export function blogArticlePath(slug: BlogSlug): `/blog/${BlogSlug}` {
  return `/blog/${slug}`;
}

export function getBlogArticle(slug: string): BlogArticle | undefined {
  return blogArticles.find(article => article.slug === slug);
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

export function articleToMarkdown(article: BlogArticle): string {
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
  return [
    `# ${article.title}`,
    "",
    article.dek,
    "",
    `Published ${published}.`,
    "",
    ...blocks.flatMap(block => [block, ""]),
    "## Sources",
    "",
    ...sources,
    "",
    "Results describe the named model, harness, task set, budget, and evaluation version. They do not establish performance on every production repository.",
    "",
    `[Current coding-agent comparison](${site.origin}/)`,
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
