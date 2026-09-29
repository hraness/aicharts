// Canonical public identity lines come from the portfolio messaging record
// for `aicharts` (hraness/jungle registry, commit a9988b903).
export const site = {
  category: "AI model comparison charts",
  description: "aicharts plots published AI benchmark scores against cost and tokens per task, and a local collector measures your own agents' token use.",
  domain: "aicharts.io",
  emoji: "◉",
  introduction: "Picking a model means guessing at a tradeoff between quality and price, because benchmark scores and prices live in different places. aicharts plots published benchmark scores against cost and tokens per task on one chart, so the strongest option at each budget is visible instead of implied. A local collector measures your own agents' token use, so the cost question covers your work, not only the models. aicharts is free and open source.",
  name: "aicharts",
  origin: "https://aicharts.io",
  palette: {
    chromatic: { key: "#5e2e02", support: "#fefefd" },
    tonal: { highlight: "#e1e0e0", shadow: "#291201" },
  },
  tagline: "See which model wins at each price.",
} as const;

export const searchSite = {
  description: site.description,
  name: site.name,
  origin: site.origin,
  socialImage: {
    alt: "aicharts: Model benchmark scores plotted against cost and tokens per task",
    path: "/opengraph-image",
  },
  title: "aicharts: AI model benchmark scores vs cost per task",
} as const;

export const homeEyebrow = site.category;
export const homeHeading = site.tagline;
export const homeLede =
  "Benchmark scores plotted against cost and tokens per task, plus a local collector for your own agents' token use.";
export const homePrimaryAction = { href: "/#intelligence-index", label: "Browse the charts" } as const;
export const homeSecondaryAction = { href: "/usage", label: "Measure your agent" } as const;
export const homeTaskLinks = [
  { task: "coding", name: "Coding", description: "Build, debug, and work in a terminal." },
  { task: "reasoning", name: "Reasoning", description: "Solve unfamiliar problems." },
  { task: "research", name: "Research", description: "Find and synthesize evidence." },
  { task: "image", name: "Images", description: "Generate and edit images." },
  { task: "video", name: "Video", description: "Create video from text or images." },
  { task: "audio", name: "Audio", description: "Transcribe and understand speech." },
] as const;
/** The collector's latest GitHub release; link it instead of typing a version number. */
export const usageReleaseUrl = "https://github.com/hraness/aicharts/releases/latest";

export const homeAboutHeading = "About aicharts";
/** The date the comparison facts below were last checked against each product's own pages. */
export const homeAlternativesCheckedOn = "2026-09-28";
export const homeAlternativesLead = "Other places to compare models:";
/** Each entry renders as a linked name followed by its sentence, in HTML, Markdown, and the README. */
export const homeAlternatives = [
  {
    href: "https://artificialanalysis.ai/leaderboards/models",
    name: "Artificial Analysis",
    sentence: " runs the Intelligence Index and Coding Agent Index charted here, and its own leaderboards cover more than 250 models with speed and latency.",
  },
  {
    href: "https://arena.ai",
    name: "Arena",
    sentence: " (formerly LMArena) ranks models by people's votes in blind side-by-side chats.",
  },
  {
    href: "https://epoch.ai/benchmarks",
    name: "Epoch AI",
    sentence: " runs its own benchmarks and tracks how capabilities change over time.",
  },
  {
    href: "https://openrouter.ai/rankings",
    name: "OpenRouter",
    sentence: " lists live API prices and which models its users send the most tokens to.",
  },
] as const;
export const homeAlternativesClosing =
  "aicharts puts published scores against cost per task, draws the best score at each budget, and keeps each benchmark on its own scale.";

const checkedOnFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

/** Formats an ISO calendar date such as 2026-09-28 as "Sep 28, 2026". */
export function formatCheckedOn(isoDate: string): string {
  return checkedOnFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

export const homeAlternativesCheckedLabel = `Checked ${formatCheckedOn(homeAlternativesCheckedOn)}.`;

export const modelCardsHeading = "Models";
export const modelCardsLede =
  "Model pages from the current Artificial Analysis snapshots, with Intelligence Index scores, cost per task, and coding-agent results where they exist.";
export const modelCardsEyebrow = "Model pages";
export const modelCardsTitle = "AI models | aicharts";
export const modelCardsDescription =
  "Pages for AI models and their coding-agent profiles, with Artificial Analysis Intelligence Index scores, costs, and coding-agent results where they exist.";

/** Social and search copy for one model page; keep title and description paired. */
export function modelCardTitle(displayTitle: string): string {
  return `${displayTitle}: benchmarks and cost per task | aicharts`;
}

/** Coding-agent profile pages: every one has coding-agent observations. */
export function modelCardDescription(displayTitle: string): string {
  return `${displayTitle} on the Artificial Analysis coding-agent chart, with scores, cost, time, and tokens per task for each agent harness.`;
}

/** Index-only pages exist only for models without coding-agent observations, so the description names only the Index result. */
export function indexModelPageDescription(page: Readonly<{
  displayTitle: string;
  score: string;
  sourceName: string;
  cost: string | null;
}>): string {
  return `${page.displayTitle} scores ${page.score} on the ${page.sourceName}${page.cost === null ? "" : `, at ${page.cost} per task`}.`;
}

export const notFoundSearchSite = {
  ...searchSite,
  description: "This page does not exist. Return to the chart.",
  title: "Page not found | aicharts",
} as const;

export const notFoundRecoveryLinks = [
  { href: "/", label: "Charts" },
  { href: "/models", label: "Models" },
  { href: "/data", label: "Data" },
  { href: "/blog", label: "Notes" },
  { href: "/llms.txt", label: "Site guide" },
  { href: "/sitemap.xml", label: "Sitemap" },
] as const;
