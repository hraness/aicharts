import type { CSSProperties } from "react";

import {
  compactModelCardHarnessLabel,
  type ModelCardPresentation,
  type ModelCardStat,
} from "@/lib/model-card-presentation";

type ModelCardStyle = CSSProperties & Readonly<{
  "--model-card-color": string;
}>;

function ModelCardStatValue({ stat }: Readonly<{ stat: ModelCardStat }>) {
  if (stat.available) return stat.value;
  return (
    <>
      <span aria-hidden="true">–</span>
      <span className="model-card-visually-hidden">Not available</span>
    </>
  );
}

export function ModelCardFace({
  card,
}: Readonly<{
  card: ModelCardPresentation;
}>) {
  const serial = `${String(card.cardNumber).padStart(3, "0")} / ${String(card.totalCards).padStart(3, "0")}`;
  const sourceLabel = `${card.observationCount} ${card.observationCount === 1 ? "config" : "configs"}`;
  const harnessLabel = compactModelCardHarnessLabel(card.agentNames);
  return (
    <article
      aria-label={`${card.model}, ${card.profileLabel} model card`}
      className="model-card-face"
      data-card-class={card.cardClass}
      style={{ "--model-card-color": card.providerColor } as ModelCardStyle}
    >
      <div aria-hidden="true" className="model-card-face__grain" />
      <div className="model-card-face__border">
        <header className="model-card-face__header">
          <span className="model-card-face__provider">
            <i aria-hidden="true" />
            {card.providerName}
          </span>
          <span className="model-card-face__class">{card.classLabel}</span>
        </header>

        <div className="model-card-face__title">
          <p className="model-card-face__model">{card.model}</p>
          <p>{card.profileLabel} profile</p>
        </div>

        <div className="model-card-face__art" aria-hidden="true">
          <span className="model-card-face__orb" />
          {/* eslint-disable-next-line @next/next/no-img-element -- The pinned Lobe SVG bytes must remain identical in DOM and exported images. */}
          <img alt="" height="156" src={card.iconDataUrl} width="156" />
        </div>

        <dl className="model-card-face__performance">
          {card.performance.map(stat => (
            <div key={stat.id}>
              <dt>{stat.label}</dt>
              <dd><ModelCardStatValue stat={stat} /></dd>
            </div>
          ))}
        </dl>

        <dl className="model-card-face__economics">
          {card.economics.map(stat => (
            <div key={stat.id}>
              <dt>{stat.label}</dt>
              <dd><ModelCardStatValue stat={stat} /></dd>
            </div>
          ))}
        </dl>

        <footer className="model-card-face__footer">
          <span className="model-card-face__source">
            <span>Artificial Analysis · {card.sourceDate}</span>
            <span title={card.agentNames.join(", ")}>{harnessLabel} · {sourceLabel}</span>
          </span>
          <span>{serial}</span>
        </footer>
        <p className="model-card-face__watermark">aicharts.io</p>
      </div>
    </article>
  );
}
