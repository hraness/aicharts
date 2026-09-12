/**
 * Live favicon for the calculator: the headline monthly figure rendered as a
 * compact SVG so the tab shows the current scenario at a glance.
 */

/** "$840", "$8.4k", "$84k", "$840k", "$1.2M"; never more than five characters. */
export function compactUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0";
  const units = [
    { suffix: "B", size: 1e9 },
    { suffix: "M", size: 1e6 },
    { suffix: "k", size: 1e3 },
  ];
  for (const { size, suffix } of units) {
    const scaled = value / size;
    const rounded = scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
    if (rounded < 1) continue;
    return `$${scaled < 10 && rounded < 10 ? rounded.toFixed(1) : String(rounded)}${suffix}`;
  }
  return `$${Math.round(value)}`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/gu, character => ({
    "\"": "&quot;", "&": "&amp;", "'": "&apos;", "<": "&lt;", ">": "&gt;",
  })[character] ?? character);
}

/** Site icon colors so the live favicon reads as the same product. */
const BACKGROUND = "#f8f7f4";
const INK = "#291201";
const ACCENT = "#5e2e02";

export function calculatorFaviconSvg(text: string): string {
  const fontSize = text.length <= 3 ? 30 : text.length === 4 ? 26 : 22;
  return [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">",
    `<rect width="64" height="64" rx="14" fill="${BACKGROUND}"/>`,
    `<rect x="10" y="49" width="44" height="4" rx="2" fill="${ACCENT}"/>`,
    `<text x="32" y="33" fill="${INK}" font-family="ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central" textLength="${text.length <= 3 ? "" : "52"}" lengthAdjust="spacingAndGlyphs">${escapeXml(text)}</text>`,
    "</svg>",
  ].join("").replace(" textLength=\"\"", "");
}

export function calculatorFaviconHref(value: number): string {
  return `data:image/svg+xml,${encodeURIComponent(calculatorFaviconSvg(compactUsd(value)))}`;
}
