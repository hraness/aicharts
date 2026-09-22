import { blogArticlePath, blogArticles } from "@/app/blog/articles";

import {
  formatIntelligenceCost,
  formatIntelligenceIndex,
  INDEX_MODEL_PAGES,
  INDEX_MODEL_SNAPSHOT,
  intelligenceObservationForCard,
} from "./index-model-pages";
import { MODEL_CARD_PRESENTATIONS } from "./model-card-collection";
import { isoCalendarDateToUtcDate } from "./iso-calendar-date";

export const HOME_ACTIVITY_FEED_LIMIT = 8;
export const HOME_ACTIVITY_NOTE_LIMIT = 3;
export const HOME_ACTIVITY_MODEL_LIMIT = 6;

export type HomeActivityItem = Readonly<{
  detail: string;
  href: string;
  id: string;
  kind: "model" | "note";
  occurredOn: string;
  title: string;
}>;

function compareOccurredOn(left: HomeActivityItem, right: HomeActivityItem): number {
  return right.occurredOn < left.occurredOn
    ? -1
    : right.occurredOn > left.occurredOn
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;
}

function calendarDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Home activity date must be a valid timestamp.");
  }
  return date.toISOString().slice(0, 10);
}

function recentNoteItems(): readonly HomeActivityItem[] {
  return [...blogArticles]
    .map(article => ({
      detail: article.dek,
      href: blogArticlePath(article.slug),
      id: `note:${article.slug}`,
      kind: "note" as const,
      occurredOn: calendarDate(article.updatedAt),
      title: article.title,
    }))
    .sort(compareOccurredOn)
    .slice(0, HOME_ACTIVITY_NOTE_LIMIT);
}

function modelFeedDetail(
  index: number,
  costUsdPerTask: number | null,
  providerName: string,
): string {
  const cost = costUsdPerTask === null
    ? "cost not reported"
    : `${formatIntelligenceCost(costUsdPerTask)} per task`;
  return `${providerName} · Index ${formatIntelligenceIndex(index)} · ${cost}`;
}

function recentModelItems(): readonly HomeActivityItem[] {
  const indexOnly = INDEX_MODEL_PAGES.map(page => ({
    detail: modelFeedDetail(page.intelligenceIndex, page.costUsdPerTask, page.providerName),
    href: page.path,
    id: `model:${page.canonicalModelId}`,
    kind: "model" as const,
    occurredOn: page.releaseDate,
    title: page.displayTitle,
  }));
  const fromCards = MODEL_CARD_PRESENTATIONS.flatMap(card => {
    const observation = intelligenceObservationForCard(card);
    if (observation === undefined) return [];
    if (isoCalendarDateToUtcDate(observation.releaseDate) === null) return [];
    return [{
      detail: modelFeedDetail(
        observation.intelligenceIndex,
        observation.costUsdPerTask?.total ?? null,
        card.providerName,
      ),
      href: card.path,
      id: `model:${card.canonicalModelId}:${card.profileSlug}`,
      kind: "model" as const,
      occurredOn: observation.releaseDate,
      title: observation.release.name,
    }];
  });
  const newestByTitle = new Map<string, HomeActivityItem>();
  for (const item of [...indexOnly, ...fromCards]) {
    const existing = newestByTitle.get(item.title);
    if (existing === undefined || item.occurredOn > existing.occurredOn) {
      newestByTitle.set(item.title, item);
    }
  }
  return [...newestByTitle.values()]
    .sort(compareOccurredOn)
    .slice(0, HOME_ACTIVITY_MODEL_LIMIT);
}

export function homeActivityFeed(
  limit = HOME_ACTIVITY_FEED_LIMIT,
): readonly HomeActivityItem[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Home activity feed limit must be a positive integer.");
  }
  return [...recentModelItems(), ...recentNoteItems()]
    .sort(compareOccurredOn)
    .slice(0, limit);
}

export const HOME_ACTIVITY_FEED = homeActivityFeed();

export const HOME_ACTIVITY_SOURCE_LABEL = (
  `${INDEX_MODEL_SNAPSHOT.benchmark.name} v${INDEX_MODEL_SNAPSHOT.benchmark.version}`
);
