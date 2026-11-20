import type { Metadata } from "next";
import entries from "./entries.json";

export { entries };
export const guide = {
  title: "Introducing aicharts",
  slug: "introducing-aicharts",
  href: "/blog/introducing-aicharts",
  summary:
    "See what a higher coding score costs. Compare the Terminal-Bench score, cost per task and output tokens behind each AI model release.",
  published: "2026-11-19",
  evergreen: true,
};
export function pageMetadata(
  title: string,
  description: string,
  path: string,
  article = false,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: article ? "article" : "website",
      title,
      description,
      url: path,
      siteName: "aicharts",
      ...(article && { publishedTime: guide.published }),
    },
    twitter: { card: "summary", title, description },
  };
}
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}
