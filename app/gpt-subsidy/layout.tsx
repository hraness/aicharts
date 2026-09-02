import { SkipLink, ThemeMenuButton } from "@/components/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export default function GptSubsidyLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="plain-site plain-publication aicharts-gpt-subsidy">
      <SkipLink href="#gpt-subsidy-content">Skip to subsidy chart</SkipLink>
      <header className="plain-header" data-analytics-surface="global_header">
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
    </div>
  );
}
