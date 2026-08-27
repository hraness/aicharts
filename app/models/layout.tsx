import { SkipLink, ThemeMenuButton } from "@/components/ui";
import { chatGptSubsidyChartLabel } from "@/app/site";
import Link from "next/link";
import type { ReactNode } from "react";

export default function ModelsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="model-cards-site">
      <SkipLink href="#model-cards-content">Skip to model cards</SkipLink>
      <header className="model-cards-header">
        <Link className="model-cards-wordmark" href="/">aicharts.io</Link>
        <div className="model-cards-header__actions">
          <nav aria-label="Model card navigation" className="model-cards-nav">
            <Link href="/">Home</Link>
            <Link aria-current="page" href="/models">Cards</Link>
            <Link href="/data">Data</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/gpt-subsidy">{chatGptSubsidyChartLabel}</Link>
          </nav>
          <ThemeMenuButton aria-label="Model card appearance" />
        </div>
      </header>
      {children}
      <aside aria-label="Model card resources" className="model-cards-footer">
        <p>aicharts.io</p>
        <nav aria-label="Model card links">
          <a href="https://lobehub.com/icons" rel="noopener noreferrer" target="_blank">Icons by LobeHub</a>
          <Link href="/data">Data and method</Link>
        </nav>
      </aside>
    </div>
  );
}
