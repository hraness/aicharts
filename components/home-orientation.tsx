import { MarketingSection } from "@hraness/design-kit/react/server";

const ORIENTATION_FACTS = [
  {
    label: "Coding standard",
    value: "Terminal-Bench 4.0. Major exam versions remain separate.",
  },
  {
    label: "Comparison rule",
    value: "Published release, model, agent, effort, trials, uncertainty, and source stay attached. Unreported protocol fields remain missing.",
  },
  {
    label: "Evidence class",
    value: "Benchmark-owner and vendor-reported results stay distinct. Missing values remain missing.",
  },
] as const;

/**
 * The homepage orientation: how the portfolio is selected and bounded, set on
 * the shared marketing section grammar between the Intelligence Index frame
 * and the coding-agent chart.
 */
export function HomeOrientation() {
  return (
    <MarketingSection
      className="chart-orientation"
      heading="Each chart keeps its own units, cohort, and source."
      headingId="chart-orientation-title"
      id="how-to-read"
      label="How to read the charts"
      layout="split"
      summary="A five-role benchmark portfolio covers terminal engineering, scientific workflows, professional work, computer use, and broad expert reasoning. Checked score views are added without mixing versions or systems. The model-level Intelligence efficiency view above and the coding-agent chart below keep their own units, cohorts, and provenance."
    >
      <dl aria-label="Benchmark selection and boundaries" className="chart-orientation__facts">
        {ORIENTATION_FACTS.map(fact => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </MarketingSection>
  );
}
