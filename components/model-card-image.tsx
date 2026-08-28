import type { CSSProperties } from "react";

import { modelCardSecondaryColors } from "@/lib/model-card-art-direction";
import {
  formatModelCardListingDate,
  modelCardListingAccessibleLabel,
  type ModelCardPresentation,
} from "@/lib/model-card-presentation";

import { ModelCardIllumination } from "./model-card-illumination";

const imageStyles = {
  column: { display: "flex", flexDirection: "column" },
  row: { display: "flex", flexDirection: "row" },
} satisfies Readonly<Record<string, CSSProperties>>;

function foilImageGradient(preset: ModelCardPresentation["foilPreset"]): string {
  if (preset === "max") {
    return "linear-gradient(118deg, rgba(255,226,128,.08) 8%, rgba(255,249,205,.38) 33%, rgba(194,132,35,.13) 54%, rgba(255,239,170,.3) 76%, rgba(111,70,8,.08) 100%)";
  }
  if (preset === "fast") {
    return "linear-gradient(132deg, rgba(58,213,255,.28) 0%, rgba(106,99,255,.1) 27%, rgba(255,77,190,.31) 48%, rgba(255,226,91,.12) 69%, rgba(75,255,184,.25) 100%)";
  }
  if (preset === "aurora") {
    return "radial-gradient(circle at 24% 18%, rgba(87,255,205,.28), transparent 38%), radial-gradient(circle at 84% 65%, rgba(139,79,255,.32), transparent 43%)";
  }
  if (preset === "prism") {
    return "linear-gradient(125deg, rgba(255,82,140,.23) 0%, rgba(255,196,77,.08) 23%, rgba(77,255,206,.25) 46%, rgba(71,139,255,.12) 69%, rgba(201,85,255,.28) 100%)";
  }
  return "linear-gradient(112deg, rgba(255,255,255,.03) 12%, rgba(255,255,255,.24) 38%, rgba(255,255,255,.04) 49%, rgba(255,255,255,.18) 72%, rgba(255,255,255,.02) 88%)";
}

function compactImageLabel(value: string, maximumCharacters: number): string {
  const normalized = value.trim();
  if (normalized.length <= maximumCharacters) return normalized;
  return `${normalized.slice(0, maximumCharacters - 1).trimEnd()}…`;
}

