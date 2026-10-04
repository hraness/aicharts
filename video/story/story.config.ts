/**
 * aicharts' launch film: benchmark claims and prices live on different pages,
 * the reveal, the real score-and-cost charts captured from aicharts.io, the
 * counts from app/launch/facts.ts, sourcing, and an end card that opens the site.
 */
import { join } from "node:path";

import { launchFacts } from "../../app/launch/facts.ts";
import { defineStory } from "./story.ts";
import palette from "./palette.json" with { type: "json" };

const here = import.meta.dir, repo = join(here, "../..");

export default () => defineStory({
  id: "aicharts",
  brand: {
    wordmark: "aicharts",
    mark: join(repo, "public/marks/aicharts.svg"),
    markAspect: 837 / 886,
    // Read with site-palette.ts from https://aicharts.io in dark mode; see palette.json.
    palette: { values: palette.palette },
    designKit: join(repo, "node_modules/@hraness/design-kit"),
  },
  acts: [
    {
      kind: "scatter", headline: "Every model claims a top score, and the prices are somewhere else.", accents: ["somewhere", "else."],
      cards: [
        { app: "Launch post", glyph: "L", color: "#f6c177", lines: ["A benchmark score", "No cost per task"] },
        { app: "Pricing page", glyph: "$", color: "#9ccfd8", lines: ["Price per token", "No score"] },
        { app: "Leaderboard", glyph: "#", color: "#c4a7e7", lines: ["A rank", "Different tasks"] },
      ],
      ghosts: ["Model card", "Changelog", "Spreadsheet", "Release notes", "Forum thread"],
    },
    { kind: "reveal", tagline: "See which model wins at each price." },
    {
      kind: "gallery", headline: "aicharts puts the score and the cost on one chart.", accents: ["one", "chart."],
      items: [
        { image: join(here, "shots/home-chart.png"), caption: `${launchFacts.intelligenceConfigs.value} model settings, by score and cost per task` },
        { image: join(here, "shots/coding-chart.png"), caption: `${launchFacts.codingConfigs.value} coding-agent setups, with cost, time and tokens` },
      ],
    },
    {
      kind: "stats", headline: "Start from the line nothing cheaper beats.", accents: ["nothing", "cheaper"],
      items: [
        { value: launchFacts.intelligenceConfigs.value, label: "model settings on the main chart" },
        { value: launchFacts.codingConfigs.value, label: "coding-agent setups" },
        { value: launchFacts.libraryEntries.value, label: "benchmarks in the library" },
      ],
    },
    {
      kind: "cards", headline: "Every point says where it came from.", accents: ["where"],
      items: [
        { tag: "Sourced", title: "Each point names its source and the day it was checked" },
        { tag: "Free", title: "The charts and notes are free to read" },
        { tag: "Your usage", title: `See your own usage from ${launchFacts.usageSources.value} sources, on your machine` },
      ],
    },
  ],
  end: { action: "Open aicharts.io", terms: "Free · No account", url: "aicharts.io" },
  formats: ["wide", "square", "portrait"],
});
