export type IsolatedSvgFontResource = Readonly<{
  css: string;
  metadata: string;
}>;

const expectedWeights = [400, 700] as const;
const nebulaSansCopyright =
  "Copyright (c) 2024, Nebula Entertainment & Broadcasting LLC (https://nebula.tv), with Reserved Font Name 'Nebula'.";
const nebulaSansProvenance = [
  "Nebula Sans 1.010",
  "Upstream: https://www.nebulasans.com/",
  "Source archive: https://www.nebulasans.com/download/NebulaSans-1.010.zip",
  "Source archive SHA-256: a9b56ef15e24b6e8195af7457cc75f714ecf5501fc3c20a69f546c8f589e7bdb",
  "Retrieved: 2026-08-27",
].join("\n");
const nebulaSansLicenseNotice = [
  "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
  "License: https://openfontlicense.org/open-font-license-official-text/",
  "The copyright notice, full license, and provenance are distributed unchanged at",
  "@hraness/design-kit/fonts/nebula-sans/LICENSE.txt and PROVENANCE.md.",
].join("\n");

function isOpenTypePayload(data: ArrayBuffer): boolean {
  const signature = new Uint8Array(data, 0, Math.min(data.byteLength, 4));
  return signature.length === 4
    && signature[0] === 0x4f
    && signature[1] === 0x54
    && signature[2] === 0x54
    && signature[3] === 0x4f;
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Returns self-contained, byte-preserving font resources for an isolated SVG.
 * The social-font payloads are the immutable upstream OTF files, not subsets or
 * converted derivatives, so their reserved family name remains valid.
 */
export async function createNebulaSansSvgFontResource(): Promise<IsolatedSvgFontResource> {
  const { nebulaSansSocialFonts } = await import(
    "@hraness/design-kit/fonts/nebula-sans/social"
  );
  const fonts = [...nebulaSansSocialFonts()].toSorted((left, right) => left.weight - right.weight);
  if (
    fonts.length !== expectedWeights.length
    || fonts.some((font, index) => (
      font.name !== "Nebula Sans"
      || font.style !== "normal"
      || font.weight !== expectedWeights[index]
      || !isOpenTypePayload(font.data)
    ))
  ) {
    throw new Error("The immutable Nebula Sans export payload is incomplete or invalid.");
  }

  return {
    css: fonts.map(font => [
      "@font-face{",
      "font-family:'Nebula Sans';",
      `font-weight:${String(font.weight)};`,
      "font-style:normal;",
      "font-display:block;",
      `src:url(\"data:font/otf;base64,${arrayBufferToBase64(font.data)}\") format(\"opentype\");`,
      "}",
    ].join("")).join("\n"),
    metadata: [
      nebulaSansCopyright,
      nebulaSansLicenseNotice,
      nebulaSansProvenance,
      "Embedded payloads: unmodified NebulaSans-Book.otf (400) and NebulaSans-Bold.otf (700).",
    ].join("\n"),
  };
}
