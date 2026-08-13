import { expect, test } from "bun:test";

test("renders one literal timeline with checked source time and benchmark evidence", async () => {
  const source = await Bun.file(new URL("./model-update-timeline.tsx", import.meta.url)).text();

  expect(source).toContain('id="model-updates"');
  expect(source).toContain("Model updates");
  expect(source).toContain("Daily snapshot diff");
  expect(source).toContain("New model");
  expect(source).toContain("New setting");
  expect(source).toContain("Benchmark change");
  expect(source).toContain("<UpdateMetrics update={update} />");
  expect(source).not.toContain("game-changing");
  expect(source).not.toContain("frontier is moving");
});
