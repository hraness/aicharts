import { expect, test } from "bun:test";
import { metrics, qualityPath, workloads } from "./local-quality";

test("every local evaluation has a unique public route and a usable score scale", () => {
  const paths = new Set<string>();
  for (const workload of workloads) {
    for (const metric of metrics(workload)) {
      const path = qualityPath(workload, metric);
      expect(paths.has(path)).toBe(false);
      paths.add(path);
      expect(path).toMatch(/^\/local\/quality\/[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(new URL(metric.source).protocol).toBe("https:");
      expect(metric.maximum).toBeGreaterThan(0);
      expect(metric.models.length).toBeGreaterThan(1);
      expect(new Set(metric.models.map(m => m.name)).size).toBe(metric.models.length);
      for (const m of metric.models) {
        expect(Number.isFinite(m.score)).toBe(true);
        expect(m.score).toBeLessThanOrEqual(metric.maximum);
      }
    }
  }
});
