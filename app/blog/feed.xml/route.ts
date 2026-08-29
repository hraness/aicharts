import { atomFeed } from "../atom-feed";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(atomFeed(), {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      "Content-Type": "application/atom+xml; charset=utf-8",
    },
  });
}
