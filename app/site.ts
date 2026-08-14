export const site = {
  description: "Compare AI coding models and agents across benchmark performance, API cost, task time, and token use.",
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
    alt: "AI Charts comparison of AI coding models and coding agents",
    path: "/opengraph-image",
  },
  title: "AI Charts: Compare AI Coding Models and Agents",
} as const;
