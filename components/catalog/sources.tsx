export type Source = Readonly<{ name: string; url: string }>;

/** "Sources and scope": a scope paragraph, then numbered sources that facts cite as [n]. */
export function Sources({
  scope,
  sources,
}: Readonly<{ scope: React.ReactNode; sources: readonly Source[] }>) {
  return (
    <section className="sources" aria-labelledby="sources-title">
      <h2 id="sources-title">Sources and scope</h2>
      <p>{scope}</p>
      <ol>
        {sources.map((source, i) => (
          <li key={source.url + i} id={`source-${i + 1}`}>
            <a href={source.url} rel="noopener">
              {source.name}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Cite({ n }: Readonly<{ n: number }>) {
  return (
    <sup className="cite">
      <a href={`#source-${n}`} aria-label={`Source ${n}`}>
        [{n}]
      </a>
    </sup>
  );
}
