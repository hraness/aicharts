import { HranessBrand, SkipLink, ThemeToggle } from "@/components/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export default function BlogLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="plain-site plain-publication codingchart-blog">
      <SkipLink href="#blog-content">Skip to benchmark notes</SkipLink>
      <header className="plain-header">
        <div className="plain-header__inner">
          <Link className="plain-wordmark" href="/">
            codingchart.com
          </Link>
          <nav aria-label="Blog navigation" className="plain-nav">
            <Link href="/blog">Blog</Link>
            <Link href="/">Chart</Link>
            <ThemeToggle
              aria-label="Blog appearance"
              presentation="menu"
              size="compact"
            />
          </nav>
        </div>
      </header>
      {children}
      <footer className="plain-footer">
        <p>codingchart.com</p>
        <div className="plain-footer__links">
          <Link href="/blog">Blog</Link>
          <Link href="/">Chart</Link>
          <HranessBrand />
        </div>
      </footer>
    </div>
  );
}
