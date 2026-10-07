import { portfolioRelatedGroups } from "@hraness/design-kit/portfolio";
import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { ArticleFigure, MarketingAccount, MarketingAccountActions, MarketingRelated } from "@hraness/design-kit/react/server";
import Link from "next/link";
import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import { ChartNavigation, HomeExploreFooter } from "@/components/chart-navigation";
import { FounderNote } from "@/components/founder-note";
import { HomeActivityFeed } from "@/components/home-activity-feed";
import { HomeIndexStrip } from "@/components/home-index-strip";
import { UsageMockup } from "@/components/launch-mockups";
import { HomeIntelligenceEfficiency } from "@/components/home-intelligence-efficiency";
import { LegacyChartNavigation } from "@/components/legacy-chart-navigation";
import { ProjectAskAiAboutThis } from "@/components/project-ask-ai-about-this";
import { ModelReleaseRadars } from "@/components/release-radar";
import { SiteHeader } from "@/components/site-header";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  homeAboutHeading,
  homeAlternatives,
  homeAlternativesCheckedLabel,
  homeAlternativesClosing,
  homeAlternativesLead,
  homeHeading,
  homeLede,
  homePrimaryAction,
  homeSecondaryAction,
  searchSite,
  site,
} from "./site";

import { productMessaging } from "./messaging";

import "@/styles/chart-home.css";

export const metadata = createPublicSiteMetadata(searchSite, { canonicalPath: "/" });

export default function Home() {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(artificialAnalysisIntelligenceData);
  if (!parsed.ok) throw new Error(`Checked Intelligence snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
  return <>
    <SiteHeader current="/" />
    <main data-hraness-landscape="page" tabIndex={-1} className="chart-home hraness-marketing-main" id="main-content">
      <header className="chart-page-intro chart-home-hero">
        <h1 id="home-title">{homeHeading}</h1>
        <p className="chart-home-hero__lede">{homeLede}</p>
        <p className="chart-page-intro__actions">
          <Link className="chart-home-hero__primary" href={homePrimaryAction.href}>{homePrimaryAction.label}</Link>
          <Link className="chart-home-hero__secondary" href={homeSecondaryAction.href}>{homeSecondaryAction.label} <span aria-hidden="true">→</span></Link>
        </p>
      </header>
      <FounderNote
        emoji="📈"
        paragraphs={["aicharts plots published AI benchmark scores against cost and tokens per task, and marks the best score at every budget. A local collector adds your own agents' token use, so your work sits on the same chart."]}
        action={{ label: "See the charts:", href: "https://aicharts.io" }}
      />
      <ChartNavigation current="/" />
      <HomeIntelligenceEfficiency snapshot={parsed.value} />
      <section aria-labelledby="home-about-title" className="home-about">
        <h2 id="home-about-title">{homeAboutHeading}</h2>
        <p>{site.introduction}</p>
        <p>
          {homeAlternativesLead}
          {homeAlternatives.map(alternative => <span key={alternative.name}>
            {" "}<a href={alternative.href}>{alternative.name}</a>{alternative.sentence}
          </span>)}
          {" "}{homeAlternativesClosing} {homeAlternativesCheckedLabel}
        </p>
      </section>
      <section aria-labelledby="home-usage-title" className="home-about home-usage">
        <h2 id="home-usage-title">Measure your own agents</h2>
        <p>The aicharts collector adds up the tokens, cost and time your coding agents use, per model and day. Prompts and transcripts stay on your machine. In development. <Link href="/usage">How it works <span aria-hidden="true">→</span></Link></p>
        <ArticleFigure caption="The usage dashboard, with made-up numbers." kind="illustration" width="wide">
          <UsageMockup />
        </ArticleFigure>
      </section>
      <HomeIndexStrip />
      <ModelReleaseRadars />
      <HomeActivityFeed />
      <section aria-labelledby="home-calculator-title" className="home-calculator" data-analytics-surface="home_calculator">
        <div className="home-calculator__copy">
          <h2 id="home-calculator-title">{productMessaging.headings["home-calculator"]}</h2>
          <p>One maxed ChatGPT Pro seat implies a monthly token volume. The calculator prices it five ways: the subscription sticker, OpenAI and DeepSeek API rates, GPUs you buy, and GPUs you rent.</p>
        </div>
        <Link className="home-calculator__cta" href="/calculator">Open the calculator <span aria-hidden="true">↗</span></Link>
      </section>
      <MarketingAccount summary="Keep your agent usage in a private dashboard. Public charts and local reports work without an account.">
        <MarketingAccountActions
          primary={{ href: "/api/suite-auth/start?return_to=%2Fdashboard", label: "Create account" }}
          signIn={{ href: "/api/suite-auth/start?return_to=%2Fdashboard" }}
        />
      </MarketingAccount>
      <MarketingRelated
        groups={portfolioRelatedGroups(["xcb", "gobstopper", "wrench", "peopleblade", "soulscrape", "message-like-me", "kb"])}
        heading="Other tools from our studio"
        headingId="related-title"
      />
      <HomeExploreFooter />
      <LegacyChartNavigation />
    </main>
    <ProjectAskAiAboutThis url={site.origin} />
  </>;
}
