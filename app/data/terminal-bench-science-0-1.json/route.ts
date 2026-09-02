import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";

export const dynamic = "force-static";

export function GET(): Response {
  const input: unknown = terminalBenchScienceData;
  const parsed = parseTerminalBenchScienceSnapshot(input);
  if (!parsed.ok) {
    throw new Error(
      "Checked Terminal-Bench-Science snapshot is invalid: " + parsed.error.message,
      { cause: parsed.error },
    );
  }

  return new Response(JSON.stringify(parsed.value, null, 2) + "\n", {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Disposition": "attachment; filename=\"aicharts-terminal-bench-science-0-1.json\"",
      "Content-Type": "application/json; charset=utf-8",
      "Last-Modified": new Date(parsed.value.source.retrievedAt).toUTCString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
