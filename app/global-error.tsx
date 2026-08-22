"use client";

import {
  DesignThemeProvider,
  ThemeColorSync,
} from "@hraness/design-kit/react";
import { RouteErrorState, type RouteErrorProps } from "@/components/route-state";
import "./globals.css";

export default function GlobalError(props: RouteErrorProps) {
  return (
    <html data-theme="light" lang="en" suppressHydrationWarning>
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
      </head>
      <body>
        <DesignThemeProvider storageKey="aicharts-theme">
          <ThemeColorSync darkColor="#12100f" lightColor="#f8f7f4" />
          <RouteErrorState {...props} />
        </DesignThemeProvider>
      </body>
    </html>
  );
}
