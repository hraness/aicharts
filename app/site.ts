export const site = {
  description: "Explore AI model benchmarks and local token usage tools. Compare published results, costs, and configurations, and inspect your own coding-agent sessions.",
  domain: "aicharts.io",
  emoji: "◉",
  name: "AI Charts",
  origin: "https://aicharts.io",
  palette: {
    chromatic: { key: "#5e2e02", support: "#fefefd" },
    tonal: { highlight: "#e1e0e0", shadow: "#291201" },
  },
} as const;

export const searchSite = {
  description: site.description,
  name: site.name,
  origin: site.origin,
  socialImage: {
    alt: "AI Charts comparison of AI models and agents",
    path: "/opengraph-image",
  },
  title: "AI model and agent comparison charts | AI Charts",
} as const;

export const homeHeading = "Compare AI models";
export const homeLede =
  "The chart plots model configurations by Intelligence Index score against cost or output tokens per task.";
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
