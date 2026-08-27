import type { CSSProperties } from "react";

import type { ModelCardPresentation } from "@/lib/model-card-presentation";

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
  const providerLabel = compactImageLabel(card.providerName, compact ? 18 : 24);
  const harnessLabel = compactImageLabel(card.harnessLabel, compact ? 30 : 44);
  return (
    <div style={{
      ...imageStyles.column,
      background: `${foilImageGradient(card.foilPreset)}, radial-gradient(circle at 72% 20%, ${card.providerColor}70 0%, transparent 38%), radial-gradient(circle at 14% 78%, ${card.secondaryColor}30 0%, transparent 34%), linear-gradient(145deg, ${card.providerColor}36 0%, #090a0c 54%, #111216 100%)`,
      border: `${compact ? 2 : 4}px solid ${card.providerColor}b8`,
      borderRadius: radius,
      color: "#f7f6f2",
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
        <div style={{ ...imageStyles.row, alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ ...imageStyles.row, alignItems: "center", fontSize: compact ? 13 : 27, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
            <i style={{ background: card.providerColor, border: `${compact ? 1 : 2}px solid ${card.secondaryColor}`, borderRadius: 999, boxShadow: `0 0 ${compact ? 7 : 14}px ${card.providerColor}aa`, height: compact ? 8 : 17, marginRight: compact ? 8 : 16, width: compact ? 8 : 17 }} />
            {providerLabel}
          </span>
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

export function ModelCardSocialImage({ card }: Readonly<{ card: ModelCardPresentation }>) {
  const modelLabel = compactImageLabel(card.displayTitle, 48);
  const harnessLabel = compactImageLabel(card.harnessLabel, 46);
  const providerLabel = compactImageLabel(card.providerName, 28);
  return (
    <div style={{
      ...imageStyles.row,
      alignItems: "center",
      background: "#0d0e11",
      color: "#f7f6f2",
      height: "100%",
      padding: "48px 58px",
      width: "100%",
    }}>
      <div style={{ display: "flex", height: 526, width: 376 }}>
        <ModelCardRasterFace card={card} compact />
      </div>
      <div style={{ ...imageStyles.column, flex: 1, marginLeft: 58 }}>
        <span style={{ color: card.providerColor, fontSize: 23, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase" }}>
          {providerLabel}
        </span>
        <span style={{ fontSize: 68, fontWeight: 780, letterSpacing: "-.055em", lineHeight: .93, marginTop: 19 }}>
          {modelLabel}
        </span>
        <span style={{ color: "rgba(247,246,242,.65)", fontSize: 27, marginTop: 15 }}>
          {harnessLabel}
        </span>
        <div style={{ ...imageStyles.row, flexWrap: "wrap", gap: 10, marginTop: 34 }}>
          {card.performance.map(stat => (
            <span key={stat.id} style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 999, fontFamily: "monospace", fontSize: 20, padding: "10px 15px" }}>
              {stat.label} {stat.value}
            </span>
          ))}
        </div>
        <span style={{ color: "rgba(247,246,242,.48)", fontFamily: "monospace", fontSize: 18, marginTop: 37 }}>
          MODEL CARD {String(card.cardNumber).padStart(3, "0")} / {String(card.totalCards).padStart(3, "0")}
        </span>
        <span style={{ fontSize: 28, fontWeight: 760, marginTop: 17 }}>aicharts.io</span>
      </div>
    </div>
  );
}
