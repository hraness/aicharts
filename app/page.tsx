import { createPublicSiteMetadata } from "@hraness/web-discovery";
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
      <HomeIndexStrip />
      <ModelReleaseRadars />
      <header className="chart-page-intro">
        <h1 id="home-title">{homeHeading}</h1>
        <p>{homeLede}</p>
      </header>
      <ChartNavigation current="/" />
      <HomeIntelligenceEfficiency snapshot={parsed.value} />
      <HomeActivityFeed />
      <section aria-labelledby="home-calculator-title" className="home-calculator" data-analytics-surface="home_calculator">
        <div className="home-calculator__copy">
          <TopicIcon className="home-calculator__icon" size={88} slug="cost-compare" />
          <h2 id="home-calculator-title">Subscription vs API vs GPUs</h2>
          <p>One maxed ChatGPT Pro seat implies a monthly token volume. The calculator prices it five ways: the subscription sticker, OpenAI and DeepSeek API rates, GPUs you buy, and GPUs you rent.</p>
        </div>
        <Link className="home-calculator__cta" href="/calculator">Open the calculator <span aria-hidden="true">↗</span></Link>
      </section>
      <HomeExploreFooter />
      <LegacyChartNavigation />
    </main>
    <ProjectAskAiAboutThis url={site.origin} />
  </>;
}
