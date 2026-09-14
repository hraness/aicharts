import { providerBrand } from "@/lib/provider-brand";
import type { CSSProperties } from "react";

import "@/styles/option-picker.css";

type ChipStyle = CSSProperties & Readonly<{
  "--option-picker-chip": string;
  "--option-picker-glyph": string;
  "--option-picker-icon"?: string;
}>;

/**
 * Compact Lobe or monogram mark for a model lab. Reuses the picker chip
 * colors and CSS-mask glyph so every vendor surface stays on one icon
 * language.
 */
export function ProviderBrandMark({
  className = "",
  displayName,
  identities = [],
  size = "inline",
}: Readonly<{
  className?: string;
  displayName: string;
  identities?: readonly string[];
  size?: "chip" | "inline";
}>) {
  const brand = providerBrand(displayName, ...identities);
  const style: ChipStyle = {
    "--option-picker-chip": brand.chipColor,
    "--option-picker-glyph": brand.glyphColor,
    ...(brand.iconUrl === null ? {} : { "--option-picker-icon": `url("${brand.iconUrl}")` }),
  };
  return (
    <span
      aria-hidden="true"
      className={`provider-brand-mark provider-brand-mark--${size} ${className}`.trim()}
      style={style}
    >
      {brand.iconUrl === null
        ? brand.monogram
        : <i className="option-picker__glyph" />}
    </span>
  );
}

export function ProviderBrandLabel({
  className = "",
  displayName,
  identities = [],
}: Readonly<{
  className?: string;
  displayName: string;
  identities?: readonly string[];
}>) {
  return (
    <span className={`provider-brand-label ${className}`.trim()}>
      <ProviderBrandMark displayName={displayName} identities={identities} />
      <span>{displayName}</span>
    </span>
  );
}
