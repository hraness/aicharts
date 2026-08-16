import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";

export const dynamic = "force-static";

export function GET(): Response {
  const input: unknown = codingAgentData;
  const parsed = parseCodingAgentSnapshot(input);
  if (!parsed.ok) {
    throw new Error(
      "Checked coding-agent snapshot is invalid: " + parsed.error.message,
      { cause: parsed.error },
    );
  }
  const body = JSON.stringify(parsed.value, null, 2) + "\n";

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Disposition": "attachment; filename=\"aicharts-coding-agent-benchmarks.json\"",
      "Content-Type": "application/json; charset=utf-8",
      "Last-Modified": new Date(parsed.value.source.retrievedAt).toUTCString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
