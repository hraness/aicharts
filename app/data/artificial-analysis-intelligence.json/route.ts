import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence.json";
import { parseArtificialAnalysisIntelligenceSnapshot } from "@/lib/artificial-analysis-intelligence-data";

export const dynamic = "force-static";

export function GET(): Response {
  const input: unknown = artificialAnalysisIntelligenceData;
  const parsed = parseArtificialAnalysisIntelligenceSnapshot(input);
  if (!parsed.ok) {
    throw new Error(
      "Checked Artificial Analysis Intelligence snapshot is invalid: "
        + parsed.error.message,
      { cause: parsed.error },
    );
  }
  const body = JSON.stringify(parsed.value, null, 2) + "\n";

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Disposition":
        "attachment; filename=\"aicharts-artificial-analysis-intelligence.json\"",
      "Content-Type": "application/json; charset=utf-8",
      "Last-Modified": new Date(parsed.value.source.retrievedAt).toUTCString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
