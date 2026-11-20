import { describe, expect, test } from "bun:test";
import { searchBenchmarks, type BenchmarkChoice } from "./benchmark-search";

const choices = [
  {
    id: "argo-bench",
    label: "Argo-Bench",
    summary: "Data agents investigate a warehouse and make decisions on 210 business tasks.",
    keywords: ["enterprise analytics", "finance"],
  },
  {
    id: "roboflow",
    label: "Roboflow Visual Reasoning",
    summary: "A model judge grades answers to questions about images.",
    keywords: ["vision", "multimodal"],
  },
  {
    id: "ironbee",
    label: "IronBee Code Review",
    summary: "Models find issues in pull requests.",
    keywords: ["F₂", "review"],
  },
  { id: "gpqa", label: "GPQA Diamond", summary: "Graduate-level science questions." },
  { id: "terminal-bench", label: "Terminal-Bench", summary: "Agents solve tasks in a terminal." },
  { id: "game-bench", label: "GameBench 2", summary: "Models write players for eight strategy games." },
] as const satisfies readonly BenchmarkChoice[];

function ids(query: string) {
  return searchBenchmarks(choices, query).map(({ id }) => id);
}

describe("benchmark search", () => {
  test("preserves display order for blank queries and ties", () => {
    expect(searchBenchmarks(choices, " \t ")).toEqual(choices.slice());
    expect(searchBenchmarks(choices, " . / ")).toEqual(choices.slice());
    expect(ids("bench").slice(0, 2)).toEqual(["argo-bench", "terminal-bench"]);
  });

  test("folds case, accents, separators, and compatibility characters", () => {
    expect(ids("  ÁRGO / BÉNCH  ")).toEqual(["argo-bench"]);
    expect(ids("gamebench2")).toEqual(["game-bench"]);
    expect(ids("f2")).toEqual(["ironbee"]);
  });

  test("ranks whole names and prefixes ahead of keyword and description matches", () => {
    const ranked = [
      { id: "summary", label: "Evaluation", summary: "A visual benchmark." },
      { id: "keyword", label: "Picture Bench", summary: "", keywords: ["visual"] },
      { id: "word", label: "Applied Visual Reasoning", summary: "" },
      { id: "prefix", label: "Visual Reasoning", summary: "" },
      { id: "exact", label: "Visual", summary: "" },
    ];
    expect(searchBenchmarks(ranked, "visual").map(({ id }) => id)).toEqual([
      "exact", "prefix", "word", "keyword", "summary",
    ]);
  });

  test("matches keywords and descriptive terms, in any order", () => {
    expect(ids("enterprise warehouse")).toEqual(["argo-bench"]);
    expect(ids("images visual vision")).toEqual(["roboflow"]);
    expect(ids("diamond gpqa")).toEqual(["gpqa"]);
    expect(ids("diamond warehouse")).toEqual([]);
  });

  test("matches omitted letters and adjacent transpositions", () => {
    expect(ids("robflw")).toEqual(["roboflow"]);
    expect(ids("arog")).toEqual(["argo-bench"]);
    expect(ids("dimaond gpqa")).toEqual(["gpqa"]);
    expect(ids("termminal")).toEqual(["terminal-bench"]);
  });

  test("rejects short, interior, and sparse matches", () => {
    expect(ids("rb")).toEqual([]);
    expect(ids("en")).toEqual([]);
    expect(ids("ent")).toEqual(["argo-bench"]);
    expect(ids("rflw")).toEqual([]);
    expect(ids("ofl")).toEqual([]);
    expect(ids("at")).toEqual([]);
  });
});
