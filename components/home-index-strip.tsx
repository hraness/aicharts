import Link from "next/link";

import { logoCardFromIndexPage, ModelLogoCard } from "@/components/model-logo-card";
import {
  formatIntelligenceIndex,
  INDEX_MODEL_PAGES,
  INDEX_MODEL_VERSION_LABEL,
} from "@/lib/index-model-pages";

export const HOME_INDEX_STRIP_LIMIT = 4;

export function homeIndexStripPages(
  pages = INDEX_MODEL_PAGES,
  limit = HOME_INDEX_STRIP_LIMIT,
) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Home Index strip limit must be a positive integer.");
  }
  return pages.slice(0, limit);
}

export function HomeIndexStrip() {
  const pages = homeIndexStripPages();
  if (pages.length === 0) return null;
  return (
    <section
      aria-labelledby="home-index-strip-title"
      className="home-index-strip"
      data-analytics-surface="home_index_strip"
    >
      <div className="home-index-strip__heading">
        <h2 id="home-index-strip-title">Recent Intelligence Index listings</h2>
        <p>{INDEX_MODEL_VERSION_LABEL}. Scores come from the checked snapshot, not a first-party release date.</p>
      </div>
      <ul className="hraness-marketing-card-row home-index-strip__row">
        {pages.map(page => (
          <li key={page.path}>
            <Link
              aria-label={`Open ${page.displayTitle} model page. ${INDEX_MODEL_VERSION_LABEL} ${formatIntelligenceIndex(page.intelligenceIndex)}.`}
              data-card-row-item=""
              href={page.path}
            >
              <ModelLogoCard card={logoCardFromIndexPage(page)} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
