import type { CSSProperties } from "react";
import { providerColorRange } from "@/lib/chart-colors";
import type { BenchmarkMetric, CodingAgentUpdate } from "@/lib/coding-agent-data";
import { formatUpdateDate, groupUpdatesByDetection } from "@/lib/coding-agent-updates";
import { formatMetricValue, yMetricLabels } from "@/lib/chart-math";

const benchmarkMetrics = ["aaIndex", "deepSwe", "terminalBench", "sweAtlas"] as const satisfies readonly BenchmarkMetric[];

function updateStyle(providerId: string): CSSProperties & { "--update-color": string } {
  return { "--update-color": providerColorRange(providerId).base };
}

function formatScore(value: number | null): string {
  return value === null ? "—" : formatMetricValue("aaIndex", value);
}

function UpdateMetrics({ update }: { update: CodingAgentUpdate }) {
  if (update.kind === "benchmark-changed") {
    return (
      <dl className="model-update-deltas">
        {update.changes.map((change) => (
          <div key={change.metric}>
            <dt>{yMetricLabels[change.metric]}</dt>
            <dd>
              <span>{formatScore(change.previous)}</span>
              <span aria-hidden="true">→</span>
              <strong>{formatScore(change.current)}</strong>
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="model-update-benchmarks">
      {benchmarkMetrics.map((metric) => (
        <div key={metric}>
          <dt>{yMetricLabels[metric]}</dt>
          <dd>{formatScore(update.benchmarks[metric])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ModelUpdateTimeline({
  retrievedAt,
  updates,
}: {
  retrievedAt: string;
  updates: readonly CodingAgentUpdate[];
}) {
  if (updates.length === 0) return null;
  const groups = groupUpdatesByDetection(updates);
  return (
    <section aria-labelledby="model-updates-heading" className="model-update-timeline" id="model-updates">
      <header className="model-update-timeline__header">
        <h2 id="model-updates-heading">Model updates</h2>
        <p>
          Daily snapshot diff · checked <time dateTime={retrievedAt}>{formatUpdateDate(retrievedAt)}</time>
        </p>
      </header>
      <ol className="model-update-groups">
        {groups.map((group) => (
          <li className="model-update-group" key={group.detectedAt}>
            <time dateTime={group.detectedAt}>{formatUpdateDate(group.detectedAt)}</time>
            <ol className="model-update-cards">
              {group.events.map((update) => (
                <li className="model-update-card" key={update.id} style={updateStyle(update.providerId)}>
                  <div className="model-update-card__heading">
                    <span>
                      {update.kind === "model-added"
                        ? "New model"
                        : update.kind === "variant-added" ? "New setting" : "Benchmark change"}
                    </span>
                    <h3>{update.model}</h3>
                  </div>
                  <p>
                    {update.agent} · {update.providerName} · {update.setting}
                    {update.kind !== "benchmark-changed" && update.variantCount > 1 ? ` · ${update.variantCount} settings` : ""}
                  </p>
                  <UpdateMetrics update={update} />
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}
