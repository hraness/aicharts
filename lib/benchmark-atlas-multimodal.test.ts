import { describe, expect, test } from "bun:test";
import checked from "../data/benchmark-atlas-multimodal.json";
import { MULTIMODAL_ATLAS_DATASETS, MULTIMODAL_ATLAS_ENTRIES } from "./benchmark-atlas-multimodal";
import { multimodalSnapshotSchema } from "./benchmark-atlas-multimodal-data";
import { validateAtlasCatalog } from "./benchmark-atlas";
import { extractDocuments, extractEditing, extractVideo, extractWise, extractWorld, hasChangedMultimodalRows } from "../scripts/refresh-benchmark-atlas-multimodal";

const htmlRow = (cells: readonly (string | number)[]) => `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`;
const headers = (cells: readonly string[]) => `<tr>${cells.map(cell => `<th>${cell}</th>`).join("")}</tr>`;

const wise = [
  "- Judge model: `Qwen3.5-35B-A3B`", "binary `score`",
  "0.40 * CULTURE + 0.12 * TIME + 0.12 * SPACE + 0.12 * BIOLOGY + 0.12 * PHYSICS + 0.12 * CHEMISTRY",
  "| Rank | Model | Overall | CULTURE | TIME | SPACE | BIOLOGY | PHYSICS | CHEMISTRY | Samples | Complete |",
  ...Array.from({ length: 29 }, (_, index) => `| ${index + 1} | Image ${index} | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 1000 | yes |`),
].join("\n");
const edit = `GEditBench v2 GPT-4o PVC-Judge 1,000 bootstrap <table>${
  headers(["Rank", "Model", "Source", "Samples", "Instruction <span>Following</span>", "Visual Quality", "Visual Consistency", "Overall", "Arena Elo", "Arena Rank"])
}${Array.from({ length: 16 }, (_, index) => htmlRow([index + 1, `Editor ${index}`, "Open", "1,200", "1,020 -10/+11", "990 -9/+9", "1,010 -5/+6", "1,000 -7/+8", "DO NOT IMPORT", "DO NOT IMPORT"])).join("")}</table>`;
const video = `VideoPhy 2 Human Leaderboard SA=1 and PC=1 ${["open", "closed"].map((kind, group) => `<table id="results_${kind}">${htmlRow(["#", "Model", "Source", "All", "Hard", "PA", "OI"])}${Array.from({ length: group === 0 ? 5 : 2 }, (_, index) => htmlRow([index + 1, `Video ${kind} ${index}`, kind, 20, 0, 19, 22])).join("")}</table>`).join("")}`;
const documentHeaders = ["Model Type", "Methods", "Size", "Overall&#x2191;", "Text<sup>Edit</sup>&#x2193;", "Formula<sup>CDM</sup>&#x2191;", "Table<sup>TEDS</sup>&#x2191;", "Table<sup>TEDS-S</sup>&#x2191;", "Read Order<sup>Edit</sup>&#x2193;"];
const docs = `<table><caption>Results (v1.6_full)</caption>${headers(documentHeaders)}${Array.from({ length: 12 }, (_, index) => htmlRow([`Document ${index}`, "Specialized VLMs", "1B", 92, 0.04, 91, 89, 92, 0.12])).join("")}</table>`;
const worldHeader = "Model Type,Model Name,Ability,Sampled by,Evaluated by,Accessibility,Date,WorldScore-Static,WorldScore-Dynamic,Camera Control,Object Control,Content Alignment,3D Consistency,Photometric Consistency,Style Consistency,Subjective Quality,Motion Accuracy,Motion Magnitude,Motion Smoothness";
const worldRow = (label: string, evaluator = "WorldScore") => `Video,[${label}](https://example.com/model),I2V,${evaluator},${evaluator},Open Source,2025.03.30,60,50,30,40,50,70,80,60,40,50,20,60`;
const world = [worldHeader, ...Array.from({ length: 19 }, (_, index) => worldRow(`World ${index}`))].join("\n");

