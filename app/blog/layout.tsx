import { SkipLink, ThemeMenuButton } from "@/components/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export default function BlogLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="plain-site plain-publication aicharts-blog">
      <SkipLink href="#blog-content">Skip to benchmark notes</SkipLink>
      <header className="plain-header" data-analytics-surface="global_header">
        <div className="plain-header__inner">
          <Link className="plain-wordmark" href="/">
            aicharts.io
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
