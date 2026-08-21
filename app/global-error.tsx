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
      <body>
        <DesignThemeProvider storageKey="aicharts-theme">
          <ThemeColorSync darkColor="#12100f" lightColor="#f8f7f4" />
          <RouteErrorState {...props} />
        </DesignThemeProvider>
      </body>
    </html>
  );
}
