import { ProviderLogo } from "../brand-icon";
import type { ReleasePair } from "@/lib/catalog";
import type { ModelRelease } from "@/lib/types";

/** Links to comparison pages, marked with the other model's lab. */
export function PairList({
  title,
  pairs,
  from,
}: Readonly<{ title: string; pairs: readonly ReleasePair[]; from?: ModelRelease }>) {
  return (
    <div className="pair-group">
      <h3>{title}</h3>
      <ul className="pair-links">
        {pairs.map((pair) => {
          // Beside one model's page, mark the rival's lab; in a plain list, both.
          const marks = from
            ? [pair.first.slug === from.slug ? pair.second : pair.first]
            : pair.first.provider === pair.second.provider
              ? [pair.first]
              : [pair.first, pair.second];
          return (
            <li key={pair.slug}>
              <a href={`/compare/${pair.slug}`}>
                <span className="pair-links__marks">
                  {marks.map((r) => (
                    <ProviderLogo key={r.slug} provider={r.provider} size={14} />
                  ))}
                </span>
                <span>
                  {pair.first.name} vs {pair.second.name}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
