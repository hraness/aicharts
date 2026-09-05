import Link from "next/link";

import { site } from "@/app/site";
import { SkipLink, ThemeMenuButton } from "@/components/ui";

export const SITE_HEADER_LINKS = [
  { href: "/blog", label: "Blog" },
  { href: "/models", label: "Cards" },
  { href: "/data", label: "Data" },
] as const;

export type SiteHeaderPath = "/" | (typeof SITE_HEADER_LINKS)[number]["href"];

/**
 * The shared Hraness site header on the design-kit marketing grammar: sticky
 * translucent paper, one hairline, the wordmark, the site links, and the
 * appearance control last. Rendered on the documented classes so links stay
 * on `next/link` and the header keeps its analytics surface.
 */
export function SiteHeader({
  className,
  current,
  skipLabel = "Skip to content",
  skipTarget = "#main-content",
}: Readonly<{
  className?: string;
  current: SiteHeaderPath;
  skipLabel?: string;
  skipTarget?: string;
}>) {
  const headerClassName = ["hraness-marketing-header", "site-header", className]
    .filter((value): value is string => value !== undefined)
    .join(" ");
  return (
    <>
      <SkipLink href={skipTarget}>{skipLabel}</SkipLink>
      <header
        className={headerClassName}
        data-analytics-surface="global_header"
        data-hraness-marketing="header"
      >
        <div className="hraness-marketing-header__inner">
          <Link className="hraness-marketing-header__brand" href="/">{site.domain}</Link>
          <nav aria-label="Site" className="hraness-marketing-header__nav">
            {SITE_HEADER_LINKS.map(link => (
              <Link
                aria-current={current === link.href ? "page" : undefined}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="hraness-marketing-header__actions">
            <ThemeMenuButton aria-label="Appearance" />
          </div>
        </div>
      </header>
    </>
  );
}
