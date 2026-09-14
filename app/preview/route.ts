import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetSummary,
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
} from "@/lib/coding-agent-dataset";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

import { site } from "../site";

export const dynamic = "force-static";

const contentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' https://hraness.com",
  "img-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

const canonicalUrl = new URL("/", site.origin).toString();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) {
  throw new Error(
    `Checked coding-agent snapshot is invalid: ${parsed.error.message}`,
    { cause: parsed.error },
  );
}

const snapshot = parsed.value;
const summary = codingAgentDatasetSummary(snapshot);
const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
const leaderCards = leaders.map(leader => `
      <li>
        <div>
          <span>${escapeHtml(leader.definition.label)}</span>
          <strong>${escapeHtml(leader.record.model)}</strong>
          <small>${escapeHtml(leader.record.agent)} · ${escapeHtml(leader.record.setting)}</small>
        </div>
        <b aria-label="${escapeHtml(leader.definition.label)} score ${formatBenchmarkScore(leader.value)}">${formatBenchmarkScore(leader.value)}</b>
      </li>`).join("");

const document = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <link rel="canonical" href="${canonicalUrl}">
  <title>AI model and agent comparison charts | AI Charts</title>
  <style>
    * { box-sizing: border-box; }
    html { color-scheme: light; }
    body {
      align-items: center;
      background:
        radial-gradient(circle at 84% 16%, rgb(94 46 2 / 14%), transparent 30rem),
        #f8f7f4;
      color: #1c1917;
      display: flex;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      justify-content: center;
      margin: 0;
      min-block-size: 100svh;
      padding: clamp(1rem, 4vw, 3rem);
    }
    main {
      display: grid;
      gap: clamp(1.5rem, 4vw, 3rem);
      inline-size: min(100%, 72rem);
    }
    header { display: grid; gap: .75rem; }
    .brand {
      align-items: center;
      color: #5e2e02;
      display: flex;
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: clamp(.7rem, 1.35vw, .85rem);
      gap: .55rem;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .mark {
      border: 2px solid currentColor;
      border-radius: 50%;
      display: grid;
      inline-size: 1.05rem;
      place-items: center;
      block-size: 1.05rem;
    }
    .mark::after {
      background: currentColor;
      border-radius: inherit;
      content: "";
      inline-size: .3rem;
      block-size: .3rem;
    }
    h1 {
      font-size: clamp(2rem, 7vw, 5.25rem);
      letter-spacing: -.06em;
      line-height: .92;
      margin: 0;
      max-inline-size: 14ch;
      text-wrap: balance;
    }
    .summary {
      color: #625d57;
      font-size: clamp(.9rem, 2vw, 1.15rem);
      line-height: 1.5;
      margin: 0;
    }
    ul {
      display: grid;
      gap: 1px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      list-style: none;
      margin: 0;
      overflow: hidden;
      padding: 1px;
    }
    li {
      align-items: end;
      background: rgb(255 255 255 / 70%);
      box-shadow: 0 0 0 1px rgb(41 18 1 / 14%);
      display: flex;
      gap: 1rem;
      justify-content: space-between;
      min-block-size: 8rem;
      padding: clamp(1rem, 3vw, 1.65rem);
    }
    li div { display: grid; gap: .28rem; min-inline-size: 0; }
    li span,
    li small,
    footer {
      color: #756f68;
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: clamp(.62rem, 1.25vw, .76rem);
      letter-spacing: .045em;
      text-transform: uppercase;
    }
    li strong {
      font-size: clamp(.9rem, 2.2vw, 1.3rem);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    li b {
      color: #5e2e02;
      font-size: clamp(1.8rem, 5vw, 3.25rem);
      font-variant-numeric: tabular-nums;
      letter-spacing: -.06em;
      line-height: .8;
    }
    footer { line-height: 1.5; }
    @media (max-width: 38rem) {
      ul { grid-template-columns: 1fr; }
      li { min-block-size: 5.5rem; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand"><i aria-hidden="true" class="mark"></i>${site.domain}</div>
      <h1>AI model and agent comparison charts</h1>
      <p class="summary">${summary.recordCount} model-agent configurations across ${summary.modelCount} models and ${summary.providerCount} providers.</p>
    </header>
    <ul aria-label="Current coding-agent benchmark leaders">${leaderCards}
    </ul>
    <footer>Checked ${escapeHtml(snapshot.source.name)} snapshot · ${escapeHtml(formatRetrievedAt(snapshot.source.retrievedAt))}</footer>
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
