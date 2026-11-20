import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://aicharts.io"),
  title: "LLM benchmarks by score, cost and reasoning effort | aicharts",
  description:
    "Compare Claude, GPT and Gemini across LLM benchmarks. See how task scores change with API cost, output tokens and reasoning effort.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "LLM benchmarks by score, cost and reasoning effort | aicharts",
    description:
      "Compare OpenAI, Anthropic and Google models by reasoning effort, score, API cost and output tokens.",
    url: "https://aicharts.io",
    siteName: "aicharts",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LLM benchmarks by score, cost and reasoning effort | aicharts",
    description:
      "Compare OpenAI, Anthropic and Google models by reasoning effort, score, API cost and output tokens.",
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
