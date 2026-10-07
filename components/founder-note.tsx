/** The founder's own description of the product, set as a note below the hero. */
export function FounderNote({ emoji, paragraphs, action, signature }: {
  emoji: string;
  paragraphs: readonly string[];
  action: { label: string; href: string };
  signature?: string;
}) {
  return (
    <section aria-label="A note from the author" className="founder-note">
      <span aria-hidden="true" className="founder-note__emoji">{emoji}</span>
      <div className="founder-note__body">
        {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <p className="founder-note__action">
          {action.label} <a href={action.href}>{action.href.replace(/^https:\/\//, "")}</a>
        </p>
        {signature ? <p className="founder-note__signature">{signature}</p> : null}
      </div>
    </section>
  );
}
