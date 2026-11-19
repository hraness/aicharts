import { AiChartsMark } from "@/components/brand-icon";
import "./journal.css";

export default function JournalLayout({ children }: { children: React.ReactNode }) {
  return <div className="journal-shell">
    <header className="topbar"><a className="topbar__brand" href="/"><AiChartsMark size={25}/><span className="topbar__title">aicharts</span></a>
      <nav aria-label="Product pages" className="journal-nav"><a href="/">Explorer</a><a href="/blog">Blog</a><a href="/changelog">Changelog</a></nav>
    </header>
    <main className="journal-main">{children}</main>
  </div>;
}
