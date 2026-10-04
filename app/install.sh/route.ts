import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

/** scripts/install.sh, read once at build so the site serves the reviewed bytes. */
export const installScript = readFileSync(join(process.cwd(), "scripts/install.sh"), "utf8");

export function GET(): Response {
  return new Response(installScript, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
