import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { LocalQuality } from "@/components/local-quality";
import { metrics, qualityPath, slug, workloads } from "@/lib/local-quality";
import { pageMetadata } from "@/journal/content";
import "../../../local.css";

export const dynamicParams = false;
export function generateStaticParams() {
  return workloads.flatMap(w => metrics(w).map(m => ({ workload: slug(w.name), metric: slug(m.metric) })));
}
type Props = { params: Promise<{ workload: string; metric: string }> };
async function selection({ params }: Props) {
  const p = await params;
  const workload = workloads.find(w => slug(w.name) === p.workload);
  if (!workload) notFound();
  const metric = metrics(workload).find(m => slug(m.metric) === p.metric);
  if (!metric) notFound();
  return { workload, metric };
}
export async function generateMetadata(props: Props) {
  const { workload, metric } = await selection(props);
  return pageMetadata(workload.name + " model comparison · " + metric.metric, metric.description, qualityPath(workload, metric));
}
export default async function Comparison(props: Props) {
  const { workload, metric } = await selection(props);
  return <article className="catalog-page">
    <Breadcrumbs trail={[{name:"Local benchmarks",href:"/local"},{name:workload.name,href:qualityPath(workload,metric)}]} />
    <h1>{workload.name} benchmarks</h1>
    <p><a href="/local#hardware">Compare device speeds and memory</a> · <a href="/local/models">Find downloadable models</a></p>
    <LocalQuality workload={workload} metric={metric} />
  </article>;
}
