import { LocalEvaluationPicker } from "./local-evaluation-picker";
import { metrics, qualityPath, workloads, type QualityMetric, type QualityWorkload } from "@/lib/local-quality";
import { LocalQualityTable } from "./local-quality-table";

export function LocalQuality({ workload, metric }: { workload: QualityWorkload; metric: QualityMetric }) {
  const { models, maximum, unit, lowerIsBetter, overviewPublishers } = metric;
  return <section className="local-quality" id="quality" aria-labelledby="quality-title">
    <h2 id="quality-title">Model quality by workload</h2>
    <LocalEvaluationPicker value={qualityPath(workload,metric)} options={workloads.flatMap(w => metrics(w).map(m => ({
      value: qualityPath(w,m), label: m.metric, group: w.name, description: m.description,
    })))} />
    <noscript><details><summary>Browse evaluations</summary>{workloads.map(w => <div key={w.name}><strong>{w.name}</strong>{metrics(w).map(m => <p key={m.metric}><a href={qualityPath(w,m)}>{m.metric}</a></p>)}</div>)}</details></noscript>
    <h4>{metric.metric}</h4><p>{metric.description} <a href={metric.source}>{metric.publisher}</a></p>
    {workload.interpretation && <details className="local-reading"><summary>How to interpret {workload.name.toLowerCase()} scores</summary><p>{workload.interpretation}</p></details>}
    <LocalQualityTable key={qualityPath(workload, metric)} metric={{ metric: metric.metric, models, maximum, unit, lowerIsBetter, overviewPublishers }} />
  </section>;
}
