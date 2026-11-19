import { AiChartsMark } from "./brand-icon";

export function SiteHeader() {
  return (
    <header className="topbar">
      <a className="topbar__brand" href="/">
        <AiChartsMark size={25} />
        <span className="topbar__title">aicharts</span>
      </a>
      <nav aria-label="Product pages" className="journal-nav">
        <a href="/">Explorer</a>
        <a href="/models">Models</a>
        <a href="/compare">Compare</a>
        <a href="/blog">Blog</a>
        <a href="/changelog">Changelog</a>
      </nav>
    </header>
  );
}
