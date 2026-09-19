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
  title: "AI Model & Agent Comparison Charts | AI Charts",
} as const;

export const homeHeading = "Compare AI models";
export const homeLede =
  "Understand the tradeoff between capability and cost.";
export const homeTaskLinks = [
  { task: "coding", name: "Coding", description: "Build, debug, and work in a terminal." },
  { task: "reasoning", name: "Reasoning", description: "Solve unfamiliar problems." },
  { task: "research", name: "Research", description: "Find and synthesize evidence." },
  { task: "image", name: "Images", description: "Generate and edit images." },
  { task: "video", name: "Video", description: "Create video from text or images." },
  { task: "audio", name: "Audio", description: "Transcribe and understand speech." },
] as const;
export const modelCardsHeading = "Every model, on a card";
export const modelCardsLede =
  "Shareable benchmark cards built from the same records as the charts, with the model, harness, and reasoning profile attached.";
export const modelCardsEyebrow = "Benchmark cards";
export const modelCardsTitle = "AI Model Benchmark Cards | AI Charts";
export const modelCardsDescription =
  "Shareable model trading cards for the current Artificial Analysis coding-agent benchmark snapshot.";

/** Social and search copy for one model card page; keep title and description paired. */
export function modelCardTitle(displayTitle: string): string {
  return `${displayTitle} Benchmark Card | AI Charts`;
}

export function modelCardDescription(displayTitle: string): string {
  return `${displayTitle} with available observed coding-agent benchmark, cost, time, and total-token ranges from Artificial Analysis.`;
}

export const notFoundSearchSite = {
  ...searchSite,
  description: "This page does not exist. Return to the chart.",
  title: "Page not found | AI Charts",
} as const;

export const notFoundRecoveryLinks = [
  { href: "/", label: "Comparison chart" },
  { href: "/models", label: "Model cards" },
  { href: "/data", label: "Dataset" },
  { href: "/blog", label: "Benchmark analysis" },
  { href: "/llms.txt", label: "Site guide" },
  { href: "/sitemap.xml", label: "Sitemap" },
] as const;
