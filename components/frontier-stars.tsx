import { FrontierStarIcon } from "./brand-icon";
import type { ContextMode } from "@/lib/types";

export function frontierStarText(context: ContextMode = "live"): string {
  return context === "release"
    ? "On the cost frontier on its release day"
    : "On today's cost frontier";
}

/**
 * The frontier star: the model's Terminal-Bench run sits on the cost frontier,
 * today's (live) or the one on its release day, and clears 75% of the top
 * score there.
 */
export function FrontierStar({
  size = 8,
  labelled = false,
  context = "live",
}: Readonly<{
  size?: number;
  labelled?: boolean;
  context?: ContextMode;
}>) {
  const text = frontierStarText(context);
  return (
    <span className={`frontier-stars${labelled ? " frontier-stars--labelled" : ""}`} title={text}>
      <span className="frontier-stars__icons" aria-hidden="true">
        <FrontierStarIcon size={size} />
      </span>
      {labelled && <span aria-hidden="true">Frontier</span>}
      <span className="sr-only">{text}</span>
    </span>
  );
}
