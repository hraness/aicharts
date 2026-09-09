import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { legacyChartDestination } from "./chart-navigation";

describe("legacy chart navigation", () => {
  test("preserves every atlas field and repeated comparison IDs", () => {
    const query = "?atlas=arc-agi-2&task=reasoning&atlasView=cost&atlasPoint=a&atlasCompare=a&atlasCompare=b&atlasProvider=OpenAI&atlasAll=1&atlasProfiles=all";
    const result = legacyChartDestination("/", query, "#explore");
    expect(result).toBe(`/benchmarks${query}#explore`);
    expect(new URL(result!, "https://aicharts.io").searchParams.getAll("atlasCompare")).toEqual(["a", "b"]);
  });
  test("preserves coding selections and known old anchors", () => {
    const query = "?benchmark=deepSwe&compare=totalTokens&point=point-id&provider=openai";
    expect(legacyChartDestination("/", query)).toBe(`/coding${query}#coding-agents`);
    for (const hash of ["#chart", "#coding-agents", "#model-updates", "#coding-agent-chart-title"]) {
      expect(legacyChartDestination("/", "", hash)).toBe(`/coding${hash}`);
    }
    expect(legacyChartDestination("/", "", "#explore")).toBe("/benchmarks#explore");
  });
  test("recognizes each previous atlas key without requiring a selected benchmark", () => {
    for (const key of ["task", "atlasView", "atlasPoint", "atlasCompare", "atlasProvider", "atlasAll", "atlasProfiles"]) {
      expect(legacyChartDestination("/", `?${key}=value`)).toBe(`/benchmarks?${key}=value#explore`);
    }
  });
  test("does not redirect ordinary home visits, new routes, or unrelated fragments", () => {
    for (const value of ["", "?utm_source=notes", "?q=memory"]) expect(legacyChartDestination("/", value, "#intelligence-index")).toBeNull();
    for (const path of ["/coding", "/benchmarks", "/data", "/api/markdown", "//evil.example"]) expect(legacyChartDestination(path, "?atlas=a")).toBeNull();
    for (const invalid of [null, undefined, 3, {}, []]) {
      expect(legacyChartDestination(invalid, "?atlas=a")).toBeNull();
      expect(legacyChartDestination("/", invalid)).toBeNull();
      if (invalid !== undefined) expect(legacyChartDestination("/", "?atlas=a", invalid)).toBeNull();
    }
  });
  test("arbitrary state cannot change the destination origin or drop repeated values", () => {
    fc.assert(fc.property(fc.array(fc.string({ maxLength: 120 }), { maxLength: 8 }), values => {
      const query = new URLSearchParams({ atlas: "aa-intelligence-4-3" });
      values.forEach(value => query.append("atlasCompare", value));
      const result = legacyChartDestination("/", `?${query}`);
      const parsed = new URL(result!, "https://aicharts.io");
      expect(parsed.origin).toBe("https://aicharts.io");
      expect(parsed.pathname).toBe("/benchmarks");
      expect(parsed.searchParams.getAll("atlasCompare")).toEqual(values);
      expect(legacyChartDestination(parsed.pathname, parsed.search, parsed.hash)).toBeNull();
    }));
  });
});
