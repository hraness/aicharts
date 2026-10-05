import { installScript } from "@/lib/install-script";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(installScript, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
