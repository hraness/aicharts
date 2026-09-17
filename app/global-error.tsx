"use client";

import { getDesignPaletteTheme } from "@hraness/design-kit";
import {
  DesignPaletteProvider,
  ThemeColorSync,
} from "@hraness/design-kit/react";
import { RouteErrorState, type RouteErrorProps } from "@/components/route-state";
import "./globals.css";

const initialPalette = getDesignPaletteTheme("paper", "light");

export default function GlobalError(props: RouteErrorProps) {
  return (
    <html
      className={initialPalette.className}
      data-palette="paper"
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <meta content="light dark" name="color-scheme" />
        <meta
          content="#f8f7f4"
          media="(prefers-color-scheme: light)"
          name="theme-color"
        />
        <meta
          content="#12100f"
          media="(prefers-color-scheme: dark)"
          name="theme-color"
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body>
        <DesignPaletteProvider
          defaultPreference={{ palette: "paper", mode: "system" }}
          legacyStorageKey="aicharts-theme"
        >
          <ThemeColorSync darkColor="#12100f" lightColor="#f8f7f4" />
          <RouteErrorState {...props} />
        </DesignPaletteProvider>
      </body>
    </html>
  );
}
