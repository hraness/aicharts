import { COMPACTION_EVENTS_MAX_BYTES, decodeCompactionEvents } from "@/lib/usage/compaction";
import { SESSION_REPORT_MAX_BYTES } from "@/lib/usage/session-contract";
import { decodeSessionReport } from "@/lib/usage/sessions";

type LocalFile = Pick<File, "size" | "text">;

async function readBounded(file: LocalFile, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maximumBytes) throw new Error("invalid_report");
  return file.text();
}

export async function readSessionFile(file: LocalFile) {
  const report = decodeSessionReport(await readBounded(file, SESSION_REPORT_MAX_BYTES));
  if (report === null) throw new Error("invalid_report");
  return report;
}

export async function readCompactionFile(file: LocalFile) {
  const log = decodeCompactionEvents(await readBounded(file, COMPACTION_EVENTS_MAX_BYTES));
  if (log === null || (log.events.length === 0 && log.skippedLines > 0)) throw new Error("invalid_events");
  return log;
}
