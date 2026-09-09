import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import checked from "../data/benchmark-atlas-audio.json";
import { sortAtlasPoints, validateAtlasCatalog } from "../lib/benchmark-atlas";
import { AUDIO_ATLAS_DATASETS, AUDIO_ATLAS_ENTRIES } from "../lib/benchmark-atlas-audio";
import { AUDIO_MODELS, AUDIO_SOURCE_REVISION, audioSnapshotSchema } from "../lib/benchmark-atlas-audio-data";
import { AUDIO_CSV_HEADER, buildAudioSnapshot, extractAudioRows, refreshAudioSnapshot, writeAudioSnapshot } from "./refresh-benchmark-atlas-audio";

const expectedScores = [6.96, 7.02, 7.91, 8.31, 9.09, 9.42, 13.19, 13.63, 13.86, 13.88];
const headers = AUDIO_CSV_HEADER.split(",");
const werIndex = headers.indexOf("AMI-Cleaned WER");
function csvCell(value: string): string { return /[,"\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value; }
function fixtureRows(): string[][] {
  return AUDIO_MODELS.map((model, index) => {
    const cells = headers.map(() => "");
    cells[0] = model.modelId;
    cells[werIndex] = String(expectedScores[index]);
    cells[headers.indexOf("AMI WER")] = "42.42";
    cells[headers.indexOf("AMI-Cleaned RTFx")] = "1234.56";
    cells[headers.indexOf("avg")] = "99.99";
    cells[headers.indexOf("Decoder")] = "CTC, TDT / RNN-T";
    return cells;
  });
}
function csv(rows = fixtureRows()): string {
  return `${AUDIO_CSV_HEADER}\n${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}

describe("Open ASR AMI-Cleaned source boundary", () => {
  test("the checked cohort preserves ten exact native observations and seven developers", () => {
    expect(audioSnapshotSchema.safeParse(checked).success).toBe(true);
    expect(checked.rows.map(row => row.wer)).toEqual(expectedScores);
    expect(checked.source.revision).toBe(AUDIO_SOURCE_REVISION);
    expect(checked.observedAt).toBe("2026-09-04");
    expect(validateAtlasCatalog(AUDIO_ATLAS_ENTRIES, AUDIO_ATLAS_DATASETS).ok).toBe(true);
    const dataset = AUDIO_ATLAS_DATASETS[0];
    expect(new Set(dataset.points.map(point => point.provider)).size).toBe(7);
    expect(sortAtlasPoints(dataset).map(point => point.score)).toEqual(expectedScores);
    expect(dataset.score).toEqual({ label: "Word error rate", unit: "% WER", direction: "lower", minimum: 0 });
    expect(dataset.points.every(point => point.costUsd === null && point.uncertainty === null && point.effort === null)).toBe(true);
    expect(dataset.costLabel).toBeUndefined();
    expect(dataset.comparabilityNote).toContain("exact per-run configurations are not published");
    expect(dataset.evidenceLabel).toContain("selected open-weight");
  });

  test("only the named cleaned English test is imported, without averages or speed", () => {
    expect(extractAudioRows(csv())).toEqual(checked.rows);
    expect(extractAudioRows(csv().replaceAll("\n", "\r\n"))).toEqual(checked.rows);
    expect(extractAudioRows(csv().trimEnd())).toEqual(checked.rows);
    expect(extractAudioRows(csv([...fixtureRows()].reverse()))).toEqual(checked.rows);
  });

  test("reordered, duplicate, renamed, and old-AMI headers fail closed", () => {
    const reordered = [...headers];
    [reordered[werIndex], reordered[headers.indexOf("AMI-Cleaned RTFx")]] = [reordered[headers.indexOf("AMI-Cleaned RTFx")], reordered[werIndex]];
    for (const header of [reordered.join(","), AUDIO_CSV_HEADER.replace("AMI-Cleaned WER", "AMI WER"), AUDIO_CSV_HEADER.replace("AMI-Cleaned WER", "WER"), `${AUDIO_CSV_HEADER},AMI-Cleaned WER`]) {
      expect(() => extractAudioRows(csv().replace(AUDIO_CSV_HEADER, header))).toThrow("columns or order changed");
    }
  });

  test("a removed selected row, duplicate model, or malformed width cannot shrink or change the cohort", () => {
    expect(() => extractAudioRows(csv(fixtureRows().slice(1)))).toThrow("Missing selected");
    expect(() => extractAudioRows(csv([...fixtureRows(), fixtureRows()[0]]))).toThrow("duplicate model ID");
    const missingId = fixtureRows(); missingId[0][0] = "";
    expect(() => extractAudioRows(csv(missingId))).toThrow("missing or duplicate");
    const short = fixtureRows(); short[0].pop();
    expect(() => extractAudioRows(csv(short))).toThrow("row width");
    const extra = fixtureRows(); extra[0].push("9.99");
    expect(() => extractAudioRows(csv(extra))).toThrow("row width");
  });

  test.each(["", "-1", "-0", "NaN", "Infinity", "1e2", "6.96%", " 6.96", "6.96 words", "1,234", "9".repeat(400)])("malformed or missing WER is not coerced: %s", value => {
    const rows = fixtureRows(); rows[0][werIndex] = value;
    expect(() => extractAudioRows(csv(rows))).toThrow("Invalid native WER");
  });

  test("zero and insertion-heavy WER over 100 remain valid native error rates", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 25000 }), hundredths => {
      const rows = fixtureRows(); rows[0][werIndex] = String(hundredths / 100);
      expect(extractAudioRows(csv(rows))[0].wer).toBe(hundredths / 100);
    }), { numRuns: 100 });
    for (const wer of [0, 100, 125.25]) {
      const candidate = structuredClone(checked); candidate.rows[0].wer = wer;
      expect(audioSnapshotSchema.safeParse(candidate).success).toBe(true);
    }
  });

  test("quoted commas, escaped quotes and newlines in unused source metadata cannot shift scores", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom("a", ",", '"', "\n", "\r\n", " "), { minLength: 1, maxLength: 80 }), characters => {
      const rows = fixtureRows(); rows[0][headers.indexOf("Decoder")] = characters.join("");
      expect(extractAudioRows(csv(rows))).toEqual(checked.rows);
    }), { numRuns: 100 });
  });

  test("broken CSV quoting, control characters and oversized responses fail closed", () => {
    expect(() => extractAudioRows(`${AUDIO_CSV_HEADER}\n"unfinished`)).toThrow("unfinished quoted");
    expect(() => extractAudioRows(`${AUDIO_CSV_HEADER}\n"closed"bad`)).toThrow("after a quoted");
    expect(() => extractAudioRows(`${AUDIO_CSV_HEADER}\nmisplaced"quote`)).toThrow("misplaced quote");
    expect(() => extractAudioRows(csv().replace("\n", "\r"))).toThrow("invalid line ending");
    expect(() => extractAudioRows(`${csv()}\u0000`)).toThrow("bounded text");
    expect(() => extractAudioRows("x".repeat(60_001))).toThrow("bounded text");
  });

  test("unreviewed bytes, source revisions, metric scale, language, or model IDs are rejected", () => {
    expect(() => buildAudioSnapshot(csv(), "2026-09-09T02:00:00.000Z")).toThrow("checksum changed");
    for (const candidate of [
      { ...checked, source: { ...checked.source, revision: "main" } },
      { ...checked, source: { ...checked.source, sha256: "0".repeat(64) } },
      { ...checked, source: { ...checked.source, url: "https://example.com/scores.csv" } },
      { ...checked, source: { ...checked.source, retrievedAt: "2026-09-03T23:59:59.999Z" } },
      { ...checked, task: { ...checked.task, configuration: "ami" } },
      { ...checked, task: { ...checked.task, language: "French" } },
      { ...checked, task: { ...checked.task, unit: "fraction" } },
      { ...checked, rows: [checked.rows[0], ...checked.rows.slice(0, -1)] },
      { ...checked, rows: [...checked.rows.slice(1), { modelId: "other/model", wer: 0 }] },
    ]) expect(audioSnapshotSchema.safeParse(candidate).success).toBe(false);
  });

  test("failed refreshes and rechecks preserve the checked artifact without false freshness", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aicharts-audio-test-"));
    const output = path.join(directory, "snapshot.json");
    try {
      expect(await writeAudioSnapshot(checked, output)).toBe("written");
      const before = await readFile(output, "utf8");
      const newer = structuredClone(checked); newer.source.retrievedAt = "2026-09-10T00:00:00.000Z";
      expect(await writeAudioSnapshot(newer, output)).toBe("unchanged");
      await expect(refreshAudioSnapshot(output, async () => csv())).rejects.toThrow("checksum changed");
      await expect(refreshAudioSnapshot(output, async () => { throw new Error("source unavailable"); })).rejects.toThrow("source unavailable");
      const changed = structuredClone(newer); changed.rows[0].wer = 0;
      await expect(writeAudioSnapshot(changed, output)).rejects.toThrow("Pinned audio observations changed");
      const older = structuredClone(checked); older.source.retrievedAt = "2026-09-04T00:00:00.000Z";
      await expect(writeAudioSnapshot(older, output)).rejects.toThrow("timestamp regression");
      await expect(writeAudioSnapshot({ ...newer, rows: [] }, output)).rejects.toThrow();
      expect(await readFile(output, "utf8")).toBe(before);
      expect(await readdir(directory)).toEqual(["snapshot.json"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
