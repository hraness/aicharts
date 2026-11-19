import { FrontierStarIcon } from "../brand-icon";
import { effortName, effortsByLevel } from "@/lib/catalog";
import { formatScore, formatTokens, formatUsd } from "@/lib/format";
import type { EffortPoint, ModelRelease } from "@/lib/types";

/** Every benchmark at every effort setting of one release, in static HTML. */
export function EffortTable({
  release,
  frontier,
  captionId,
  caption,
}: Readonly<{
  release: ModelRelease;
  frontier: readonly EffortPoint[];
  captionId: string;
  caption: React.ReactNode;
}>) {
  const starred = new Set(frontier.map((e) => e.effortSlug));
  return (
    <div className="table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="data-table">
        <caption id={captionId}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Effort</th>
            <th scope="col">Coding</th>
            <th scope="col">Terminal-Bench 4.0</th>
            <th scope="col">FrontierCode 2.0</th>
            <th scope="col">Intelligence</th>
            <th scope="col">Cost per task</th>
            <th scope="col">Output tokens</th>
          </tr>
        </thead>
        <tbody>
          {effortsByLevel(release).map((e) => (
            <tr key={e.effortSlug}>
              <th scope="row">
                <span className="effort-cell">
                  {effortName(e.effortSlug)}
                  {starred.has(e.effortSlug) && (
                    <span className="effort-cell__star" title="Frontier star: on the live cost frontier for coding">
                      <FrontierStarIcon size={9} />
                      <span className="sr-only">frontier star</span>
                    </span>
                  )}
                  {e.isDefaultEffort && <span className="tag">default</span>}
                </span>
              </th>
              <td>{formatScore(e.scores.coding, "%")}</td>
              <td>{formatScore(e.scores.terminalBench4, "%")}</td>
              <td>{formatScore(e.scores.frontierCode2, "%")}</td>
              <td>{formatScore(e.scores.intelligence, "pts")}</td>
              <td>{formatUsd(e.costUsdPerTask.total)}</td>
              <td>{formatTokens(e.tokensPerTask.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
