import { FrontierStarIcon } from "./brand-icon";
import { effortName } from "@/lib/catalog";
import type { ContextMode, EffortPoint } from "@/lib/types";

export function frontierStarsText(
  efforts: readonly EffortPoint[],
  context: ContextMode = "live",
): string {
  const count = efforts.length;
  const frontier = context === "release" ? "release-day" : "live";
  return `On the ${frontier} frontier at ${count} effort setting${count === 1 ? "" : "s"}: ${efforts
    .map((e) => effortName(e.effortSlug))
    .join(", ")}`;
}

/**
 * One star per effort setting on the cost frontier: today's (live), or the one
 * on the model's release day.
 */
export function FrontierStars({
  efforts,
  size = 8,
  labelled = false,
  context = "live",
}: Readonly<{
  efforts: readonly EffortPoint[];
  size?: number;
  labelled?: boolean;
  context?: ContextMode;
}>) {
  if (efforts.length === 0) return null;
  const text = frontierStarsText(efforts, context);
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
