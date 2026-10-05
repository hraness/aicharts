import { PlatformInstall } from "@hraness/design-kit/react";
import { ArticleFigure, PlatformBadges } from "@hraness/design-kit/react/server";
import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";

import { ChartPageFooter } from "@/components/chart-navigation";
import { UsageMockup } from "@/components/launch-mockups";
import { SiteHeader } from "@/components/site-header";
import { CopyCommand } from "@/components/usage/copy-command";
import { searchSite } from "@/app/site";
import {
  usageDashboard,
  usageHero,
  usageLocalReport,
  usageSetup,
  usageSimilarTools,
  usageTrust,
  type UsageCopy,
} from "./content";
import { usageInstallPlatforms } from "./install";

import "@/styles/usage.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI usage tracking | aicharts",
  description: "Track tokens, models, cost, and speed across your coding agents and AI clients, measured on your own machine and listed with the sources behind each total.",
}, { canonicalPath: "/usage" });

function CopyText({ copy }: { copy: UsageCopy }) {
  return <>{copy.map((segment, index) => typeof segment === "string"
    ? segment
    : "code" in segment
      ? <code key={index}>{segment.code}</code>
      : <a href={segment.href} key={index}>{segment.text}</a>)}</>;
}

export default function UsagePage() {
  return <>
    <SiteHeader current="/usage" />
    <main data-hraness-landscape="page" tabIndex={-1} className="usage-home" id="main-content">
      <section className="usage-hero usage-hero--single" aria-labelledby="usage-title">
        <div className="usage-hero__copy">
          <p className="usage-eyebrow">{usageHero.eyebrow}</p>
          <h1 id="usage-title">{usageHero.heading}</h1>
          <p className="usage-hero__lede">{usageHero.lede}</p>
          <div className="usage-hero__actions">
            <Link className="usage-button usage-button--primary" href={usageHero.dashboardAction.href}>{usageHero.dashboardAction.label} <span className="usage-button__arrow" aria-hidden="true">→</span></Link>
            <Link className="usage-button usage-button--quiet" href={usageHero.setupAction.href}>{usageHero.setupAction.label}</Link>
          </div>
          <p className="usage-hero__note"><CopyText copy={usageHero.status} /></p>
          <PlatformBadges className="usage-platforms" platforms={usageHero.platforms} />
        </div>
      </section>

      <section className="usage-section usage-similar" aria-labelledby="usage-similar-title">
        <h2 id="usage-similar-title">{usageSimilarTools.heading}</h2>
        <p><CopyText copy={usageSimilarTools.body} /></p>
      </section>

      <section className="usage-section" id="usage-setup" aria-labelledby="usage-setup-title">
        <div className="usage-section__intro">
          <div><span className="usage-eyebrow">{usageSetup.eyebrow}</span><h2 id="usage-setup-title">{usageSetup.heading}</h2></div>
          <p>{usageSetup.intro}</p>
        </div>
        <ol className="usage-steps">
          {usageSetup.steps.map(({ title, description }, index) => <li className="usage-card usage-step" key={title}>
            <span className="usage-step__number" aria-hidden="true">{index + 1}</span><h3>{title}</h3><p>{description}</p>
          </li>)}
        </ol>
        <PlatformInstall className="usage-install" id="collector-install" label={usageSetup.installLabel} platforms={usageInstallPlatforms} />
        <CopyCommand command={usageSetup.enroll.command} label={usageSetup.enroll.label} note={usageSetup.enroll.note} />
        <div className="usage-setup__foot">
          {usageSetup.guides.map(guide => <Link className="usage-button usage-button--quiet usage-button--small" href={guide.href} key={guide.href}>{guide.label} <span className="usage-button__arrow" aria-hidden="true">↗</span></Link>)}
        </div>
      </section>

      <section className="usage-section" aria-labelledby="usage-metrics-title">
        <div className="usage-section__intro">
          <div><span className="usage-eyebrow">{usageDashboard.eyebrow}</span><h2 id="usage-metrics-title">{usageDashboard.heading}</h2></div>
          <p>{usageDashboard.intro}</p>
        </div>
        <ArticleFigure caption={usageDashboard.illustrationCaption} className="usage-preview" kind="illustration" width="wide">
          <UsageMockup />
        </ArticleFigure>
        <ul className="usage-metric-grid">
          {usageDashboard.metrics.map(({ label, title, description }, index) => <li className="usage-card usage-metric-card" key={title} data-series={index % 5}>
            <span className="usage-metric-card__label"><i aria-hidden="true" />{label}</span><h3>{title}</h3><p>{description}</p>
          </li>)}
        </ul>
      </section>

      <section className="usage-section" aria-labelledby="usage-local-title">
        <div className="usage-card usage-local">
          <div>
            <span className="usage-eyebrow">{usageLocalReport.eyebrow}</span>
            <h2 id="usage-local-title">{usageLocalReport.heading}</h2>
            {usageLocalReport.paragraphs.map((paragraph, index) => <p key={index}><CopyText copy={paragraph} /></p>)}
          </div>
          <div>
            <CopyCommand command={usageLocalReport.report.command} label={usageLocalReport.report.label} note={usageLocalReport.report.note} />
            <Link className="usage-button usage-button--primary" href={usageLocalReport.action.href}>{usageLocalReport.action.label} <span className="usage-button__arrow" aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <section className="usage-trust" aria-labelledby="usage-trust-title">
        <div><h2 id="usage-trust-title">{usageTrust.heading}</h2><p>{usageTrust.body}</p></div>
        <ul>{usageTrust.points.map(point => <li key={point}>{point}</li>)}</ul>
      </section>
      <ChartPageFooter />
    </main>
  </>;
}
