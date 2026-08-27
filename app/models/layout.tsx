import { SkipLink, ThemeMenuButton, TopBar } from "@/components/ui";
import { chatGptSubsidyChartLabel } from "@/app/site";
import Link from "next/link";
import type { ReactNode } from "react";

export default function ModelsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="model-cards-site">
      <SkipLink href="#model-cards-content">Skip to model cards</SkipLink>
      <TopBar
        actions={(
          <>
            <nav aria-label="Model card navigation" className="model-cards-nav">
              <Link href="/">Home</Link>
              <Link aria-current="page" href="/models">Cards</Link>
              <Link href="/data">Data</Link>
              <Link href="/blog">Blog</Link>
              <Link className="model-cards-nav__optional-link" href="/gpt-subsidy">
                {chatGptSubsidyChartLabel}
              </Link>
            </nav>
            <ThemeMenuButton aria-label="Model card appearance" />
          </>
        )}
        className="model-cards-header"
        title={<Link className="model-cards-wordmark" href="/">aicharts.io</Link>}
      />
      {children}
      <aside aria-label="Model card resources" className="model-cards-footer">
        <p>aicharts.io</p>
        <nav aria-label="Model card links" className="model-cards-footer__links">
          <Link href="/data">Data and method</Link>
        </nav>
      </aside>
    </div>
  );
}
