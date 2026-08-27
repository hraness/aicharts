import { SkipLink, ThemeMenuButton } from "@/components/ui";
import { chatGptSubsidyChartLabel } from "@/app/site";
import Link from "next/link";
import type { ReactNode } from "react";

export default function DataLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="plain-site plain-publication aicharts-data">
      <SkipLink href="#data-content">Skip to dataset details</SkipLink>
      <header className="plain-header">
        <div className="plain-header__inner">
          <Link className="plain-wordmark" href="/">
            aicharts.io
          </Link>
          <div className="plain-header__actions">
            <nav aria-label="Dataset navigation" className="plain-nav">
              <Link aria-current="page" href="/data">Data</Link>
              <Link href="/models">Cards</Link>
              <Link href="/blog">Blog</Link>
              <Link href="/gpt-subsidy">{chatGptSubsidyChartLabel}</Link>
              <Link href="/">Home</Link>
            </nav>
            <ThemeMenuButton aria-label="Dataset appearance" />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
