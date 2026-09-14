import { AGENT_GUIDE_CONTENT_TYPE, agentGuideMarkdown } from "@/lib/site-markdown";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(agentGuideMarkdown(), {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": AGENT_GUIDE_CONTENT_TYPE,
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
