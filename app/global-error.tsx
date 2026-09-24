"use client";

import { getDesignPaletteTheme } from "@hraness/design-kit";
import {
  DesignPaletteProvider,
  ThemeColorSync,
} from "@hraness/design-kit/react";
import { RouteErrorState, type RouteErrorProps } from "@/components/route-state";
import "./globals.css";

const initialPalette = getDesignPaletteTheme("tokyo-night", "light");

export default function GlobalError(props: RouteErrorProps) {
  return (
    <html
      className={initialPalette.className}
      data-palette="tokyo-night"
      data-hraness-material="lantern"
      data-hraness-pattern="mesh"
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <meta content="light dark" name="color-scheme" />
        <meta
          content="#e1e2e7"
          media="(prefers-color-scheme: light)"
          name="theme-color"
        />
        <meta
          content="#1a1b26"
          media="(prefers-color-scheme: dark)"
          name="theme-color"
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body>
        <DesignPaletteProvider
          defaultPreference={{ palette: "tokyo-night", mode: "system" }}
          legacyStorageKey="aicharts-theme"
        >
          <ThemeColorSync darkColor="#1a1b26" lightColor="#e1e2e7" />
          <RouteErrorState {...props} />
        </DesignPaletteProvider>
      </body>
    </html>
  );
}
