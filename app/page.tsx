import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";
import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import { ChartNavigation, ChartPageFooter } from "@/components/chart-navigation";
import { HomeIntelligenceEfficiency } from "@/components/home-intelligence-efficiency";
import { LegacyChartNavigation } from "@/components/legacy-chart-navigation";
import { ProjectAskAiAboutThis } from "@/components/project-ask-ai-about-this";
import { SiteHeader } from "@/components/site-header";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import { homeHeading, homeLede, homeTaskLinks, searchSite, site } from "./site";

import "@/styles/chart-home.css";

export const metadata = createPublicSiteMetadata(searchSite, { canonicalPath: "/" });

export default function Home() {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(artificialAnalysisIntelligenceData);
  if (!parsed.ok) throw new Error(`Checked Intelligence snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
  return <>
    <SiteHeader current="/" />
    <main className="chart-home" id="main-content">
      <header className="chart-page-intro">
        <h1 id="home-title">{homeHeading}</h1>
        <p>{homeLede}</p>
      </header>
      <ChartNavigation current="/" />
      <HomeIntelligenceEfficiency snapshot={parsed.value} />
      <section aria-labelledby="home-calculator-title" className="home-calculator" data-analytics-surface="home_calculator">
        <div className="home-calculator__copy">
          <h2 id="home-calculator-title">Subscription vs API vs GPUs</h2>
          <p>One maxed ChatGPT Pro seat implies a monthly token volume. The calculator prices it five ways: the subscription sticker, OpenAI and DeepSeek API rates, GPUs you buy, and GPUs you rent.</p>
        </div>
        <Link className="home-calculator__cta" href="/calculator">Open the calculator <span aria-hidden="true">↗</span></Link>
      </section>
      <section className="task-discovery" aria-labelledby="task-discovery-title">
        <header><h2 id="task-discovery-title">What do you want to do?</h2><Link href="/benchmarks">All benchmarks <span aria-hidden="true">↗</span></Link></header>
        <div className="task-discovery__links">
          {homeTaskLinks.map(({ task, name, description }) => <Link href={`/benchmarks?task=${task}#explore`} key={task}>
            <span><strong>{name}</strong><span>{description}</span></span><span aria-hidden="true">↗</span>
          </Link>)}
        </div>
      </section>
      <ChartPageFooter />
      <LegacyChartNavigation />
    </main>
    <ProjectAskAiAboutThis url={site.origin} />
  </>;
}
