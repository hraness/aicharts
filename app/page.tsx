import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { MarketingRelated } from "@hraness/design-kit/react/server";
import Link from "next/link";
import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import { ChartNavigation, HomeExploreFooter } from "@/components/chart-navigation";
import { HomeActivityFeed } from "@/components/home-activity-feed";
import { HomeIndexStrip } from "@/components/home-index-strip";
import { HomeIntelligenceEfficiency } from "@/components/home-intelligence-efficiency";
import { LegacyChartNavigation } from "@/components/legacy-chart-navigation";
import { ProjectAskAiAboutThis } from "@/components/project-ask-ai-about-this";
import { ModelReleaseRadars } from "@/components/release-radar";
import { SiteHeader } from "@/components/site-header";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  homeEyebrow,
  homeHeading,
  homeLede,
  homePrimaryAction,
  homeSecondaryAction,
  searchSite,
  site,
} from "./site";

function TopicIcon({ className, size, slug }: Readonly<{ className: string; size: number; slug: string }>) {
  // Decorative local SVG; next/image cannot optimize vector sources.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={`/icons/${slug}.svg`} alt="" aria-hidden="true" width={size} height={size} loading="lazy" decoding="async" />
  );
}

import "@/styles/chart-home.css";

export const metadata = createPublicSiteMetadata(searchSite, { canonicalPath: "/" });

export default function Home() {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(artificialAnalysisIntelligenceData);
  if (!parsed.ok) throw new Error(`Checked Intelligence snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
  return <>
    <SiteHeader current="/" />
    <main className="chart-home hraness-marketing-main" id="main-content">
      <header className="chart-page-intro">
        <p className="chart-page-intro__eyebrow">{homeEyebrow}</p>
        <h1 id="home-title">{homeHeading}</h1>
        <p>{homeLede}</p>
        <p className="chart-page-intro__actions">
          <Link href={homePrimaryAction.href}>{homePrimaryAction.label}</Link>
          <Link href={homeSecondaryAction.href}>{homeSecondaryAction.label}</Link>
        </p>
      </header>
      <ChartNavigation current="/" />
      <HomeIntelligenceEfficiency snapshot={parsed.value} />
      <HomeIndexStrip />
      <ModelReleaseRadars />
      <HomeActivityFeed />
      <section aria-labelledby="home-calculator-title" className="home-calculator" data-analytics-surface="home_calculator">
        <div className="home-calculator__copy">
          <TopicIcon className="home-calculator__icon" size={88} slug="cost-compare" />
          <h2 id="home-calculator-title">Subscription vs API vs GPUs</h2>
          <p>One maxed ChatGPT Pro seat implies a monthly token volume. The calculator prices it five ways: the subscription sticker, OpenAI and DeepSeek API rates, GPUs you buy, and GPUs you rent.</p>
        </div>
        <Link className="home-calculator__cta" href="/calculator">Open the calculator <span aria-hidden="true">↗</span></Link>
      </section>
      <MarketingRelated
        groups={[
          {
            heading: "The agent platform",
            headingId: "related-tools",
            summary: "The layer your agent runs through: sessions, accounts, web reads, and the models behind them.",
            items: [
              {
                name: "xcb",
                href: "https://xcb.sh",
                role: "Routes coding tasks across the Claude, Codex, and Devin plans you have",
                relationship: "xcb measures subscription usage locally and, when you turn on exports, writes session files in the AI Charts format. Automatic upload is not available.",
              },
              {
                name: "Gobstopper",
                href: "https://gobstopper.sh",
                role: "Compacts long agent sessions into smaller copies, keeping every byte",
                relationship: null,
              },
              {
                name: "Ghostget",
                href: "https://ghostget.com",
                role: "Named web actions for AI agents: read pages, save media, use connected accounts",
                relationship: null,
              },
            ],
          },
          {
            heading: "The personal apps",
            headingId: "related-apps",
            items: [
              {
                name: "PeopleBlade",
                href: "https://peopleblade.com",
                role: "Local personal CRM for everyone you know, built for your agent",
                relationship: null,
              },
              {
                name: "Soulscrape",
                href: "https://soulscrape.com",
                role: "Free agent skill that writes dated dossiers on people, sources cited",
                relationship: null,
              },
              {
                name: "Textbutler",
                href: "https://textbutler.app",
                role: "AI butler for the iMessage, WhatsApp, and Beeper chats you choose",
                relationship: null,
              },
              {
                name: "Wordcell",
                href: "https://wordcell.io",
                role: "Markdown knowledge base that gives agents the decisions behind code",
                relationship: null,
              },
            ],
          },
        ]}
        heading="From the same workshop."
        headingId="related-title"
        label="Related"
        summary="Other Hraness tools for people who work with AI agents."
      />
      <HomeExploreFooter />
      <LegacyChartNavigation />
    </main>
    <ProjectAskAiAboutThis url={site.origin} />
  </>;
}
