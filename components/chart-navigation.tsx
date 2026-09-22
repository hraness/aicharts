import Link from "next/link";
import type { ReactNode } from "react";

import { homeTaskLinks } from "@/app/site";

import "@/styles/chart-footer.css";

export function ChartNavigation({ current }: Readonly<{ current: "/" | "/coding" }>) {
  return <nav className="chart-navigation" aria-label="Chart collection" data-analytics-surface="benchmark_chart">
    <Link href="/" aria-current={current === "/" ? "page" : undefined}>Model efficiency</Link>
    <Link href="/coding" aria-current={current === "/coding" ? "page" : undefined}>Coding agents</Link>
  </nav>;
}

/** Shared compact footer-nav row used on chart pages and the homepage. */
export function ChartFooterNav({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  return <nav className="chart-page-footer" aria-label={label}>{children}</nav>;
}

export function ChartPageFooter() {
  return <ChartFooterNav label="Chart resources">
    <Link href="/data">Data and methodology</Link>
    <Link href="/models">Model cards</Link>
    <Link href="/blog">Benchmark notes</Link>
    <a href="https://github.com/hraness/aicharts">Open source <span aria-hidden="true">↗</span></a>
  </ChartFooterNav>;
}

/** Homepage task destinations in the same footer-nav density as other chart pages. */
export function HomeExploreFooter() {
  return <div className="chart-page-footer-stack">
    <ChartFooterNav label="What do you want to do?">
      {homeTaskLinks.map(({ task, name }) => (
        <Link href={`/benchmarks?task=${task}#explore`} key={task}>{name}</Link>
      ))}
      <Link href="/benchmarks">All benchmarks <span aria-hidden="true">↗</span></Link>
    </ChartFooterNav>
    <ChartPageFooter />
  </div>;
}
