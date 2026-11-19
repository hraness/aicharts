import { FrontierStarIcon } from "./brand-icon";
import { effortName } from "@/lib/catalog";
import type { EffortPoint } from "@/lib/types";

export function frontierStarsText(efforts: readonly EffortPoint[]): string {
  const count = efforts.length;
  return `On the live frontier at ${count} effort setting${count === 1 ? "" : "s"}: ${efforts
    .map((e) => effortName(e.effortSlug))
    .join(", ")}`;
}

/** One star per effort setting on the live cost frontier. */
export function FrontierStars({
  efforts,
  size = 8,
  labelled = false,
}: Readonly<{ efforts: readonly EffortPoint[]; size?: number; labelled?: boolean }>) {
  if (efforts.length === 0) return null;
  const text = frontierStarsText(efforts);
  return (
    <span className={`frontier-stars${labelled ? " frontier-stars--labelled" : ""}`} title={text}>
      <span className="frontier-stars__icons" aria-hidden="true">
        {efforts.map((e) => (
          <FrontierStarIcon key={e.effortSlug} size={size} />
        ))}
      </span>
      {labelled && <span aria-hidden="true">Frontier</span>}
      <span className="sr-only">{text}</span>
    </span>
  );
}
