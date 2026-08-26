import { lobeModelIconDataUrls } from "./model-card-icons.generated";

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

/** Returns pinned, same-origin-safe SVG bytes for server-rendered cards and images. */
export function modelIconDataUrl(key: LobeModelIconKey | null, fallbackLabel = "AI"): string {
  if (key === null) {
    const monogram = modelMonogram(fallbackLabel);
    const cached = genericIconDataUrls.get(monogram);
    if (cached !== undefined) return cached;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="8" y="8" width="112" height="112" rx="32" fill="none" stroke="#f7f6f2" stroke-width="8"/><text x="64" y="76" fill="#f7f6f2" font-family="ui-sans-serif,system-ui,sans-serif" font-size="42" font-weight="700" text-anchor="middle">${monogram}</text></svg>`;
    const value = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    genericIconDataUrls.set(monogram, value);
    return value;
  }
  return lobeModelIconDataUrls[key];
}
