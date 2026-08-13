import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";

import "./globals.css";
import { searchSite, site } from "./site";

type BrandThemeStyle = CSSProperties & Readonly<{
  "--brand-highlight": string;
  "--brand-key": string;
  "--brand-shadow": string;
  "--brand-support": string;
}>;

const brandTheme: BrandThemeStyle = {
  "--brand-highlight": site.palette.tonal.highlight,
  "--brand-key": site.palette.chromatic.key,
  "--brand-shadow": site.palette.tonal.shadow,
  "--brand-support": site.palette.chromatic.support,
};

export const metadata: Metadata = {
  metadataBase: new URL(site.origin),
  title: searchSite.title,
  description: searchSite.description,
  alternates: { canonical: "/" },
  applicationName: site.name,
  openGraph: {
    type: "website",
    url: "/",
    siteName: site.name,
    title: searchSite.title,
    description: searchSite.description,
    images: [{ url: searchSite.socialImage.path, alt: searchSite.socialImage.alt }],
  },
  twitter: {
    card: "summary_large_image",
    title: searchSite.title,
    description: searchSite.description,
    images: [searchSite.socialImage.path],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#f8f7f4",
};

const websiteId = `${site.origin}/#website`;
const structuredData = [
  {
    "@context": "https://schema.org",
    "@id": websiteId,
    "@type": "WebSite",
    description: site.description,
    name: site.name,
    url: `${site.origin}/`,
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    applicationCategory: "DeveloperApplication",
    description: site.description,
    featureList: [
      "Side-by-side coding-agent comparison",
      "Model and provider filters",
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
    <html data-theme="light" lang="en" style={brandTheme} suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: "try{const t=localStorage.getItem('codingchart-theme');const d=t==='dark'||(t!==\"light\"&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light'}catch{}",
          }}
        />
        <script
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c") }}
          type="application/ld+json"
        />
        {children}
      </body>
    </html>
  );
}
