import type { ModelCommentaryNote } from "@/lib/model-commentary";

const postedFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatPostedAt(postedAt: string): string {
  const date = new Date(postedAt);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Commentary timestamp must be valid.");
  }
  return postedFormatter.format(date);
}

export function ModelCommentary({
  note,
}: Readonly<{
  note: ModelCommentaryNote;
}>) {
  return (
    <section
      aria-labelledby="model-commentary-title"
      className="model-commentary"
      data-analytics-surface="model_card"
    >
      <h2 id="model-commentary-title">Notes from X</h2>
      <p className="model-commentary__lede">
        Curated public posts about this model. These are quotations, not AI Charts measurements.
      </p>
      <ul className="model-commentary__list">
        {note.tweets.map(tweet => (
          <li key={tweet.statusId}>
            <blockquote cite={tweet.url} lang={tweet.lang}>
              {tweet.text.split("\n").filter(line => line.trim() !== "").map((line, index) => (
                <p key={`${tweet.statusId}-${String(index)}`}>{line}</p>
              ))}
              <footer>
                <cite>
                  <a href={tweet.url} rel="noopener noreferrer">
                    {tweet.authorName}
                    {" "}
                    (@{tweet.authorHandle})
                  </a>
                </cite>
                {" · "}
                <time dateTime={tweet.postedAt}>{formatPostedAt(tweet.postedAt)}</time>
              </footer>
            </blockquote>
          </li>
        ))}
      </ul>
    </section>
  );
}
