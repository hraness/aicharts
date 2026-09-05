"use client";

import {
  BarListChart,
  RangePlotChart,
  type BarListChartDatum,
  type RangePlotChartDatum,
} from "@/components/ui";
import { useMemo } from "react";

import { providerColor, recordColor } from "@/lib/chart-colors";
import type { CodingAgentRecord } from "@/lib/coding-agent-data";
import {
  formatMetricValue,
  xMetricLabels,
  yMetricLabels,
  type XMetric,
  type YMetric,
} from "@/lib/chart-math";
import {
  computeParetoFrontier,
  providerPerformanceRanges,
  sampleFrontierLadder,
} from "@/lib/option-space";

export function OptionSpaceOverview({
  onPinPoint,
  onPinProvider,
  pinnedPointId,
  pinnedProviderId,
  records,
  xMetric,
  yMetric,
}: Readonly<{
  onPinPoint: (recordId: string) => void;
  onPinProvider: (providerId: string) => void;
  pinnedPointId: string | null;
  pinnedProviderId: string | null;
  records: readonly CodingAgentRecord[];
  xMetric: XMetric;
  yMetric: YMetric;
}>) {
  const frontier = useMemo(
    () => computeParetoFrontier(records, xMetric, yMetric),
    [records, xMetric, yMetric],
  );
  const frontierRows = useMemo<readonly BarListChartDatum[]>(() => (
    sampleFrontierLadder(frontier, 8)
      .toReversed()
      .map(({ record, xValue, yValue }) => ({
        color: recordColor(record),
        detail: `${record.providerName} · ${formatMetricValue(xMetric, xValue)}`,
        id: record.id,
        label: record.modelLabel,
        value: yValue,
      }))
  ), [frontier, xMetric]);
  const providerRanges = useMemo<readonly RangePlotChartDatum[]>(() => (
    providerPerformanceRanges(records, yMetric).map((range) => ({
      color: providerColor(range.providerId),
      detail: `${String(range.count)} ${range.count === 1 ? "option" : "options"} · median ${formatMetricValue(yMetric, range.median)}`,
      id: range.providerId,
      label: range.providerName,
      maximum: range.maximum,
      median: range.median,
      minimum: range.minimum,
    }))
  ), [records, yMetric]);
  const frontierLeader = frontierRows[0];
  const providerLeader = providerRanges[0];

  return (
    <section
      aria-labelledby="option-space-title"
      className="option-space-overview chart-selection-boundary"
    >
      <header className="option-space-overview__header">
        <div>
          <p>Option-space summary</p>
          <h2 id="option-space-title">Efficient choices beyond the scatter plot</h2>
        </div>
        {frontierLeader === undefined || providerLeader === undefined ? (
          <p className="option-space-overview__current">
            No complete option-space rows are available for the selected axes.
          </p>
        ) : (
          <p className="option-space-overview__current">
            <strong>Current read.</strong>{" "}
            {frontierLeader.label} reaches the highest sampled frontier score at{" "}
            <data value={frontierLeader.value}>
              {formatMetricValue(yMetric, frontierLeader.value)}
            </data>
            ; {providerRanges.length} provider ranges are available, led by {providerLeader.label}
            {" "}at{" "}
            <data value={providerLeader.maximum}>
              {formatMetricValue(yMetric, providerLeader.maximum)}
            </data>
            .
          </p>
        )}
      </header>

      <details className="option-space-overview__details">
        <summary>
          Explore {frontierRows.length} frontier steps and {providerRanges.length} provider ranges
        </summary>
        <div className="option-space-grid">
          <article className="option-space-panel">
            <header>
              <h3>Efficient frontier</h3>
              <p>
                Models on the Pareto frontier by {xMetricLabels[xMetric]} and{" "}
                {yMetricLabels[yMetric]}.
              </p>
            </header>
            <BarListChart
              aria-label={`${yMetricLabels[yMetric]} efficient frontier`}
              data={frontierRows}
              domain={[0, 100]}
              formatValue={(value) => formatMetricValue(yMetric, value)}
              onSelectionChange={onPinPoint}
              selectedId={pinnedPointId}
            />
          </article>

          <article className="option-space-panel">
            <header>
              <h3>Provider ranges</h3>
              <p>
                Minimum, median, and maximum {yMetricLabels[yMetric]} by provider.
              </p>
            </header>
            <RangePlotChart
              aria-label={`${yMetricLabels[yMetric]} ranges by provider`}
              data={providerRanges}
              domain={[0, 100]}
              formatValue={(value) => formatMetricValue(yMetric, value)}
              onSelectionChange={onPinProvider}
              selectedId={pinnedProviderId}
            />
          </article>
        </div>
      </details>
    </section>
  );
}