function Stat({ label, value, compact }: Readonly<{ compact?: boolean; label: string; value: string }>) {
  return (
    <div style={{
      ...imageStyles.column,
      background: "rgba(5, 6, 8, .58)",
      border: "1px solid rgba(255,255,255,.13)",
      borderRadius: compact ? 10 : 22,
      flex: 1,
      minWidth: 0,
      padding: compact ? "9px 10px" : "18px 17px",
    }}>
      <span style={{ color: "rgba(247,246,242,.62)", fontSize: compact ? 12 : 24, letterSpacing: ".08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: compact ? 17 : 31, fontWeight: 700, marginTop: compact ? 4 : 9, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function ModelCardImageListing({
  card,
  compact = false,
}: Readonly<{
  card: ModelCardPresentation;
  compact?: boolean;
}>) {
  if (card.listing === null) return null;
  return (
    <time
      aria-label={modelCardListingAccessibleLabel(card.listing)}
      dateTime={card.listing.sourceAddedAt}
      style={{
        ...imageStyles.column,
        alignItems: "flex-end",
        flex: "0 0 auto",
        lineHeight: 1,
        textAlign: "right",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "rgba(247,246,242,.48)", fontSize: compact ? 6 : 14, letterSpacing: ".11em" }}>
        {compact ? "OpenRouter" : "Listed on OpenRouter"}
      </span>
      <span style={{ color: "rgba(247,246,242,.84)", fontFamily: "monospace", fontSize: compact ? 9 : 21, letterSpacing: ".045em", marginTop: compact ? 4 : 8 }}>
        {formatModelCardListingDate(card.listing.sourceAddedAt)}
      </span>
    </time>
  );
}

export function ModelCardRasterFace({
  card,
  compact = false,
}: Readonly<{
  card: ModelCardPresentation;
  compact?: boolean;
}>) {
  const padding = compact ? 19 : 50;
  const radius = compact ? 24 : 56;
  const serial = `${String(card.cardNumber).padStart(3, "0")} / ${String(card.totalCards).padStart(3, "0")}`;
  const modelLabel = compactImageLabel(card.displayTitle, compact ? 34 : 48);
  const providerLabel = compactImageLabel(card.providerName, compact ? 10 : 24);
  const harnessLabel = compactImageLabel(card.harnessLabel, compact ? 30 : 44);
  return (
    <div style={{
      ...imageStyles.column,
      background: `${foilImageGradient(card.foilPreset)}, radial-gradient(circle at 72% 20%, ${card.providerColor}70 0%, transparent 38%), radial-gradient(circle at 14% 78%, ${card.secondaryColor}30 0%, transparent 34%), linear-gradient(145deg, ${card.providerColor}36 0%, #090a0c 54%, #111216 100%)`,
      border: `${compact ? 2 : 4}px solid ${card.providerColor}b8`,
      borderRadius: radius,
      color: "#f7f6f2",
      fontFamily: "Nebula Sans",
      height: "100%",
      overflow: "hidden",
      padding,
      position: "relative",
      width: "100%",
    }}>
      <div style={{ background: "linear-gradient(112deg, transparent 8%, rgba(255,255,255,.10) 31%, transparent 43%, rgba(255,255,255,.05) 68%, transparent 86%)", inset: 0, position: "absolute" }} />
      <div style={{
        ...imageStyles.column,
        flex: 1,
        padding: compact ? 23 : 47,
        position: "relative",
      }}>
        <div style={{ ...imageStyles.row, alignItems: "center", gap: compact ? 7 : 16, justifyContent: "space-between" }}>
          <span style={{ ...imageStyles.row, alignItems: "center", flex: 1, fontSize: compact ? 13 : 27, fontWeight: 700, letterSpacing: ".08em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            <i style={{ background: card.providerColor, border: `${compact ? 1 : 2}px solid ${card.secondaryColor}`, borderRadius: 999, boxShadow: `0 0 ${compact ? 7 : 14}px ${card.providerColor}aa`, height: compact ? 8 : 17, marginRight: compact ? 8 : 16, width: compact ? 8 : 17 }} />
            {providerLabel}
          </span>
          <ModelCardImageListing card={card} compact={compact} />
        </div>

        <div style={{ ...imageStyles.column, marginTop: compact ? 16 : 34 }}>
          <span style={{ fontSize: compact ? 36 : 74, fontWeight: 780, letterSpacing: "-.05em", lineHeight: .94 }}>
            {modelLabel}
          </span>
          <span style={{ color: "rgba(247,246,242,.72)", fontSize: compact ? 15 : 31, marginTop: compact ? 9 : 18 }}>
            {harnessLabel}
          </span>
        </div>

        <div style={{
          ...imageStyles.row,
          alignItems: "center",
          background: `radial-gradient(circle, ${card.providerColor}4d 0%, transparent 66%)`,
          border: "1px solid rgba(255,255,255,.13)",
          borderRadius: compact ? 17 : 36,
          flex: 1,
          justifyContent: "center",
          margin: compact ? "15px 0" : "31px 0",
          minHeight: compact ? 48 : 0,
          overflow: "hidden",
          position: "relative",
        }}>
          <ModelCardIllumination card={card} />
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse consumes a pinned SVG data URL. */}
          <img alt="" height={compact ? 132 : 300} src={card.iconDataUrl} style={{ objectFit: "contain", position: "relative" }} width={compact ? 132 : 300} />
        </div>

        <div style={{ ...imageStyles.row, gap: compact ? 6 : 13 }}>
          {card.performance.map(stat => <Stat compact={compact} key={stat.id} label={stat.label} value={stat.value} />)}
        </div>
        <div style={{ ...imageStyles.row, gap: compact ? 6 : 13, marginTop: compact ? 7 : 14 }}>
          {card.economics.map(stat => <Stat compact={compact} key={stat.id} label={stat.label} value={stat.value} />)}
        </div>

        <div style={{ ...imageStyles.row, alignItems: "center", color: "rgba(247,246,242,.62)", fontSize: compact ? 11 : 22, justifyContent: "space-between", marginTop: compact ? 12 : 24 }}>
          <span style={{ color: "#f7f6f2", fontSize: compact ? 15 : 30, fontWeight: 750, letterSpacing: "-.02em" }}>
            aicharts.io
          </span>
          <span>{serial}</span>
        </div>
      </div>
    </div>
  );
}

function ModelCardEmblemPanel({
  card,
  height,
  logoSize,
  mode = "full",
  width,
}: Readonly<{
  card: ModelCardPresentation;
  height: number;
  logoSize: number;
  mode?: "full" | "gallery";
  width: number;
}>) {
  return (
    <div style={{
      ...imageStyles.row,
      alignItems: "center",
      background: `radial-gradient(circle at 75% 18%, ${card.providerColor}44 0%, transparent 48%), radial-gradient(circle at 12% 88%, ${card.secondaryColor}28 0%, transparent 46%), linear-gradient(145deg, ${card.providerColor}22 0%, #090a0d 54%, #111318 100%)`,
      border: `2px solid ${card.providerColor}8f`,
      borderRadius: 28,
      height,
      justifyContent: "center",
      overflow: "hidden",
      position: "relative",
      width,
    }}>
      <div style={{ border: `1px solid ${card.secondaryColor}38`, borderRadius: 19, inset: 11, position: "absolute" }} />
      <ModelCardIllumination card={card} mode={mode} />
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse consumes a pinned SVG data URL. */}
      <img
        alt=""
        height={logoSize}
        src={card.iconDataUrl}
        style={{ objectFit: "contain", position: "relative" }}
        width={logoSize}
      />
    </div>
  );
}

function SocialStat({
  accent,
  label,
  value,
}: Readonly<{ accent: string; label: string; value: string }>) {
  return (
    <div style={{
      ...imageStyles.column,
      background: "rgba(4,5,8,.54)",
      borderLeft: "1px solid rgba(255,255,255,.12)",
      borderTop: `3px solid ${accent}`,
      flex: 1,
      minWidth: 0,
      padding: "13px 14px 12px",
    }}>
      <span style={{ color: "rgba(247,246,242,.58)", fontSize: 15, letterSpacing: ".09em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: 25, fontWeight: 700, marginTop: 7, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function emblemReading(card: ModelCardPresentation): string {
  const identity = card.emblemIdentity;
  const displayTerm = (value: string) => value.split("-").filter(Boolean).map(term => (
    term.length <= 3
      ? term.toLocaleUpperCase("en-US")
      : term.charAt(0).toLocaleUpperCase("en-US") + term.slice(1)
  )).join(" ");
  return [
    displayTerm(identity.familyId),
    identity.generation.join("."),
    identity.editionId === "base" ? null : displayTerm(identity.editionId),
  ].filter(value => value !== null).join(" · ");
}

export function ModelCardSocialImage({ card }: Readonly<{ card: ModelCardPresentation }>) {
  const modelLabel = compactImageLabel(card.displayTitle, 54);
  const harnessLabel = compactImageLabel(card.harnessLabel, 46);
  const providerLabel = compactImageLabel(card.providerName, 28);
  const emblemLabel = compactImageLabel(emblemReading(card), 38);
  const profileLabel = compactImageLabel(card.profileLabel, 24);
  const serial = `${String(card.cardNumber).padStart(3, "0")} / ${String(card.totalCards).padStart(3, "0")}`;
  return (
    <div style={{
      ...imageStyles.column,
      background: `radial-gradient(circle at 13% 19%, ${card.providerColor}38 0%, transparent 39%), radial-gradient(circle at 88% 82%, ${card.secondaryColor}17 0%, transparent 36%), linear-gradient(145deg, #14161b 0%, #07080b 57%, #101116 100%)`,
      color: "#f7f6f2",
      fontFamily: "Nebula Sans",
      height: "100%",
      overflow: "hidden",
      padding: "38px 48px 42px",
      position: "relative",
      width: "100%",
    }}>
      <div style={{ border: `1px solid ${card.providerColor}7d`, borderRadius: 30, inset: 18, position: "absolute" }} />
      <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 22, inset: 27, position: "absolute" }} />

      <div style={{ ...imageStyles.row, alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <span style={{ ...imageStyles.row, alignItems: "center", fontSize: 20, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>
          <i style={{ background: card.providerColor, border: `1px solid ${card.secondaryColor}`, borderRadius: 1, height: 10, marginRight: 13, transform: "rotate(45deg)", width: 10 }} />
          {providerLabel}
        </span>
        <div style={{ ...imageStyles.column, alignItems: "flex-end" }}>
          <ModelCardImageListing card={card} />
          <span style={{ color: "rgba(247,246,242,.5)", fontFamily: "monospace", fontSize: 15, letterSpacing: ".06em", marginTop: card.listing === null ? 0 : 8 }}>
            MODEL CARD {serial}
          </span>
        </div>
      </div>

      <div style={{ ...imageStyles.row, alignItems: "center", flex: 1, marginTop: 18, position: "relative" }}>
        <ModelCardEmblemPanel card={card} height={315} logoSize={144} width={500} />
        <div style={{ ...imageStyles.column, flex: 1, marginLeft: 44, minWidth: 0 }}>
          <span style={{ color: card.secondaryColor, fontFamily: "monospace", fontSize: 16, letterSpacing: ".12em", textTransform: "uppercase" }}>
            {emblemLabel}
          </span>
          <span style={{ fontSize: modelLabel.length > 34 ? 58 : 68, fontWeight: 780, letterSpacing: "-.055em", lineHeight: .94, marginTop: 14 }}>
            {modelLabel}
          </span>
          <span style={{ color: "rgba(247,246,242,.64)", fontSize: 25, marginTop: 15 }}>
            {harnessLabel}
          </span>
          <div style={{ ...imageStyles.row, alignItems: "center", marginTop: 28 }}>
            <span style={{ border: `1px solid ${card.secondaryColor}66`, borderRadius: 999, color: card.secondaryColor, fontFamily: "monospace", fontSize: 15, letterSpacing: ".08em", padding: "7px 11px", textTransform: "uppercase" }}>
              {profileLabel} profile
            </span>
            <span style={{ color: "rgba(247,246,242,.42)", fontSize: 16, marginLeft: 15 }}>
              illuminated benchmark specimen
            </span>
          </div>
          <span style={{ fontSize: 25, fontWeight: 760, marginTop: 23 }}>aicharts.io</span>
        </div>
      </div>

      <div style={{ ...imageStyles.row, gap: 12, marginTop: 18, position: "relative" }}>
        <div style={{ ...imageStyles.row, border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, flex: 4, overflow: "hidden" }}>
          {card.performance.map(stat => (
            <SocialStat accent={card.providerColor} key={stat.id} label={stat.label} value={stat.value} />
          ))}
        </div>
        <div style={{ ...imageStyles.row, border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, flex: 3, overflow: "hidden" }}>
          {card.economics.map(stat => (
            <SocialStat accent={card.secondaryColor} key={stat.id} label={stat.label} value={stat.value} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CollectionEmblem({
  card,
  width,
}: Readonly<{ card: ModelCardPresentation; width: number }>) {
  const atlasCard = {
    ...card,
    accentFamily: "base",
    illuminationDensity: 1,
    profileSlug: "atlas",
    secondaryColor: modelCardSecondaryColors.base,
    visualClass: "standard",
  } as const satisfies ModelCardPresentation;
  return (
    <div style={{
      ...imageStyles.column,
      background: `linear-gradient(150deg, ${card.providerColor}2f, rgba(7,8,11,.9) 58%)`,
      border: `1px solid ${card.providerColor}78`,
      borderRadius: 15,
      height: 190,
      overflow: "hidden",
      width,
    }}>
      <div style={{ ...imageStyles.row, alignItems: "center", flex: 1, justifyContent: "center", overflow: "hidden", position: "relative", width: "100%" }}>
        <ModelCardIllumination card={atlasCard} mode="gallery" />
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse consumes a pinned SVG data URL. */}
        <img alt="" height={52} src={card.iconDataUrl} style={{ objectFit: "contain", position: "relative" }} width={52} />
      </div>
      <div style={{
        ...imageStyles.row,
        alignItems: "center",
        borderTop: "1px solid rgba(255,255,255,.1)",
        color: "rgba(247,246,242,.8)",
        fontSize: 10,
        fontWeight: 700,
        height: 38,
        justifyContent: "center",
        letterSpacing: ".07em",
        padding: "0 7px",
        textAlign: "center",
        textTransform: "uppercase",
      }}>
        {compactImageLabel(card.providerName, 16)}
      </div>
    </div>
  );
}

function CollectionOverflowEmblem({
  count,
  width,
}: Readonly<{ count: number; width: number }>) {
  return (
    <div data-provider-overflow={count} style={{
      ...imageStyles.column,
      background: "radial-gradient(circle at 50% 28%, rgba(240,201,109,.18), transparent 52%), rgba(7,8,11,.88)",
      border: "1px solid rgba(240,201,109,.48)",
      borderRadius: 15,
      height: 190,
      overflow: "hidden",
      width,
    }}>
      <div style={{ ...imageStyles.column, alignItems: "center", flex: 1, justifyContent: "center" }}>
        <span style={{ color: "#f0c96d", fontFamily: "monospace", fontSize: 36, fontWeight: 700 }}>
          +{count}
        </span>
        <span style={{ color: "rgba(247,246,242,.48)", fontSize: 10, letterSpacing: ".08em", marginTop: 7, textTransform: "uppercase" }}>
          more houses
        </span>
      </div>
      <div style={{
        ...imageStyles.row,
        alignItems: "center",
        borderTop: "1px solid rgba(255,255,255,.1)",
        color: "rgba(247,246,242,.72)",
        fontSize: 10,
        fontWeight: 700,
        height: 38,
        justifyContent: "center",
        letterSpacing: ".07em",
        textTransform: "uppercase",
      }}>
        Providers
      </div>
    </div>
  );
}

export function ModelCardCollectionSocialImage({
  cards,
  profileCount,
  providerCount,
}: Readonly<{
  cards: readonly ModelCardPresentation[];
  profileCount: number;
  providerCount: number;
}>) {
  const overflowCount = Math.max(0, providerCount - cards.length);
  const tileCount = cards.length + (overflowCount > 0 ? 1 : 0);
  const crestWidth = tileCount > 10 ? 94 : 112;
  return (
    <div style={{
      ...imageStyles.column,
      background: "radial-gradient(circle at 78% 40%, rgba(92,134,179,.2), transparent 42%), radial-gradient(circle at 12% 88%, rgba(240,201,109,.1), transparent 38%), linear-gradient(145deg, #15171c 0%, #07080b 58%, #111218 100%)",
      color: "#f7f6f2",
      fontFamily: "Nebula Sans",
      height: "100%",
      overflow: "hidden",
      padding: "42px 50px",
      position: "relative",
      width: "100%",
    }}>
      <div style={{ border: "1px solid rgba(240,201,109,.38)", borderRadius: 30, inset: 18, position: "absolute" }} />
      <div style={{ border: "1px solid rgba(255,255,255,.09)", borderRadius: 22, inset: 27, position: "absolute" }} />
      <div style={{ ...imageStyles.row, alignItems: "center", fontSize: 22, fontWeight: 760, justifyContent: "space-between", position: "relative" }}>
        <span>aicharts.io</span>
        <span style={{ color: "rgba(247,246,242,.46)", fontFamily: "monospace", fontSize: 15, letterSpacing: ".11em" }}>
          THE BENCHMARK ATLAS
        </span>
      </div>
      <div style={{ ...imageStyles.row, alignItems: "center", flex: 1, marginTop: 24, position: "relative" }}>
        <div style={{ ...imageStyles.column, height: 420, justifyContent: "space-between", width: 390 }}>
          <div style={{ ...imageStyles.column }}>
            <span style={{ color: "#f0c96d", fontFamily: "monospace", fontSize: 16, letterSpacing: ".12em", textTransform: "uppercase" }}>
              Performance · cost · speed · tokens
            </span>
            <span style={{ fontSize: 69, fontWeight: 780, letterSpacing: "-.058em", lineHeight: .91, marginTop: 20 }}>
              The model codex
            </span>
            <span style={{ color: "rgba(247,246,242,.61)", fontSize: 24, lineHeight: 1.28, marginTop: 22 }}>
              An illuminated atlas of coding-agent performance, cost, speed, and scale.
            </span>
          </div>
          <div style={{ ...imageStyles.row, alignItems: "baseline" }}>
            <span style={{ fontFamily: "monospace", fontSize: 42, fontWeight: 700 }}>{profileCount}</span>
            <span style={{ color: "rgba(247,246,242,.5)", fontSize: 17, marginLeft: 10 }}>profiles</span>
            <span style={{ color: "rgba(247,246,242,.24)", fontSize: 28, margin: "0 18px" }}>·</span>
            <span style={{ fontFamily: "monospace", fontSize: 42, fontWeight: 700 }}>{providerCount}</span>
            <span style={{ color: "rgba(247,246,242,.5)", fontSize: 17, marginLeft: 10 }}>providers</span>
          </div>
        </div>
        <div style={{ ...imageStyles.row, flex: 1, flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginLeft: 34 }}>
          {cards.map(card => (
            <CollectionEmblem card={card} key={card.providerId} width={crestWidth} />
          ))}
          {overflowCount > 0 ? (
            <CollectionOverflowEmblem count={overflowCount} width={crestWidth} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
