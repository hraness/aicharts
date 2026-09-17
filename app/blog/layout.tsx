import { SkipLink, ThemeMenuButton } from "@/components/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export default function BlogLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="plain-site plain-publication aicharts-blog">
      <SkipLink href="#blog-content">Skip to benchmark notes</SkipLink>
      <header className="plain-header hraness-material-chrome" data-analytics-surface="global_header">
        <div className="plain-header__inner">
          <Link className="plain-wordmark" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- the generated app icon serves the canonical mark unchanged. */}
            <img alt="" height={20} src="/icon.png" width={20} />{" "}aicharts.io
          </Link>
          <div className="plain-header__actions">
            <nav aria-label="Blog navigation" className="plain-nav">
              <Link href="/blog">Blog</Link>
              <Link href="/models">Cards</Link>
              <Link href="/data">Data</Link>
              <Link href="/">Home</Link>
            </nav>
            <ThemeMenuButton aria-label="Blog appearance" />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
