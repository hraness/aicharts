import type {
  ArtificialAnalysisIntelligenceSnapshot,
} from "@/lib/artificial-analysis-intelligence-data";
import type { ArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  comparableIntelligenceRecords,
  focusModelComparison,
  intelligenceScoreDomain,
  paretoMembership,
} from "@/lib/intelligence-efficiency";
import {
  IntelligenceEfficiencyExplorer,
  type IntelligenceEfficiencyExplorerDatum,
} from "@/components/intelligence-efficiency-explorer";

import "@/styles/intelligence-efficiency.css";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const indexFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

function relativePhrase(
  value: number,
  positive: string,
  negative: string,
): string {
  return `${percentFormatter.format(Math.abs(value))}% ${value >= 0 ? positive : negative}`;
}

type IntelligenceSnapshot = ArtificialAnalysisIntelligenceSnapshot | ArtificialAnalysisIntelligenceV43Snapshot;

function methodologySummary(snapshot: IntelligenceSnapshot): string {
  const weights = snapshot.benchmark.categoryWeightsPercent;
  return [
    `agents ${weights.agents}%`,
    `coding ${weights.coding}%`,
    `scientific ${weights.scientific}%`,
    `general ${weights.general}%`,
  ].join(" · ");
}

export function HomeIntelligenceEfficiency({
  snapshot,
}: Readonly<{ snapshot: IntelligenceSnapshot }>) {
  const currentVersion = snapshot.benchmark.version === "4.3";
  const datasetId = currentVersion ? "artificial-analysis-intelligence-v4-3" : "artificial-analysis-intelligence";
  const cohort = comparableIntelligenceRecords(snapshot.records);
  const comparison = focusModelComparison(cohort);
  const outputFrontier = paretoMembership(cohort, "outputTokensPerTask");
  const costFrontier = paretoMembership(cohort, "costUsdPerTask");
  const chartData: readonly IntelligenceEfficiencyExplorerDatum[] = cohort.map(record => ({
    costUsdPerTask: record.costUsdPerTask?.total ?? 0,
    creatorId: record.creator.id,
    creatorName: record.creator.name,
    creatorSlug: record.creator.slug,
    detailsUrl: record.detailsUrl,
    id: record.id,
    intelligenceIndex: record.intelligenceIndex,
    isCostFrontier: costFrontier.has(record.id),
    isOutputFrontier: outputFrontier.has(record.id),
    name: record.name,
    outputTokensPerTask: record.outputTokensPerTask.total,
    releaseDate: record.releaseDate,
    slug: record.slug,
  }));
  const retrievedAt = new Date(snapshot.source.retrievedAt);
  const retrievalLabel = Number.isNaN(retrievedAt.valueOf())
    ? snapshot.source.retrievedAt
    : dateFormatter.format(retrievedAt);

  return (
    <section
      aria-labelledby="home-intelligence-efficiency-title"
      className="intelligence-efficiency"
      data-analytics-surface="benchmark_chart"
      id="intelligence-index"
    >
      <header className="intelligence-efficiency__header">
        <h2 id="home-intelligence-efficiency-title">Capability and cost</h2>
        <p className="intelligence-efficiency__source-note">
          <a
            data-analytics-destination-id="source:artificial-analysis"
            data-analytics-destination-kind="source"
            href={snapshot.source.url}
          >
            Artificial Analysis Intelligence Index v{snapshot.benchmark.version}
          </a>
          <span>Snapshot <time dateTime={snapshot.source.retrievedAt}>{retrievalLabel}</time></span>
        </p>
      </header>

      {cohort.length === 0 ? (
        <p className="intelligence-efficiency__empty">
          No configurations meet the complete model-level comparison rule in this snapshot.
        </p>
      ) : (
        <IntelligenceEfficiencyExplorer
          astraId={comparison?.astra.id ?? null}
          data={chartData}
          solId={comparison?.sol.id ?? null}
          yDomain={intelligenceScoreDomain(cohort)}
        />
      )}

      <div className="intelligence-efficiency__notes">
        <details className="intelligence-efficiency__method">
          <summary>Method &amp; data</summary>
          <div className="intelligence-efficiency__method-body">
            <p>
              <strong>What the axes mean.</strong>{" "}
              Output tokens are answer plus reasoning generated per Intelligence Index task;
              they exclude input and cache traffic. Cost is the publisher’s estimated total task cost.
              The horizontal axes are logarithmic, so equal spacing represents equal proportional change.
            </p>
            <p>
              <strong>Cohort and frontier.</strong>{" "}
              The source has {snapshot.selection.sourceRecordCount} records;{" "}
              {snapshot.selection.measuredCompleteRecordCount} meet the non-estimated complete-measure rule,
              and {cohort.length} also report a positive task cost. The curve connects configurations
              offering the highest score at each resource budget; AI Charts derives it from this cohort.
              No benchmark families are blended.
            </p>
            <p>
              <strong>Index construction.</strong>{" "}
              The publisher’s {snapshot.benchmark.evaluationCount}-evaluation index weights{" "}
              {methodologySummary(snapshot)}. These model-level output observations remain separate from
              coding-agent configurations and total-token measurements.
            </p>
            <p>
              <strong>Source.</strong>{" "}
              <a
                data-analytics-destination-id="source:artificial-analysis-methodology"
                data-analytics-destination-kind="source"
                href={snapshot.source.methodologyUrl}
              >
                Publisher methodology
              </a>
              {" · "}
              <a
                data-analytics-destination-id="source:artificial-analysis-terms"
                data-analytics-destination-kind="source"
                href={snapshot.source.termsUrl}
              >
                Source terms
              </a>
              . Measurements come from the publisher’s public models leaderboard; the snapshot date is a retrieval date, not a model’s evaluation date.
            </p>
            <div className="intelligence-efficiency__data-links">
              <a
                data-analytics-destination-id="section"
                data-analytics-destination-kind="section"
                href={currentVersion ? "/data#atlas-aa-intelligence-4-3" : "/data#artificial-analysis-intelligence"}
              >
                Full data and methodology
              </a>
              <a
                data-analytics-destination-id={`dataset:${datasetId}`}
                data-analytics-destination-kind="dataset"
                download={`aicharts-${datasetId}.json`}
                href={`/data/${datasetId}.json`}
              >
                Download JSON
              </a>
            </div>
          </div>
        </details>
        {comparison === null ? null : (
          <details className="intelligence-efficiency__comparison">
            <summary>Compare GPT-6 Astra and GPT-5.6 Sol</summary>
            <p className="intelligence-efficiency__finding">
              <strong>
                {comparison.roundedIntelligenceScore === null
                  ? `GPT-6 Astra scores ${indexFormatter.format(comparison.astra.intelligenceIndex)} and GPT-5.6 Sol scores ${indexFormatter.format(comparison.sol.intelligenceIndex)}`
                  : `GPT-6 Astra and GPT-5.6 Sol both round to ${String(comparison.roundedIntelligenceScore)}`}
              </strong>
              {" at max effort. Astra generates "}
              {relativePhrase(comparison.outputTokenReductionPercent, "fewer", "more")}
              {" output tokens and costs "}
              {relativePhrase(comparison.costIncreasePercent, "more", "less")}
              {" per task. "}
              <a data-analytics-destination-id="source:artificial-analysis" data-analytics-destination-kind="source" href={comparison.astra.detailsUrl}>Astra source</a>
              {" · "}
              <a data-analytics-destination-id="source:artificial-analysis" data-analytics-destination-kind="source" href={comparison.sol.detailsUrl}>Sol source</a>.
            </p>
          </details>
        )}
      </div>
    </section>
  );
}
