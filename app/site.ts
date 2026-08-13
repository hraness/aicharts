export const site = {
  description: "Compare AI coding agents across benchmark performance, cost, runtime, and token use.",
  domain: "codingchart.com",
  emoji: "◉",
  name: "CodingChart",
  origin: "https://codingchart.com",
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
    alt: "CodingChart comparison of AI coding models and coding agents",
    path: "/opengraph-image",
  },
  title: "CodingChart — Compare AI Coding Models and Agents",
} as const;
