import type { CSSProperties } from "react";

import {
  formatModelCardReleaseDate,
  modelCardReleaseAccessibleLabel,
  modelCardReleaseLabel,
  type ModelCardPresentation,
} from "@/lib/model-card-presentation";

const imageStyles = {
  column: { display: "flex", flexDirection: "column" },
  row: { display: "flex", flexDirection: "row" },
} satisfies Readonly<Record<string, CSSProperties>>;

function compactImageLabel(value: string, maximumCharacters: number): string {
  const normalized = value.trim();
  if (normalized.length <= maximumCharacters) return normalized;
  return `${normalized.slice(0, maximumCharacters - 1).trimEnd()}…`;
}

function subtitleImageStyle({
  color,
  fontSize,
  marginTop,
}: Readonly<{
  color: string;
  fontSize: number;
  marginTop: number;
}>): CSSProperties {
  return {
    color,
    fontSize,
    lineHeight: 1.2,
    marginTop,
    paddingBottom: Math.max(2, Math.round(fontSize * .14)),
  };
}

function Stat({ label, value, compact }: Readonly<{ compact?: boolean; label: string; value: string }>) {
  return (
    <div style={{
      ...imageStyles.column,
      background: "rgba(5, 6, 8, .58)",
      border: "1px solid rgba(255,255,255,.13)",
      borderRadius: compact ? 10 : 16,
      flex: 1,
      minWidth: 0,
      padding: compact ? "9px 10px" : "16px 15px",
    }}>
      <span style={{ color: "rgba(247,246,242,.62)", fontSize: compact ? 12 : 22, letterSpacing: ".08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: compact ? 17 : 28, fontWeight: 700, marginTop: compact ? 4 : 8, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function ModelCardImageRelease({
  card,
  compact = false,
}: Readonly<{
  card: ModelCardPresentation;
  compact?: boolean;
}>) {
  const style = {
    ...imageStyles.column,
    alignItems: "flex-end",
    flex: "0 0 auto",
    lineHeight: 1,
    textAlign: "right",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  } satisfies CSSProperties;
  const label = (
    <span style={{ color: "rgba(247,246,242,.48)", fontSize: compact ? 6 : 14, letterSpacing: ".11em" }}>
      {modelCardReleaseLabel(card.release)}
    </span>
  );
  const value = (
    <span style={{ color: "rgba(247,246,242,.84)", fontFamily: "monospace", fontSize: compact ? 9 : 21, letterSpacing: ".045em", marginTop: compact ? 4 : 8 }}>
      {card.release.status === "verified"
        ? formatModelCardReleaseDate(card.release.releasedOn)
        : "Verifying"}
    </span>
  );
  if (card.release.status !== "verified") {
    return (
      <div aria-label={modelCardReleaseAccessibleLabel(card.release)} role="note" style={style}>
        {label}
        {value}
      </div>
    );
  }
  return (
    <time
      aria-label={modelCardReleaseAccessibleLabel(card.release)}
      dateTime={card.release.releasedOn}
      style={style}
    >
      {label}
      {value}
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
  const padding = compact ? 19 : 48;
  const radius = compact ? 18 : 28;
  const modelLabel = compactImageLabel(card.displayTitle, compact ? 34 : 48);
  const providerLabel = compactImageLabel(card.providerName, compact ? 10 : 24);
  const harnessLabel = compactImageLabel(card.harnessLabel, compact ? 30 : 44);
  return (
    <div style={{
      ...imageStyles.column,
      background: `linear-gradient(160deg, ${card.providerColor}22 0%, #0c0d10 46%, #111318 100%)`,
      border: `${compact ? 1 : 2}px solid ${card.providerColor}99`,
      borderRadius: radius,
      color: "#f7f6f2",
      fontFamily: "Nebula Sans",
      height: "100%",
      overflow: "hidden",
      padding,
      position: "relative",
      width: "100%",
    }}>
      <div style={{
        ...imageStyles.column,
        flex: 1,
        position: "relative",
      }}>
        <div style={{ ...imageStyles.row, alignItems: "center", gap: compact ? 7 : 16, justifyContent: "space-between" }}>
          <span style={{ ...imageStyles.row, alignItems: "center", flex: 1, fontSize: compact ? 13 : 24, fontWeight: 700, letterSpacing: ".08em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {providerLabel}
          </span>
          <ModelCardImageRelease card={card} compact={compact} />
        </div>

        <div style={{
          ...imageStyles.row,
          alignItems: "center",
          alignSelf: "center",
          background: "rgba(4,5,8,.45)",
          border: "1px solid rgba(255,255,255,.12)",
          borderRadius: compact ? 18 : 28,
          flex: 1,
          justifyContent: "center",
          margin: compact ? "16px 0" : "28px 0",
          maxWidth: compact ? 160 : 360,
          minHeight: compact ? 48 : 0,
          overflow: "hidden",
          width: "100%",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse consumes a pinned SVG data URL. */}
          <img alt="" height={compact ? 96 : 220} src={card.iconDataUrl} style={{ objectFit: "contain" }} width={compact ? 96 : 220} />
        </div>

        <div style={{ ...imageStyles.column }}>
          <span style={{ fontSize: compact ? 28 : 64, fontWeight: 760, letterSpacing: "-.05em", lineHeight: .94 }}>
            {modelLabel}
          </span>
          <span style={subtitleImageStyle({
            color: "rgba(247,246,242,.72)",
            fontSize: compact ? 15 : 28,
            marginTop: compact ? 8 : 14,
          })}>
            {harnessLabel}
          </span>
        </div>

        <div style={{ ...imageStyles.row, gap: compact ? 6 : 12, marginTop: compact ? 12 : 22 }}>
          {card.performance.map(stat => <Stat compact={compact} key={stat.id} label={stat.label} value={stat.value} />)}
        </div>
        <div style={{ ...imageStyles.row, gap: compact ? 6 : 12, marginTop: compact ? 7 : 12 }}>
          {card.economics.map(stat => <Stat compact={compact} key={stat.id} label={stat.label} value={stat.value} />)}
        </div>

        <div style={{ ...imageStyles.row, alignItems: "center", color: "rgba(247,246,242,.62)", fontSize: compact ? 11 : 20, justifyContent: "space-between", marginTop: compact ? 12 : 22 }}>
          <span style={{ color: "#f7f6f2", fontSize: compact ? 15 : 26, fontWeight: 750, letterSpacing: "-.02em" }}>
            aicharts.io
          </span>
        </div>
      </div>
    </div>
  );
}