describe("multimodal source admission", () => {
  test.each([
    ["Editor&nbsp;&amp;&nbsp;Co", "Editor & Co"],
    ["Editor &amp;nbsp; Co", "Editor &nbsp; Co"],
    ["Editor &amp;amp; Co", "Editor &amp; Co"],
    ["Editor&nbsp;&amp;nbsp;&nbsp;&amp;amp; &#160; &#x2191; &copy; Co", "Editor &nbsp; &amp; &#160; &#x2191; &copy; Co"],
    ["Editor<span>&amp;</span>\n&nbsp;Co", "Editor & Co"],
  ])("HTML source labels decode supported entities once: %s", (encoded, expected) => {
    expect(extractEditing(edit.replace("Editor 0", encoded))[0].label).toBe(expected);
  });

  test("nested entities cannot become accepted score whitespace or matching headers", () => {
    expect(() => extractEditing(edit.replace("Visual Quality", "Visual&amp;nbsp;Quality"))).toThrow("column order");
    expect(() => extractEditing(edit.replace("1,000 -7/+8", "1,000&amp;nbsp;-7/+8"))).toThrow("confidence interval");
  });

  test("WISE refuses old judges, changed category weights, and incomplete generations", () => {
    expect(extractWise(wise)).toHaveLength(29);
    expect(() => extractWise(wise.replace("Qwen3.5-35B-A3B", "GPT-4o"))).toThrow("judge or weighting");
    expect(() => extractWise(wise.replace("0.12 * PHYSICS", "0.10 * PHYSICS"))).toThrow("judge or weighting");
    expect(() => extractWise(wise.replace("1000 | yes", "999 | yes"))).toThrow("completeness");
  });

  test("editing imports benchmark-judge Elo and uncertainty, never adjacent third-party arena scores", () => {
    const rows = extractEditing(edit);
    expect(rows).toHaveLength(16);
    expect(rows[0]).toMatchObject({ score: 1000, lower: 993, upper: 1008, samples: 1200, instruction: 1020, quality: 990, consistency: 1010 });
    expect(Object.keys(rows[0]).some(key => /arena/iu.test(key))).toBeFalse();
    expect(() => extractEditing(edit.replace("Visual Quality", "Quality score"))).toThrow("column order");
    expect(() => extractEditing(edit.replace("1,000 -7/+8", "1,000 ±7"))).toThrow("confidence interval");
    expect(() => extractEditing(edit.replace("PVC-Judge", "Human voters"))).toThrow("protocol");
  });

  test("video keeps All and Hard distinct and rejects automatic-judge or reordered scores", () => {
    expect(extractVideo(video)[0]).toMatchObject({ score: 20, hard: 0 });
    expect(() => extractVideo(video.replace("Human Leaderboard", "Automatic Leaderboard"))).toThrow("protocol");
    expect(() => extractVideo(video.replace("<td>All</td><td>Hard</td>", "<td>Hard</td><td>All</td>"))).toThrow("columns");
  });

  test("documents select the named full-set table, retaining native edit distance and TEDS units", () => {
    expect(extractDocuments(docs)[0]).toMatchObject({ score: 92, textEdit: 0.04, table: 89, readingOrderEdit: 0.12 });
    expect(() => extractDocuments(docs.replace("v1.6_full", "v1.7_full"))).toThrow("version");
    expect(() => extractDocuments(docs.replace("0.04", "4%"))).toThrow("numeric");
    expect(() => extractDocuments(docs.replace("Overall&#x2191;", "Overall&#x2193;"))).toThrow("column order");
  });

  test("world scores cannot blend self-evaluation or later dates into the author cohort", () => {
    const rows = extractWorld(`${world}\n${worldRow("Self report", "Model team")},extra,columns`);
    expect(rows).toHaveLength(19);
    expect(rows.every(row => row.evaluatedBy === "WorldScore" && row.observedAt === "2025-03-30")).toBeTrue();
    expect(() => extractWorld(world.replace("2025.03.30", "2026.03.30"))).toThrow();
    expect(() => extractWorld(world.replace("60,50,30", "60,50,30,unexpected"))).toThrow("malformed");
    expect(() => extractWorld(world.replace("WorldScore-Static,WorldScore-Dynamic", "WorldScore-Dynamic,WorldScore-Static"))).toThrow("columns");
  });
});

