import argo from "../data/argo-bench.json";
import ironbee from "../data/ironbee-code-review.json";
import roboflow from "../data/roboflow-visual-reasoning.json";
import type { BenchmarkSnapshot, ReleaseDataset, SnapshotBenchmarkId } from "./types";

export const BENCHMARK_SNAPSHOTS: Readonly<Record<SnapshotBenchmarkId, BenchmarkSnapshot>> = {
  "argo-bench": argo as BenchmarkSnapshot,
  ironbee: ironbee as BenchmarkSnapshot,
  roboflow: roboflow as BenchmarkSnapshot,
};

export const BENCHMARK_SOURCES = {
  "argo-bench": {
    label: "TextQL results",
    url: BENCHMARK_SNAPSHOTS["argo-bench"].sourceUrl,
    date: BENCHMARK_SNAPSHOTS["argo-bench"].snapshotDate,
    credit: "Tomitsuka et al., 2026",
    referenceLabel: "Paper",
    referenceUrl: "https://arxiv.org/abs/2610.02122",
  },
  roboflow: {
    label: "Roboflow results",
    url: BENCHMARK_SNAPSHOTS.roboflow.sourceUrl,
    date: BENCHMARK_SNAPSHOTS.roboflow.snapshotDate,
    referenceLabel: "Apache 2.0",
    referenceUrl: "https://github.com/roboflow/vlm-exam/blob/7955957ea07ff79616203badd53d851d119f72d9/LICENSE",
  },
  ironbee: {
    label: "IronBee results",
    url: BENCHMARK_SNAPSHOTS.ironbee.sourceUrl,
    date: BENCHMARK_SNAPSHOTS.ironbee.snapshotDate,
    credit: "© 2026 IronBee",
    referenceLabel: "MIT",
    referenceUrl: "https://github.com/ironbee-ai/code-review-benchmarks/blob/d7300e86b568dad527f501f50510ab5bdbff3bb5/LICENSE",
  },
} as const;

/** The explorer pairs each snapshot with the catalog release it actually tested. */
export function withBenchmarkSnapshots(dataset: ReleaseDataset): ReleaseDataset {
  return {
    ...dataset,
    releases: dataset.releases.map((release) => ({
      ...release,
      benchmarkRuns: {
        "argo-bench": BENCHMARK_SNAPSHOTS["argo-bench"].runs[release.slug],
        ironbee: BENCHMARK_SNAPSHOTS.ironbee.runs[release.slug],
        roboflow: BENCHMARK_SNAPSHOTS.roboflow.runs[release.slug],
      },
    })),
  };
}
