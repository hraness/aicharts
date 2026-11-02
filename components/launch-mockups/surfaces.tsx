import { BrowserFrame } from "@hraness/design-kit/mockups";

import {
  LIBRARY_CATEGORY_LABELS,
  LIBRARY_COVERAGE_LABELS,
  LIBRARY_ENTRIES,
} from "./data";

type Themed = Readonly<{ theme?: "light" | "dark" }>;
type DataEntryCategory = "coding" | "reasoning";

function themeProps(theme: Themed["theme"]) {
  return theme === undefined ? {} : { theme };
}

/* ------------------------------------------------------------------ */
/* Benchmarks library                                                  */
/* ------------------------------------------------------------------ */

/** Categories in the order the library lists them, with how many entries each holds. */
function libraryCategories(entries: typeof LIBRARY_ENTRIES) {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts.entries()];
}

/** One entry of each coverage level, so the card grid shows all three labels. */
function libraryCards(entries: typeof LIBRARY_ENTRIES) {
  const picks = [
    entries.find((entry) => entry.coverage === "charted" && entry.category === "coding"),
    entries.find((entry) => entry.coverage === "charted" && entry.category === "reasoning"),
    entries.find((entry) => entry.coverage === "source-only"),
    entries.find((entry) => entry.coverage === "watchlist"),
  ];
  return picks.filter((entry) => entry !== undefined);
}

export function LibraryMockup({ chartedOnly = false, theme }: Themed & Readonly<{ chartedOnly?: boolean }>) {
  const entries = chartedOnly ? LIBRARY_ENTRIES.filter(entry => entry.coverage === "charted") : LIBRARY_ENTRIES;
  return (
    <BrowserFrame
      {...themeProps(theme)}
      className="acm"
      describe={chartedOnly
        ? "Illustration of charted results in the aicharts benchmarks library, grouped by topic."
        : "Illustration of the aicharts benchmarks library: topics down the side, and entries tagged charted, source guide or emerging."}
      url="aicharts.example/benchmarks"
    >
      <div className="acm-library">
        <ul aria-hidden="true" className="acm-library__topics">
          {libraryCategories(entries).map(([category, count], index) => (
            <li data-acm-active={index === 0 ? "" : undefined} key={category}>
              <span>{LIBRARY_CATEGORY_LABELS[category] ?? category}</span>
              <b>{count}</b>
            </li>
          ))}
        </ul>
        <div aria-hidden="true" className="acm-library__cards">
          {libraryCards(entries).map((entry) => (
            <article className="acm-card" data-acm-coverage={entry.coverage} key={entry.id}>
              <span className="acm-badge">{LIBRARY_COVERAGE_LABELS[entry.coverage]}</span>
              <strong>{entry.name}</strong>
              <p>{entry.question}</p>
              <small>{entry.source.name} · v{entry.version}</small>
            </article>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Data page entry                                                      */
/* ------------------------------------------------------------------ */

export function DataEntryMockup({ category = "coding", theme }: Themed & Readonly<{ category?: DataEntryCategory }>) {
  const entry = LIBRARY_ENTRIES.find((candidate) => candidate.coverage === "charted" && candidate.category === category) ?? LIBRARY_ENTRIES[0];
  if (entry === undefined) throw new Error("The benchmarks library is empty.");
  const rows: readonly (readonly [string, string])[] = [
    ["Question", entry.question],
    ["Measures", entry.measure],
    ["Source", entry.source.name],
    ["Version", entry.version],
    ["Compare", entry.comparisonRule],
    ["Limits", entry.limitations[0] ?? ""],
  ];
  return (
    <BrowserFrame
      {...themeProps(theme)}
      className="acm"
      describe="Illustration of one entry on the aicharts data page: the question it answers, what it measures, source, version, valid comparisons and limits."
      url="aicharts.example/data"
    >
      <div aria-hidden="true" className="acm-entry">
        <div className="acm-entry__head">
          <span className="acm-badge" data-acm-coverage={entry.coverage}>{LIBRARY_COVERAGE_LABELS[entry.coverage]}</span>
          <strong>{entry.name}</strong>
          <span className="acm-entry__download">JSON ↓</span>
        </div>
        <dl>
          {rows.map(([term, value]) => (
            <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </div>
    </BrowserFrame>
  );
}
