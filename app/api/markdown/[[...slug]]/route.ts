import { markdownForPath } from "@/lib/site-markdown";
import { CANONICAL_MARKDOWN_REQUEST_HEADER } from "@/lib/markdown-http";
import { site } from "@/app/site";

function pathnameFromSlug(slug: readonly string[] | undefined): string {
  if (slug === undefined || slug.length === 0) return "/";
  return `/${slug.join("/")}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug?: string[] }> },
): Promise<Response> {
  const { slug } = await context.params;
  const pathname = pathnameFromSlug(slug);
  const document = markdownForPath(pathname);
  const headers = new Headers({
    "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    "Content-Type": document.contentType,
    Vary: "Accept",
    "X-Content-Type-Options": "nosniff",
  });
  if (
    !document.found
    || request.headers.get(CANONICAL_MARKDOWN_REQUEST_HEADER) !== "1"
  ) {
    headers.set("X-Robots-Tag", "noindex, follow");
  }
  if (document.found) {
    headers.set("Link", `<${new URL(pathname, site.origin).toString()}>; rel="canonical"`);
  }
  return new Response(document.body, {
    headers,
    status: document.found ? 200 : 404,
  });
}
