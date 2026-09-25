import { paletteColors } from "@hraness/design-kit";

import { site } from "@/app/site";
import { MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL } from "@/lib/model-card-collection";

export const dynamic = "force-static";

const contentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors https://hraness.com https://www.hraness.com",
  "img-src 'self'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

const canonicalUrl = new URL("/models", site.origin).toString();

const palette = paletteColors["tokyo-night"];

const document = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <link rel="canonical" href="${canonicalUrl}">
  <title>AI model pages | AI Charts</title>
  <style>
    * { box-sizing: border-box; }
    html {
      color-scheme: light dark;
      --background: light-dark(${palette.light.background}, ${palette.dark.background});
      --foreground: light-dark(${palette.light.foreground}, ${palette.dark.foreground});
      --muted: light-dark(${palette.light.muted}, ${palette.dark.muted});
    }
    body {
      align-items: center;
      background: var(--background);
      color: var(--foreground);
      display: flex;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      justify-content: center;
      margin: 0;
      min-block-size: 100svh;
      padding: clamp(1rem, 4vw, 2.5rem);
    }
    main {
      display: grid;
      gap: clamp(1rem, 3vw, 1.75rem);
      inline-size: min(100%, 72rem);
    }
    img {
      aspect-ratio: 1200 / 630;
      border: 1px solid transparent;
      border-radius: clamp(.85rem, 2vw, 1.5rem);
      box-shadow: 0 1rem 3rem -1rem light-dark(rgb(24 32 62 / 25%), rgb(0 0 0 / 45%));
      display: block;
      inline-size: 100%;
      object-fit: cover;
    }
    header {
      align-items: end;
      display: flex;
      flex-wrap: wrap;
      gap: .7rem 1.25rem;
      justify-content: space-between;
    }
    h1 {
      font-size: clamp(1.25rem, 4vw, 2.4rem);
      letter-spacing: -.025em;
      line-height: 1.15;
      margin: 0;
      text-wrap: balance;
    }
    p {
      color: var(--muted);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: clamp(.8125rem, 1.5vw, .9rem);
      letter-spacing: .06em;
      margin: 0;
      text-transform: uppercase;
    }
    @media (forced-colors: active) { img { border-color: CanvasText; box-shadow: none; } }
  </style>
</head>
<body>
  <main>
    <img alt="AI Charts model pages arranged by provider" src="${MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL}">
    <header>
      <h1>AI model pages</h1>
      <p>aicharts.io/models</p>
    </header>
  </main>
</body>
</html>
`;

export function GET(): Response {
  return new Response(document, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Security-Policy": contentSecurityPolicy,
      "Content-Type": "text/html; charset=utf-8",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
