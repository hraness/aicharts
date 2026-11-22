import { PrivacyChoices } from "@/components/article-action";
import { dateLabel, entries, guide, pageMetadata } from "@/journal/content";
export const metadata = pageMetadata(
  "aicharts blog",
  "Guides to comparing AI coding models and the latest changes to aicharts.",
  "/blog",
);
export default function Blog() {
  return (
    <>
      <h1>Blog</h1>
      {guide.evergreen && (
        <article className="guide-teaser" data-pj-evergreen>
          <span className="entry-meta">Product guide</span>
          <h2>
            <a href={guide.href}>{guide.title}</a>
          </h2>
          <p>{guide.summary}</p>
        </article>
      )}
      <section aria-label="Recent changes">
        <div className="section-head">
          <h2>Recent changes</h2>
          <a href="/changelog">Full changelog</a>
        </div>
        <ul className="recent">
          {entries.slice(0, 5).map((entry) => (
            <li key={entry.slug}>
              <a href={`/changelog#${entry.slug}`}>{entry.title}</a>
              <time dateTime={entry.date}>{dateLabel(entry.date)}</time>
            </li>
          ))}
        </ul>
      </section>
      <footer id="privacy" className="journal-privacy">
        <p>
          aicharts counts visits and use of the product guide’s closing link
          with PostHog. Your privacy choices control how visits are remembered.
          Session recording is off.
        </p>
        <PrivacyChoices />
      </footer>
    </>
  );
}
