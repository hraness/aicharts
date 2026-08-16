import { HranessBrand, SkipLink, ThemeToggle } from "@/components/ui";
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
          <nav aria-label="Dataset navigation" className="plain-nav">
            <Link aria-current="page" href="/data">Data</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/">Chart</Link>
            <ThemeToggle
              aria-label="Dataset appearance"
              presentation="menu"
              size="compact"
            />
          </nav>
        </div>
      </header>
      {children}
      <footer className="plain-footer">
        <p>aicharts.io</p>
        <div className="plain-footer__links">
          <Link href="/data">Data</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/">Chart</Link>
          <HranessBrand />
        </div>
      </footer>
    </div>
  );
}
