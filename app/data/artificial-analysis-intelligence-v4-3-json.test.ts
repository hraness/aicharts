import { expect, test } from "bun:test";
import snapshot from "@/data/artificial-analysis-intelligence-v4-3.json";
import { dynamic, GET } from "./artificial-analysis-intelligence-v4-3.json/route";

test("exports the exact current version without replacing the historical download", async () => {
  const response = GET();
  expect(dynamic).toBe("force-static");
  expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("Content-Disposition")).toContain("aicharts-artificial-analysis-intelligence-v4-3.json");
  expect(await response.json()).toEqual(snapshot);
  expect(snapshot.benchmark.version).toBe("4.3");
});
