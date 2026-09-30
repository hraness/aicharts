/**
 * The film's product surface: the site's own launch mockups
 * (components/launch-mockups), the same components the homepage and the
 * launch post render, stacked on one board the camera moves across.
 *
 * Illustration only: chart points come from the site's checked snapshots;
 * usage numbers are the site's made-up example.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { ChartMockup, CollectorMockup, UsageMockup } from "../components/launch-mockups/index.tsx";

/**
 * Adds `data-film="name"` to the first element whose class list contains
 * `className`, so film.json steps can aim the camera and cursor at it.
 * Throws when the hook is missing, so a mockup change cannot silently
 * break a step.
 */
function tag(markup: string, className: string, name: string, nth = 0): string {
  const pattern = new RegExp(`<([a-z][a-z0-9]*)([^>]*\\sclass="(?:[^"]*\\s)?${className}(?:\\s[^"]*)?")`, "gu");
  let index = 0;
  const result = markup.replace(pattern, (match, element: string, attributes: string) => {
    const hit = index === nth;
    index += 1;
    return hit ? `<${element} data-film="${name}"${attributes}` : match;
  });
  if (result === markup) throw new Error(`No .${className} (#${String(nth)}) in the mockup for data-film="${name}".`);
  return result;
}

function panel(name: string, markup: string): string {
  return `<div class="film-panel" data-film="${name}">${markup}</div>`;
}

/** The board's static markup, with every `data-film` hook film.json names. */
export function productBoard(): string {
  const chart = tag(renderToStaticMarkup(<ChartMockup theme="light" view="frontier" />), "acm-frontier", "chart-best");
  const coding = tag(
    tag(renderToStaticMarkup(<ChartMockup theme="light" view="coding" />), "acm-point-ring", "coding-hover"),
    "acm-tooltip",
    "coding-tooltip",
  );
  const usage = tag(renderToStaticMarkup(<UsageMockup theme="light" />), "acm-usage__stats", "usage-stats");
  const collector = tag(renderToStaticMarkup(<CollectorMockup theme="dark" />), "hkm-terminal-line", "collector-enroll", 3);
  return `<div class="film-board">${[
    panel("chart", chart),
    panel("coding", coding),
    panel("usage", usage),
    panel("collector", collector),
  ].join("")}</div>`;
}

/** Made-up launch-announcement headlines for the cold open. No real lab or model is named. */
const CLAIMS = [
  ["Lab A", "Our best model yet"],
  ["Lab B", "State of the art on coding"],
  ["Lab C", "Tops the leaderboard"],
  ["Lab D", "Beats every rival on reasoning"],
  ["Lab E", "Best in class, again"],
  ["Lab F", "A new record on math"],
] as const;

/** A small announcement card used in the cold open collage. */
export function OpenCard({ index }: { index: number }) {
  const [lab, claim] = CLAIMS[index % CLAIMS.length]!;
  return (
    <div className="fm-card">
      <span aria-hidden="true" className="fm-avatar">{lab.at(-1)}</span>
      <div>
        <b>{lab}</b>
        <p>{claim}</p>
      </div>
    </div>
  );
}
