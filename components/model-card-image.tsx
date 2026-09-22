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

export function ModelCardSocialImage({ card }: Readonly<{ card: ModelCardPresentation }>) {
  const modelLabel = compactImageLabel(card.displayTitle, 54);
  const harnessLabel = compactImageLabel(card.harnessLabel, 46);
  const providerLabel = compactImageLabel(card.providerName, 28);
  const profileLabel = compactImageLabel(card.profileLabel, 24);
  return (
    <div style={{
      ...imageStyles.column,
      background: `radial-gradient(circle at 13% 19%, ${card.providerColor}28 0%, transparent 39%), linear-gradient(145deg, #14161b 0%, #07080b 57%, #101116 100%)`,
      color: "#f7f6f2",
      fontFamily: "Nebula Sans",
      height: "100%",
      overflow: "hidden",
      padding: "38px 48px 42px",
      position: "relative",
      width: "100%",
    }}>
      <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 22, inset: 18, position: "absolute" }} />

      <div style={{ ...imageStyles.row, alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>
          {providerLabel}
        </span>
        <ModelCardImageRelease card={card} />
      </div>

      <div style={{ ...imageStyles.row, alignItems: "center", flex: 1, marginTop: 18, position: "relative" }}>
        <div style={{
          ...imageStyles.row,
          alignItems: "center",
          background: "rgba(4,5,8,.45)",
          border: "1px solid rgba(255,255,255,.12)",
          borderRadius: 28,
          height: 280,
          justifyContent: "center",
          width: 280,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse consumes a pinned SVG data URL. */}
          <img alt="" height={144} src={card.iconDataUrl} style={{ objectFit: "contain" }} width={144} />
        </div>
        <div style={{ ...imageStyles.column, flex: 1, marginLeft: 44, minWidth: 0 }}>
          <span style={{ fontSize: modelLabel.length > 34 ? 58 : 68, fontWeight: 780, letterSpacing: "-.055em", lineHeight: .94 }}>
            {modelLabel}
          </span>
          <span style={subtitleImageStyle({
            color: "rgba(247,246,242,.64)",
            fontSize: 25,
            marginTop: 15,
          })}>
            {harnessLabel}
          </span>
          <div style={{ ...imageStyles.row, alignItems: "center", marginTop: 28 }}>
            <span style={{ border: "1px solid rgba(255,255,255,.18)", borderRadius: 999, fontFamily: "monospace", fontSize: 15, letterSpacing: ".08em", padding: "7px 11px", textTransform: "uppercase" }}>
              {profileLabel} profile
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
      <div style={{ ...imageStyles.row, alignItems: "center", flex: 1, justifyContent: "center", overflow: "hidden", width: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse consumes a pinned SVG data URL. */}
        <img alt="" height={52} src={card.iconDataUrl} style={{ objectFit: "contain" }} width={52} />
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
      background: "rgba(7,8,11,.88)",
      border: "1px solid rgba(255,255,255,.2)",
      borderRadius: 15,
      height: 190,
      overflow: "hidden",
      width,
    }}>
      <div style={{ ...imageStyles.column, alignItems: "center", flex: 1, justifyContent: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 700 }}>
          +{count}
        </span>
        <span style={{ color: "rgba(247,246,242,.48)", fontSize: 10, letterSpacing: ".08em", marginTop: 7, textTransform: "uppercase" }}>
          more providers
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
      background: "linear-gradient(145deg, #15171c 0%, #07080b 58%, #111218 100%)",
      color: "#f7f6f2",
      fontFamily: "Nebula Sans",
      height: "100%",
      overflow: "hidden",
      padding: "42px 50px",
      position: "relative",
      width: "100%",
    }}>
      <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 22, inset: 18, position: "absolute" }} />
      <div style={{ ...imageStyles.row, alignItems: "center", fontSize: 22, fontWeight: 760, justifyContent: "space-between", position: "relative" }}>
        <span>aicharts.io</span>
        <span style={{ color: "rgba(247,246,242,.46)", fontFamily: "monospace", fontSize: 15, letterSpacing: ".11em" }}>
          MODELS
        </span>
      </div>
      <div style={{ ...imageStyles.row, alignItems: "center", flex: 1, marginTop: 24, position: "relative" }}>
        <div style={{ ...imageStyles.column, height: 420, justifyContent: "space-between", width: 390 }}>
          <div style={{ ...imageStyles.column }}>
            <span style={{ fontFamily: "monospace", fontSize: 16, letterSpacing: ".12em", textTransform: "uppercase" }}>
              Index · cost · coding agents
            </span>
            <span style={{ fontSize: 69, fontWeight: 780, letterSpacing: "-.058em", lineHeight: .91, marginTop: 20 }}>
              Models
            </span>
            <span style={{ color: "rgba(247,246,242,.61)", fontSize: 24, lineHeight: 1.28, marginTop: 22 }}>
              Identity pages for models in the current snapshots.
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
