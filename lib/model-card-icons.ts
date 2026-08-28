import { lobeModelIconDataUrls } from "./model-card-icons.generated";
import {
  modelCardMonogramGlyphs,
  type ModelCardMonogramCharacter,
} from "./model-card-monogram-paths";

export const lobeModelIconKeys = [
  "alibabacloud",
  "claude",
  "cursor",
  "deepseek",
  "gemini",
  "meta",
  "moonshot",
  "openai",
  "xai",
  "zai",
] as const;

export type LobeModelIconKey = (typeof lobeModelIconKeys)[number];

const genericIconDataUrls = new Map<string, string>();

export function isLobeModelIconKey(value: unknown): value is LobeModelIconKey {
  return typeof value === "string"
    && lobeModelIconKeys.some((key) => key === value);
}

function modelMonogram(label: string): string {
  const words = label.trim().split(/\s+/u).filter(Boolean);
  const monogram = words.slice(0, 2).map(word => word[0] ?? "").join("").toUpperCase();
  return monogram.replaceAll(/[^A-Z0-9]/gu, "").slice(0, 2) || "AI";
}

function monogramPathMarkup(monogram: string): string {
  const glyphs = [...monogram].map(character => (
    modelCardMonogramGlyphs[character as ModelCardMonogramCharacter]
  ));
  const totalAdvance = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
  const scale = 0.042;
  const originX = 64 - totalAdvance * scale / 2;
  let cursor = 0;
  const paths = glyphs.map(glyph => {
    const path = `<path d="${glyph.path}" transform="translate(${String(cursor)} 0)"/>`;
    cursor += glyph.advance;
    return path;
  }).join("");
  return `<g data-generic-monogram="${monogram}" fill="#f7f6f2" transform="translate(${originX.toFixed(3)} 76) scale(${String(scale)} -${String(scale)})">${paths}</g>`;
}

/** Returns pinned, same-origin-safe SVG bytes for server-rendered cards and images. */
export function modelIconDataUrl(key: LobeModelIconKey | null, fallbackLabel = "AI"): string {
  if (key === null) {
    const monogram = modelMonogram(fallbackLabel);
    const cached = genericIconDataUrls.get(monogram);
    if (cached !== undefined) return cached;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><metadata>Monogram artwork rendered to paths from NebulaSans-Bold.otf 1.010; copyright (c) 2024 Nebula Entertainment &amp; Broadcasting LLC; SIL Open Font License 1.1; source archive SHA-256 a9b56ef15e24b6e8195af7457cc75f714ecf5501fc3c20a69f546c8f589e7bdb.</metadata><rect x="8" y="8" width="112" height="112" rx="32" fill="none" stroke="#f7f6f2" stroke-width="8"/>${monogramPathMarkup(monogram)}</svg>`;
    const value = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    genericIconDataUrls.set(monogram, value);
    return value;
  }
  return lobeModelIconDataUrls[key];
}