describe("checked multimodal publication", () => {
  test("all charts have explicit versions, native units, and matched catalog evidence", () => {
    expect(validateAtlasCatalog(MULTIMODAL_ATLAS_ENTRIES, MULTIMODAL_ATLAS_DATASETS).ok).toBeTrue();
    expect(MULTIMODAL_ATLAS_DATASETS).toHaveLength(5);
    expect(MULTIMODAL_ATLAS_DATASETS.reduce((sum, dataset) => sum + dataset.points.length, 0)).toBe(103);
    for (const dataset of MULTIMODAL_ATLAS_DATASETS) {
      expect(dataset.evidenceLabel).toBeTruthy();
      expect(dataset.source.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(dataset.points.every(point => point.costUsd === null)).toBeTrue();
    }
  });

  test("owner-published anchors remain on native scales without global normalization", () => {
    const byId = new Map(MULTIMODAL_ATLAS_DATASETS.map(dataset => [dataset.benchmarkId, dataset]));
    expect(byId.get("wise-verified")?.points.find(point => point.id === "qwen-image-agent")?.score).toBe(0.902);
    expect(byId.get("geditbench-2")?.points.find(point => point.id === "nano-banana-pro-26-03-04")?.uncertainty).toMatchObject({ lower: 1090, upper: 1102 });
    expect(byId.get("videophy-2")?.points.find(point => point.id === "wan2-1-14b")?.score).toBe(32.6);
    expect(byId.get("omnidocbench")?.points.find(point => point.id === "paddleocr-vl-1-6")?.score).toBe(96.34);
    expect(byId.get("worldscore-static")?.points.find(point => point.id === "wonderworld")?.score).toBe(72.69);
    const bagel = byId.get("wise-verified")?.points.filter(point => point.model === "BAGEL");
    expect(bagel).toHaveLength(2);
    expect(bagel?.map(point => point.effort)).toContain("With chain of thought");
  });

  test("unknown fields, changed cohorts, duplicate identity, and broken uncertainty fail admission", () => {
    expect(multimodalSnapshotSchema.safeParse(checked).success).toBeTrue();
    expect(multimodalSnapshotSchema.safeParse({ ...checked, arena: [] }).success).toBeFalse();
    const withDuplicate = { ...checked, wise: { ...checked.wise, rows: [checked.wise.rows[0], ...checked.wise.rows.slice(0, -1)] } };
    expect(multimodalSnapshotSchema.safeParse(withDuplicate).success).toBeFalse();
    const wrongJudge = { ...checked, video: { ...checked.video, version: "2 · automatic evaluation" } };
    expect(multimodalSnapshotSchema.safeParse(wrongJudge).success).toBeFalse();
    const brokenInterval = { ...checked, editing: { ...checked.editing, rows: checked.editing.rows.map((row, index) => index === 0 ? { ...row, lower: row.score + 1 } : row) } };
    expect(multimodalSnapshotSchema.safeParse(brokenInterval).success).toBeFalse();
  });

  test("unchanged source reads cannot manufacture freshness or silently replace observations", () => {
    const before = multimodalSnapshotSchema.parse(checked);
    const after = structuredClone(before);
    after.wise.source.retrievedAt = "2026-10-01T00:00:00Z";
    expect(hasChangedMultimodalRows(before, after)).toBeFalse();
    after.wise.rows[0].score = 0.901;
    expect(hasChangedMultimodalRows(before, after)).toBeTrue();
    after.wise.rows[0].id = "unreviewed-replacement";
    expect(() => hasChangedMultimodalRows(before, after)).toThrow("disappearing");
    after.wise.source.url = "https://example.com/copied-table";
    expect(multimodalSnapshotSchema.safeParse(after).success).toBeFalse();
  });
});
