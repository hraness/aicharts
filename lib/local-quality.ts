import measurements from "@/data/local-benchmarks.json";

export type QualityModel = {
  name: string;
  score: number;
  repository?: string;
  storedParameters?: number;
};
export type QualityMetric = {
  metric: string;
  overviewPublishers?: string[];
  description: string;
  publisher: string;
  source: string;
  maximum: number;
  unit: string;
  lowerIsBetter: boolean;
  models: QualityModel[];
};
export type QualityWorkload = QualityMetric & {
  name: string;
  interpretation?: string;
  comparisons?: QualityMetric[];
};

export const workloads: QualityWorkload[] = measurements.workloads;

export function metrics(workload: QualityWorkload): QualityMetric[] {
  return [workload, ...(workload.comparisons ?? [])];
}

export function slug(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function qualityPath(workload: QualityWorkload, metric: QualityMetric = workload) {
  return "/local/quality/" + slug(workload.name) + "/" + slug(metric.metric);
}
