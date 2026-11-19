import { JsonLd } from "./json-ld";

export type Question = Readonly<{ q: string; a: string }>;

/** Questions per hraness/brand web/FAQ.md: native disclosures plus FAQPage data. */
export function Questions({ items }: Readonly<{ items: readonly Question[] }>) {
  if (items.length === 0) return null;
  return (
    <section className="faq" aria-labelledby="questions-title">
      <h2 id="questions-title">Questions.</h2>
      <div className="faq-list">
        {items.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <div className="faq-answer">
              <p>{item.a}</p>
            </div>
          </details>
        ))}
      </div>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }}
      />
    </section>
  );
}
