import type {
  ArtificialAnalysisIntelligenceSnapshot,
} from "@/lib/artificial-analysis-intelligence-data";
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

function methodologySummary(snapshot: ArtificialAnalysisIntelligenceSnapshot): string {
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
}: Readonly<{ snapshot: ArtificialAnalysisIntelligenceSnapshot }>) {
  const cohort = comparableIntelligenceRecords(snapshot.records);
  const comparison = focusModelComparison(cohort);
  const outputFrontier = paretoMembership(cohort, "outputTokensPerTask");
  const costFrontier = paretoMembership(cohort, "costUsdPerTask");
  const chartData: readonly IntelligenceEfficiencyExplorerDatum[] = cohort.map(record => ({
    costUsdPerTask: record.costUsdPerTask?.total ?? 0,
    creatorId: record.creator.id,
    creatorName: record.creator.name,
    detailsUrl: record.detailsUrl,
    id: record.id,
    intelligenceIndex: record.intelligenceIndex,
    isCostFrontier: costFrontier.has(record.id),
    isOutputFrontier: outputFrontier.has(record.id),
    name: record.name,
    outputTokensPerTask: record.outputTokensPerTask.total,
    releaseDate: record.releaseDate,
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
        <p className="intelligence-efficiency__eyebrow">General capability · model-level</p>
        <h2 id="home-intelligence-efficiency-title">
          Artificial Analysis Intelligence Index v{snapshot.benchmark.version}
        </h2>
        <p className="intelligence-efficiency__dek">
          Compare broad model capability with the output tokens and dollars used to produce it.
          Every point is a published model configuration from one checked snapshot.
        </p>
      </header>

      {comparison === null ? null : (
        <p className="intelligence-efficiency__finding">
          <strong>
            {comparison.roundedIntelligenceScore === null
              ? `GPT-6 Astra scores ${indexFormatter.format(comparison.astra.intelligenceIndex)} and GPT-5.6 Sol scores ${indexFormatter.format(comparison.sol.intelligenceIndex)}`
              : `GPT-6 Astra and GPT-5.6 Sol both round to ${String(comparison.roundedIntelligenceScore)}`}
          </strong>
          {" at max effort. Astra generates "}
          {relativePhrase(comparison.outputTokenReductionPercent, "fewer", "more")}
          {" output tokens, but costs "}
          {relativePhrase(comparison.costIncreasePercent, "more", "less")}
          {" per task."}
        </p>
      )}

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

      <div className="intelligence-efficiency__data-links">
        <a
          data-analytics-destination-id="section"
          data-analytics-destination-kind="section"
          href="/data#artificial-analysis-intelligence"
        >
          Full data and methodology
        </a>
        <a
          data-analytics-destination-id="dataset:artificial-analysis-intelligence"
          data-analytics-destination-kind="dataset"
          download="aicharts-artificial-analysis-intelligence.json"
          href="/data/artificial-analysis-intelligence.json"
        >
          Download JSON
        </a>
      </div>

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
            and {cohort.length} also report a positive task cost. AI Charts derives each frontier from
            configurations for which no other point is both at least as capable and less resource-intensive.
            No benchmark families are blended.
          </p>
          <p>
            <strong>Index construction.</strong>{" "}
            The publisher’s {snapshot.benchmark.evaluationCount}-evaluation index weights{" "}
            {methodologySummary(snapshot)}. These model-level output observations remain separate from
            the coding-agent configurations and total-token measurement below.
          </p>
          <p>
            <strong>Source.</strong>{" "}
            <a
              data-analytics-destination-id="source:artificial-analysis"
              data-analytics-destination-kind="source"
              href={snapshot.source.url}
            >
              {snapshot.source.name} public models leaderboard
            </a>
            {" · retrieved "}
            <time dateTime={snapshot.source.retrievedAt}>{retrievalLabel}</time>
            {" · "}
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
            . The checked artifact records a first-party public Next.js page payload.
          </p>
        </div>
      </details>
    </section>
  );
}
