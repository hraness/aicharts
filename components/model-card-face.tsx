import type { CSSProperties } from "react";

import {
  type ModelCardPresentation,
  type ModelCardStat,
} from "@/lib/model-card-presentation";

import {
  ModelCardIllumination,
  type ModelCardIlluminationMode,
} from "./model-card-illumination";

type ModelCardStyle = CSSProperties & Readonly<{
  "--model-card-color": string;
  "--model-card-secondary": string;
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
  illuminationMode = "full",
}: Readonly<{
  card: ModelCardPresentation;
  illuminationMode?: ModelCardIlluminationMode;
}>) {
  const serial = `${String(card.cardNumber).padStart(3, "0")} / ${String(card.totalCards).padStart(3, "0")}`;
  return (
    <div
      className="model-card-face"
      data-card-class={card.visualClass}
      style={{
        "--model-card-color": card.providerColor,
        "--model-card-secondary": card.secondaryColor,
      } as ModelCardStyle}
    >
      <div aria-hidden="true" className="model-card-face__grain" />
      <div className="model-card-face__border">
        <header className="model-card-face__header">
          <span className="model-card-face__provider">
            <i aria-hidden="true" />
            {card.providerName}
          </span>
        </header>

        <div className="model-card-face__title">
          <p className="model-card-face__model">{card.displayTitle}</p>
          <p className="model-card-face__harness" title={card.agentNames.join(", ")}>{card.harnessLabel}</p>
        </div>

        <div className="model-card-face__art" aria-hidden="true">
          <ModelCardIllumination card={card} mode={illuminationMode} />
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
          <span className="model-card-face__watermark">aicharts.io</span>
          <span>{serial}</span>
        </footer>
      </div>
    </div>
  );
}
