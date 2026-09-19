import { expect, test } from "bun:test";
import { SESSION_REPORT_MAX_BYTES } from "@/lib/usage/session-contract";
import { SESSION_EXAMPLE } from "@/lib/usage/session-example";
import { readCompactionFile, readSessionFile } from "./local-report-file";

const file = (text: string) => ({ size: new TextEncoder().encode(text).length, text: async () => text });

test("both local import paths reject oversized files before allocating their text", async () => {
  let reads = 0;
  const oversized = { size: SESSION_REPORT_MAX_BYTES + 1, text: async () => { reads++; return ""; } };
  await expect(readSessionFile(oversized)).rejects.toThrow("invalid_report");
  await expect(readCompactionFile(oversized)).rejects.toThrow("invalid_report");
  expect(reads).toBe(0);
});

test("session imports validate reports and propagate file read failures", async () => {
  expect(await readSessionFile(file(JSON.stringify(SESSION_EXAMPLE)))).toEqual(SESSION_EXAMPLE);
  await expect(readSessionFile(file('{"prompt":"private source"}'))).rejects.toThrow("invalid_report");
  await expect(readSessionFile({ size: 1, text: async () => { throw new Error("file_unavailable"); } })).rejects.toThrow("file_unavailable");
});

test("an unrelated compaction log does not become a misleading zero-event success", async () => {
  await expect(readCompactionFile(file('{"prompt":"private source"}\nnot-json'))).rejects.toThrow("invalid_events");
  expect(await readCompactionFile(file("\n"))).toEqual({ events: [], skippedLines: 0 });
});
