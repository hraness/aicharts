import { initDesignPalette } from "@hraness/design-kit/browser";

// Bundled as a same-origin classic script and executed before the page paints.
// Tokyo Night is the default palette; the legacy mode key migrates on first save.
initDesignPalette({
  defaultPreference: { palette: "tokyo-night", mode: "system" },
  legacyStorageKey: "aicharts-theme",
});
