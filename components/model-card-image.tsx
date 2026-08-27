import type { CSSProperties } from "react";

import type { ModelCardPresentation } from "@/lib/model-card-presentation";

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

function ModelClassFiligree({
  cardNumber,
  color,
  visualClass,
}: Readonly<{
  cardNumber: number;
  color: string;
  visualClass: ModelCardPresentation["visualClass"];
}>) {
  const gradientId = `card-filigree-${visualClass}-${cardNumber}`;
  const stroke = `url(#${gradientId})`;
  const sharedStroke = {
    fill: "none",
    stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      aria-hidden="true"
      data-card-filigree={visualClass}
      height="100%"
      preserveAspectRatio="none"
      style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
      viewBox="0 0 1000 1400"
      width="100%"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,.22)" />
          <stop offset=".28" stopColor={color} />
          <stop offset=".57" stopColor="rgba(255,255,255,.66)" />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>

      {visualClass === "standard" ? (
        <g {...sharedStroke} opacity=".68" strokeWidth="4">
          <path d="M218 58H104Q58 58 58 104v114" />
          <path d="M782 58h114q46 0 46 46v114" />
          <path d="M218 1342H104q-46 0-46-46v-114" />
          <path d="M782 1342h114q46 0 46-46v-114" />
          <path d="M82 270v-32h32M918 270v-32h-32M82 1130v32h32M918 1130v32h-32" opacity=".5" strokeWidth="2" />
        </g>
      ) : null}

      {visualClass === "fast" ? (
        <g {...sharedStroke} opacity=".72">
          <path d="M154 48h692l106 106v1092l-106 106H154L48 1246V154Z" strokeWidth="5" />
          <path d="M74 286V180l106-106h112M926 286V180L820 74H708M74 1114v106l106 106h112M926 1114v106l-106 106H708" opacity=".58" strokeWidth="3" />
          <path d="M52 382h42l28-28M52 470h66l28-28M948 930h-42l-28 28M948 1018h-66l-28 28" strokeWidth="5" />
        </g>
      ) : null}

      {visualClass === "thinking" ? (
        <g {...sharedStroke} opacity=".62">
          <rect height="1296" rx="50" strokeWidth="3" width="896" x="52" y="52" />
          <ellipse cx="500" cy="508" rx="360" ry="226" strokeWidth="3" />
          <ellipse cx="500" cy="508" opacity=".6" rx="334" ry="205" strokeDasharray="12 22" strokeWidth="2" transform="rotate(-27 500 508)" />
          <path d="M86 270h94l42 42h78M914 270h-94l-42 42h-78M86 1130h94l42-42h78M914 1130h-94l-42-42h-78" strokeWidth="3" />
          <circle cx="300" cy="312" fill={color} r="7" stroke="none" />
          <circle cx="700" cy="312" fill={color} r="7" stroke="none" />
          <circle cx="300" cy="1088" fill={color} r="7" stroke="none" />
          <circle cx="700" cy="1088" fill={color} r="7" stroke="none" />
        </g>
      ) : null}

      {visualClass === "max" ? (
        <g {...sharedStroke} opacity=".76">
          <rect height="1312" rx="52" strokeWidth="6" width="912" x="44" y="44" />
          <rect height="1270" rx="42" strokeWidth="2" width="870" x="65" y="65" />
          <path d="M348 65h58l32 30h124l32-30h58M418 65l28 50h108l28-50" strokeWidth="4" />
          <path d="m500 86 22 22-22 22-22-22Z" fill={color} opacity=".75" strokeWidth="2" />
          <path d="M348 1335h58l32-30h124l32 30h58M418 1335l28-50h108l28 50" opacity=".65" strokeWidth="4" />
          <path d="M84 252v-88q0-80 80-80h88M916 252v-88q0-80-80-80h-88M84 1148v88q0 80 80 80h88M916 1148v88q0 80-80 80h-88" opacity=".48" strokeWidth="2" />
        </g>
      ) : null}
    </svg>
  );
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
      background: `${foilImageGradient(card.foilPreset)}, radial-gradient(circle at 72% 20%, ${card.providerColor}70 0%, transparent 38%), radial-gradient(circle at 14% 78%, ${card.providerColor}26 0%, transparent 34%), linear-gradient(145deg, ${card.providerColor}36 0%, #090a0c 54%, #111216 100%)`,
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
      <ModelClassFiligree cardNumber={card.cardNumber} color={card.providerColor} visualClass={card.visualClass} />
      <div style={{
        ...imageStyles.column,
        flex: 1,
        padding: compact ? 23 : 47,
        position: "relative",
      }}>
        <div style={{ ...imageStyles.row, alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ ...imageStyles.row, alignItems: "center", fontSize: compact ? 13 : 27, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
            <i style={{ background: card.providerColor, borderRadius: 999, height: compact ? 8 : 17, marginRight: compact ? 8 : 16, width: compact ? 8 : 17 }} />
            {providerLabel}
          </span>
          <span style={{ border: "1px solid rgba(255,255,255,.28)", borderRadius: 999, color: "rgba(247,246,242,.68)", fontSize: compact ? 12 : 24, letterSpacing: ".08em", padding: compact ? "7px 10px" : "13px 19px", textTransform: "uppercase" }}>
            {card.classLabel}
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
          minHeight: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse consumes a pinned SVG data URL. */}
          <img alt="" height={compact ? 132 : 300} src={card.iconDataUrl} style={{ objectFit: "contain" }} width={compact ? 132 : 300} />
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
          {providerLabel} · {card.classLabel}
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
