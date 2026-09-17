import Link from "next/link";
import "@/styles/chart-footer.css";

export function ChartNavigation({ current }: Readonly<{ current: "/" | "/coding" }>) {
  return <nav className="chart-navigation" aria-label="Chart collection" data-analytics-surface="benchmark_chart">
    <Link href="/" aria-current={current === "/" ? "page" : undefined}>Model efficiency</Link>
    <Link href="/coding" aria-current={current === "/coding" ? "page" : undefined}>Coding agents</Link>
  </nav>;
}

export function ChartPageFooter() {
  return <nav className="chart-page-footer" aria-label="Chart resources">
    <Link href="/data">Data and methodology</Link>
    <Link href="/models">Model cards</Link>
    <Link href="/blog">Benchmark notes</Link>
    <a href="https://github.com/hraness/aicharts">Open source <span aria-hidden="true">↗</span></a>
  </nav>;
}
