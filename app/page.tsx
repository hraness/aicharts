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
import { homeHeading, homeLede, searchSite, site } from "./site";

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
        <h1 id="home-title">{homeHeading}</h1>
        <p>{homeLede}</p>
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
                role: "A metaharness for agent subscriptions",
                relationship: "xcb runs the agent subscriptions Aicharts inspects, meters each account locally, and can publish usage here when you opt in.",
              },
              {
                name: "Gobstopper",
                href: "https://gobstopper.sh",
                role: "Automatic context compaction for agent sessions",
                relationship: "Gobstopper cuts the context bill; Aicharts makes the bill visible per model and per session.",
              },
              {
                name: "Ghostget",
                href: "https://ghostget.com",
                role: "A bounded bridge to provider data",
                relationship: "Ghostget bounds what each web read costs in tokens; Aicharts bounds what the models behind those reads cost.",
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
                role: "A private contact book for you and your agent",
                relationship: "PeopleBlade's agent researches your contacts; Aicharts shows which model does that work cheapest and what a run spent.",
              },
              {
                name: "Soulscrape",
                href: "https://soulscrape.com",
                role: "A dated, cited dossier on a person",
                relationship: "A Soulscrape dossier run is exactly the kind of token spend Aicharts measures and compares.",
              },
              {
                name: "Textbutler",
                href: "https://textbutler.app",
                role: "A personal message butler for Mac",
                relationship: "Textbutler drafts through your chosen agent; Aicharts benchmarks the models that can drive it.",
              },
              {
                name: "Wordcell",
                href: "https://wordcell.io",
                role: "A Markdown knowledge base for agents",
                relationship: "Wordcell's agent queries your vault; Aicharts shows the capability and cost tradeoffs for that loop.",
              },
            ],
          },
        ]}
        heading="From the same workshop."
        headingId="related-title"
        label="Related"
        summary="Each Hraness product owns one private domain and gives your agent the same kind of access: local, bounded, and inspectable."
      />
      <HomeExploreFooter />
      <LegacyChartNavigation />
    </main>
    <ProjectAskAiAboutThis url={site.origin} />
  </>;
}
