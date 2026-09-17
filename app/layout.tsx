import { getDesignPaletteTheme } from "@hraness/design-kit";
import {
  DesignPaletteProvider,
  ThemeColorSync,
} from "@hraness/design-kit/react";
import { MarketingSiteFooter } from "@hraness/design-kit/react/server";
import { HranessSiteFooter } from "@hraness/site-footer/react";
import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";

import { AnalyticsBoundary } from "@/components/analytics-boundary";
import { FoilController } from "@/components/foil-controller";
import { SITE_HEADER_LINKS } from "@/components/site-header";

import "./globals.css";
import { aiChartsMailingListConfig } from "./mailing-config";
import { site } from "./site";

type BrandThemeStyle = CSSProperties & Readonly<{
  "--brand-highlight": string;
  "--brand-key": string;
  "--brand-shadow": string;
  "--brand-support": string;
}>;

/**
 * SSR renders the Paper light palette tokens so the first paint is stable.
 * The blocking bootstrap replaces them with the stored preference before
 * paint; without JavaScript the `:root` fallbacks keep the Paper light look.
 */
const initialPalette = getDesignPaletteTheme("paper", "light");

const brandTheme: BrandThemeStyle = {
  "--brand-highlight": site.palette.tonal.highlight,
  "--brand-key": site.palette.chromatic.key,
  "--brand-shadow": site.palette.tonal.shadow,
  "--brand-support": site.palette.chromatic.support,
};

export const metadata: Metadata = {
  metadataBase: new URL(site.origin),
  applicationName: site.name,
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { color: "#f8f7f4", media: "(prefers-color-scheme: light)" },
    { color: "#12100f", media: "(prefers-color-scheme: dark)" },
  ],
};

const websiteId = `${site.origin}/#website`;
const structuredData = [
  {
    "@context": "https://schema.org",
    "@id": websiteId,
    "@type": "WebSite",
    alternateName: ["AICharts", site.domain],
    description: site.description,
    name: site.name,
    url: `${site.origin}/`,
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    applicationCategory: "DataVisualizationApplication",
    description: site.description,
    featureList: [
      "Sourced AI model and agent benchmark charts",
      "Performance, cost, speed, and token-use comparisons",
      "Source-dated benchmark snapshots",
    ],
    isAccessibleForFree: true,
    isPartOf: { "@id": websiteId },
    name: site.name,
    operatingSystem: "Any",
    url: site.origin,
  },
];

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={initialPalette.className}
      data-hraness-material="lantern"
      data-palette="paper"
      lang="en"
      style={brandTheme}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body>
        <DesignPaletteProvider
          defaultPreference={{ palette: "paper", mode: "system" }}
          legacyStorageKey="aicharts-theme"
        >
          <ThemeColorSync darkColor="#12100f" lightColor="#f8f7f4" />
          <script
            dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c") }}
            type="application/ld+json"
          />
          {children}
          <MarketingSiteFooter
            ariaLabel="AI Charts"
            brand={(
              // eslint-disable-next-line @next/next/no-img-element -- the generated app icon serves the canonical mark unchanged.
              <img alt="" height={20} src="/icon.png" width={20} />
            )}
            brandHref="/"
            brandLabel="AI Charts home"
            links={SITE_HEADER_LINKS}
            name={site.name}
          />
          <HranessSiteFooter
            support={{
              id: "aicharts",
              name: "AI Charts",
              updates: true,
              valueProposition: "Support sourced benchmark research and clear, interactive model comparisons.",
            }}
            mailingList={aiChartsMailingListConfig()}
            social={{
              x: { href: "https://x.com/aichartsio", label: "AI Charts on X" },
              github: { href: "https://github.com/hraness/aicharts", label: "AI Charts on GitHub" },
            }}
          />
          <AnalyticsBoundary />
          <FoilController />
        </DesignPaletteProvider>
      </body>
    </html>
  );
}
