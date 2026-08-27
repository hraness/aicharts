import { expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json();
const globals = await Bun.file(new URL("./globals.css", import.meta.url)).text();
const plainSite = await Bun.file(new URL("../styles/plain-site.css", import.meta.url)).text();
const plainPublication = await Bun.file(new URL("../styles/plain-publication.css", import.meta.url)).text();
const rootSocialImage = await Bun.file(new URL("./opengraph-image.tsx", import.meta.url)).text();
const modelImages = await Bun.file(new URL("../components/model-card-image.tsx", import.meta.url)).text();
const chartExport = await Bun.file(new URL("../components/chart-export.ts", import.meta.url)).text();
const chartExportFont = await Bun.file(new URL("../components/chart-export-font.ts", import.meta.url)).text();

test("uses the released Nebula Sans contract across web, exports, and social images", () => {
  expect(packageJson.dependencies).toMatchObject({
    "@hraness/design-kit": "github:hraness/design-kit#v0.2.1",
    "@hraness/ui": "github:hraness/ui#v0.4.7",
    "@hraness/web-discovery": "github:hraness/web-discovery#v0.2.0",
  });
  expect(globals).toContain("--font-sans: var(--font-text)");
  expect(globals).not.toContain("--font-sans: Inter");
  expect(plainSite).toContain("font-family: var(--font-text)");
  expect(plainPublication).toContain("font-family: var(--font-text)");
  expect(rootSocialImage).toContain('fontFamily: "Nebula Sans"');
  expect(rootSocialImage).toContain("fonts: [...nebulaSansSocialFonts()]");
  expect(modelImages.match(/fontFamily: "Nebula Sans"/gu)?.length).toBe(3);
  expect(chartExport).toContain('"Nebula Sans, sans-serif"');
  expect(chartExport).toContain("appendEmbeddedNebulaSans(exportedSvg)");
  expect(chartExportFont).toContain('"@hraness/design-kit/fonts/nebula-sans/social"');
  expect(chartExportFont).toContain("SIL Open Font License, Version 1.1");
});
