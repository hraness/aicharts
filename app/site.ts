export const site = {
  description: "Compare AI models and agents with sourced benchmark charts across performance, cost, speed, and token use. Explore trade-offs, trends, and analysis.",
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

export const homeHeading = "AI model and agent comparison charts";

export const notFoundSearchSite = {
  ...searchSite,
  description: "This page does not exist. Return to the chart.",
  title: "Page not found | AI Charts",
} as const;

export const notFoundRecoveryLinks = [
  { href: "/", label: "Comparison chart" },
  { href: "/data", label: "Dataset" },
  { href: "/blog", label: "Benchmark analysis" },
  { href: "/llms.txt", label: "Site guide" },
  { href: "/sitemap.xml", label: "Sitemap" },
] as const;
