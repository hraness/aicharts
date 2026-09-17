import { initDesignPalette } from "@hraness/design-kit/browser";

// Bundled as a same-origin classic script and executed before the page paints.
// Paper is the default palette; the legacy mode key migrates on first save.
initDesignPalette({
  defaultPreference: { palette: "paper", mode: "system" },
  legacyStorageKey: "aicharts-theme",
});
