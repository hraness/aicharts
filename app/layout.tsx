import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://aicharts.io"),
  title: "AI model comparison chart for coding: score vs cost — aicharts",
  description:
    "Compare AI models by reasoning effort, score and cost. Explore GameBench 2 coding curves, Terminal-Bench agent runs and Epoch AI benchmark scores.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "AI model comparison chart for coding — aicharts",
    description:
      "Compare OpenAI, Anthropic and Google models by reasoning effort, coding score and cost.",
    url: "https://aicharts.io",
    siteName: "aicharts",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI model comparison chart for coding — aicharts",
    description:
      "Compare OpenAI, Anthropic and Google models by reasoning effort, coding score and cost.",
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
