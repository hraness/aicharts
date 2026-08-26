import { HranessBrand, SkipLink, ThemeMenuButton } from "@/components/ui";
import { chatGptSubsidyChartLabel } from "@/app/site";
import Link from "next/link";
import type { ReactNode } from "react";

export default function GptSubsidyLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="plain-site plain-publication aicharts-gpt-subsidy">
      <SkipLink href="#gpt-subsidy-content">Skip to subsidy chart</SkipLink>
      <header className="plain-header">
        <div className="plain-header__inner">
          <Link className="plain-wordmark" href="/">
            aicharts.io
          </Link>
          <div className="plain-header__actions">
            <nav aria-label="GPT subsidy navigation" className="plain-nav">
              <Link href="/">Home</Link>
              <Link href="/models">Cards</Link>
              <Link href="/data">Data</Link>
              <Link href="/blog">Blog</Link>
            </nav>
            <ThemeMenuButton aria-label="GPT subsidy appearance" />
          </div>
        </div>
      </header>
      {children}
      <footer className="plain-footer">
        <p>aicharts.io</p>
        <div className="plain-footer__links">
          <Link href="/gpt-subsidy">{chatGptSubsidyChartLabel}</Link>
          <Link href="/models">Cards</Link>
          <Link href="/">Home</Link>
          <Link href="/data">Data</Link>
          <Link href="/blog">Blog</Link>
          <HranessBrand />
        </div>
      </footer>
    </div>
  );
}
