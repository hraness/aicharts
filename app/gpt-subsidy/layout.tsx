import { HranessBrand, SkipLink, ThemeMenuButton } from "@/components/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export default function GptSubsidyLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="plain-site plain-publication aicharts-gpt-subsidy">
      <SkipLink href="#gpt-subsidy-content">Skip to subsidy history</SkipLink>
      <header className="plain-header">
        <div className="plain-header__inner">
          <Link className="plain-wordmark" href="/">
            aicharts.io
          </Link>
          <div className="plain-header__actions">
            <nav aria-label="GPT subsidy navigation" className="plain-nav">
              <Link aria-current="page" href="/gpt-subsidy">Subsidy</Link>
              <Link href="/">Chart</Link>
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
          <Link href="/gpt-subsidy">Subsidy</Link>
          <Link href="/">Chart</Link>
          <Link href="/data">Data</Link>
          <Link href="/blog">Blog</Link>
          <HranessBrand />
        </div>
      </footer>
    </div>
  );
}
