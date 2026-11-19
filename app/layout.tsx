import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://aicharts.io"),
  title: "aicharts — Coding Model Releases & Effort Pareto Curves",
  description:
    "Track AI coding model releases from Anthropic, OpenAI, and Google with normalized benchmarks and cost-vs-performance effort-level Pareto curves.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "aicharts — Coding Model Effort Pareto Curves",
    description:
      "Minimal release feed and normalized cost-vs-performance Pareto curves across Anthropic, OpenAI, and Google coding models.",
    url: "https://aicharts.io",
    siteName: "aicharts",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "aicharts — Coding Model Effort Pareto Curves",
    description:
      "Normalized coding benchmarks and effort-level Pareto frontiers for Anthropic, OpenAI, and Google.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("aicharts-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
