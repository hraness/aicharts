const LINKS = [
  ["/models", "Models"],
  ["/compare", "Compare"],
  ["/agents", "Coding agents"],
  ["/blog", "Blog"],
  ["/changelog", "Changelog"],
  ["/api/releases", "API"],
  ["https://github.com/hraness/aicharts", "GitHub"],
] as const;

/** The shared Hraness product footer (hraness/brand web/FOOTER.md). */
export function SiteFooter() {
  return (
    <footer aria-label="Site" className="aicharts-footer">
      <div className="aicharts-footer__inner">
        <nav aria-label="aicharts" className="aicharts-footer__links">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <div className="aicharts-footer__end">
          <a href="/blog#privacy">Your Privacy Choices</a>
          <a className="aicharts-footer__wordmark" href="https://hraness.com">
            Hraness
          </a>
        </div>
      </div>
    </footer>
  );
}
