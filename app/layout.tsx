import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://aicharts.io"),
  title: "AI model comparison chart for coding: score vs cost — aicharts",
  description:
    "Compare AI models for coding on one chart: Terminal-Bench score against cost per task. Find the best AI model for coding at your budget.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "AI model comparison chart for coding — aicharts",
    description:
      "Every Anthropic, OpenAI and Google coding model on one chart: Terminal-Bench score against cost per task.",
    url: "https://aicharts.io",
    siteName: "aicharts",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI model comparison chart for coding — aicharts",
    description:
      "Every Anthropic, OpenAI and Google coding model on one chart: Terminal-Bench score against cost per task.",
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
        <link
          rel="preload"
          href="/fonts/FunnelDisplay.a18ddd52.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
