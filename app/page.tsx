import { ReleaseExplorer } from "@/components/release-explorer";
import rawDataset from "@/data/releases.json";
import type { ReleaseDataset } from "@/lib/types";

const dataset = rawDataset as unknown as ReleaseDataset;

export default function HomePage() {
  return <ReleaseExplorer dataset={dataset} />;
}
