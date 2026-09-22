import type { CSSProperties } from "react";

import {
  formatModelCardReleaseDate,
  modelCardReleaseAccessibleLabel,
  modelCardReleaseLabel,
  type ModelCardPresentation,
  type ModelCardRelease,
} from "@/lib/model-card-presentation";
import {
  formatIntelligenceIndex,
  type IndexModelPage,
} from "@/lib/index-model-pages";

type ModelLogoCardStyle = CSSProperties & Readonly<{
  "--model-card-color": string;
}>;

export type ModelLogoCardView = Readonly<{
  displayTitle: string;
  iconDataUrl: string;
  providerColor: string;
  providerName: string;
  release: ModelCardRelease | Readonly<{
    observedOn: string;
    status: "index-observed";
  }>;
  secondaryLine: string;
  statLabel: string;
  statValue: string;
}>;

function ModelLogoRelease({
  release,
}: Readonly<{ release: ModelLogoCardView["release"] }>) {
  if (release.status === "verified") {
    return (
      <time
        aria-label={modelCardReleaseAccessibleLabel(release)}
        className="model-logo-card__release"
        dateTime={release.releasedOn}
        title={modelCardReleaseAccessibleLabel(release)}
      >
        <span>{modelCardReleaseLabel(release)}</span>
        <span>{formatModelCardReleaseDate(release.releasedOn)}</span>
      </time>
    );
  }
  if (release.status === "index-observed") {
    const label = `First listed on the Intelligence Index on ${formatModelCardReleaseDate(release.observedOn)}. This is the snapshot date, not a verified first-party release date.`;
    return (
      <time
        aria-label={label}
        className="model-logo-card__release"
        dateTime={release.observedOn}
        title={label}
      >
        <span>On Index</span>
        <span>{formatModelCardReleaseDate(release.observedOn)}</span>
      </time>
    );
  }
  return (
    <span
      aria-label={modelCardReleaseAccessibleLabel(release)}
      className="model-logo-card__release"
      title={modelCardReleaseAccessibleLabel(release)}
    >
      <span>{modelCardReleaseLabel(release)}</span>
      <span>Verifying</span>
    </span>
  );
}

export function logoCardFromPresentation(card: ModelCardPresentation): ModelLogoCardView {
  const index = card.performance.find(stat => stat.id === "aaIndex");
  return {
    displayTitle: card.displayTitle,
    iconDataUrl: card.iconDataUrl,
    providerColor: card.providerColor,
    providerName: card.providerName,
    release: card.release,
    secondaryLine: card.harnessLabel,
    statLabel: index?.label ?? "AAI",
    statValue: index?.available === true ? index.value : "–",
  };
}

export function logoCardFromIndexPage(page: IndexModelPage): ModelLogoCardView {
  return {
    displayTitle: page.displayTitle,
    iconDataUrl: page.iconDataUrl,
    providerColor: page.providerColor,
    providerName: page.providerName,
    release: { observedOn: page.releaseDate, status: "index-observed" },
    secondaryLine: page.sourceName,
    statLabel: "Index",
    statValue: formatIntelligenceIndex(page.intelligenceIndex),
  };
}

export function ModelLogoCard({
  card,
}: Readonly<{
  card: ModelLogoCardView;
}>) {
  return (
    <div
      className="model-logo-card"
      style={{ "--model-card-color": card.providerColor } as ModelLogoCardStyle}
    >
      <header className="model-logo-card__header">
        <span className="model-logo-card__provider">{card.providerName}</span>
        <ModelLogoRelease release={card.release} />
      </header>
      <div className="model-logo-card__art hraness-marketing-card__art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- The pinned SVG bytes must remain identical in DOM and exported images. */}
        <img alt="" height="128" src={card.iconDataUrl} width="128" />
      </div>
      <div className="model-logo-card__title">
        <p className="model-logo-card__model">{card.displayTitle}</p>
        <p className="model-logo-card__secondary">{card.secondaryLine}</p>
      </div>
      <p className="model-logo-card__stat">
        <span>{card.statLabel}</span>
        <strong>{card.statValue}</strong>
      </p>
    </div>
  );
}
