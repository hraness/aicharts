// Canonical public identity lines come from the portfolio messaging record
// for `aicharts` (hraness/jungle registry, commit a9988b903).
export const site = {
  category: "AI model comparison charts",
  description: "AI Charts plots published AI benchmark scores against cost and tokens per task, and a local collector measures your own agents' token use.",
  domain: "aicharts.io",
  emoji: "◉",
  introduction: "Picking a model means guessing at a tradeoff between quality and price, because benchmark scores and prices live in different places. AI Charts plots published benchmark scores against cost and tokens per task on one chart, so the strongest option at each budget is visible instead of implied. A local collector measures your own agents' token use, so the cost question covers your work, not only the models. AI Charts is free and open source.",
  name: "AI Charts",
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
    alt: "AI Charts: See which model wins at each price.",
    path: "/opengraph-image",
  },
  title: "AI Charts | See which model wins at each price.",
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
export const modelCardsHeading = "Models";
export const modelCardsLede =
  "Model pages from the current Artificial Analysis snapshots, with Intelligence Index scores, cost per task, and coding-agent results where they exist.";
export const modelCardsEyebrow = "Model pages";
export const modelCardsTitle = "AI models | AI Charts";
export const modelCardsDescription =
  "Pages for AI models and their coding-agent profiles, with Artificial Analysis Intelligence Index scores, costs, and coding-agent results where they exist.";

/** Social and search copy for one model page; keep title and description paired. */
export function modelCardTitle(displayTitle: string): string {
  return `${displayTitle} | AI Charts`;
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
  title: "Page not found | AI Charts",
} as const;

export const notFoundRecoveryLinks = [
  { href: "/", label: "Charts" },
  { href: "/models", label: "Models" },
  { href: "/data", label: "Data" },
  { href: "/blog", label: "Notes" },
  { href: "/llms.txt", label: "Site guide" },
  { href: "/sitemap.xml", label: "Sitemap" },
] as const;
