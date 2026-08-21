import { markdownForPath, MARKDOWN_CONTENT_TYPE } from "@/lib/site-markdown";

function pathnameFromSlug(slug: readonly string[] | undefined): string {
  if (slug === undefined || slug.length === 0) return "/";
  return `/${slug.join("/")}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug?: string[] }> },
): Promise<Response> {
  const { slug } = await context.params;
  const document = markdownForPath(pathnameFromSlug(slug));
  return new Response(document.body, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": document.contentType,
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
    },
    status: document.found ? 200 : 404,
  });
}

export const markdownRouteContentType = MARKDOWN_CONTENT_TYPE;
