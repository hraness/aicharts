import snapshotJson from "@/data/artificial-analysis-intelligence-v4-3.json";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";

export const dynamic = "force-static";

export function GET(): Response {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(snapshotJson);
  if (!parsed.ok) throw new Error("Invalid checked Intelligence Index v4.3 snapshot", { cause: parsed.error });
  return Response.json(parsed.value, {
    headers: {
      "Content-Disposition": "attachment; filename=\"aicharts-artificial-analysis-intelligence-v4-3.json\"",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
