export const site = {
  description: "Explore AI benchmark charts for coding, reasoning, research, memory, images, video, and world models. Compare published results, costs, and configurations.",
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
  "Capability, cost, and token use. Explore the Pareto frontier and inspect the configuration behind each point.";
export const modelCardsHeading = "Every model, on a card";
export const modelCardsLede =
  "Shareable benchmark cards built from the same records as the charts, with the model, harness, and reasoning profile attached.";

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
