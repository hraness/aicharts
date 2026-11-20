import Link from "next/link";
import { metrics, qualityPath, workloads, type QualityMetric, type QualityWorkload } from "@/lib/local-quality";
import { LocalQualityTable } from "./local-quality-table";

export function LocalQuality({ workload, metric }: { workload: QualityWorkload; metric: QualityMetric }) {
  const { models, maximum, unit, lowerIsBetter } = metric;
  return <section className="local-quality" id="quality" aria-labelledby="quality-title">
    <h2 id="quality-title">Model quality by workload</h2>
    <nav className="local-options" aria-label="Choose a workload">
      {workloads.map(w => <Link key={w.name} prefetch={false} aria-current={w.name === workload.name ? "true" : undefined} href={qualityPath(w) + "#quality"}>{w.name}</Link>)}
    </nav>
    <h3>{workload.name}</h3>
    {workload.interpretation && <p>{workload.interpretation}</p>}
    {metrics(workload).length > 1 && <nav className="local-options local-metrics" aria-label="Choose an evaluation">
      {metrics(workload).map(m => <Link key={m.metric} prefetch={false} aria-current={m.metric === metric.metric ? "true" : undefined} href={qualityPath(workload, m) + "#quality"}>{m.metric}</Link>)}
    </nav>}
    <h4>{metric.metric}</h4><p>{metric.description} <a href={metric.source}>{metric.publisher}</a></p>
    <LocalQualityTable key={qualityPath(workload, metric)} metric={{ metric: metric.metric, models, maximum, unit, lowerIsBetter }} />
  </section>;
}
