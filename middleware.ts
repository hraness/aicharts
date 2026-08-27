import { NextResponse, type NextRequest } from "next/server";

import {
  appendVaryAccept,
  isMarkdownType,
  preferredType,
} from "@/lib/http-accept";

const MARKDOWN_PREFIX = "/api/markdown";

function isNextDataRequest(request: NextRequest): boolean {
  return request.headers.has("rsc")
    || request.headers.has("next-router-prefetch")
    || request.headers.has("next-router-state-tree")
    || request.headers.has("next-router-segment-prefetch");
}

function isExcludedPath(pathname: string): boolean {
  return pathname.startsWith("/api/")
    || pathname.startsWith("/_next/")
    || pathname.startsWith("/_vercel/")
    || pathname === "/data/coding-agents.json"
    || pathname === "/models/preview"
    || pathname === "/robots.txt"
    || pathname === "/sitemap.xml"
    || pathname.endsWith("/card.png")
    || pathname.endsWith("/opengraph-image")
    || pathname === "/opengraph-image";
}

function markdownPath(pathname: string): string {
  const stripped = pathname.endsWith(".md") ? pathname.slice(0, -3) : pathname;
  if (stripped === "" || stripped === "/") return MARKDOWN_PREFIX;
  return `${MARKDOWN_PREFIX}${stripped}`;
}

export function middleware(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (isExcludedPath(pathname) || isNextDataRequest(request)) {
    return NextResponse.next();
  }

  if (pathname.endsWith(".md")) {
    const url = request.nextUrl.clone();
    url.pathname = markdownPath(pathname);
    const rewritten = NextResponse.rewrite(url);
    appendVaryAccept(rewritten.headers);
    return rewritten;
  }

  const acceptHeader = request.headers.get("accept");
  const chosen = preferredType(acceptHeader);

  if (isMarkdownType(chosen)) {
    const url = request.nextUrl.clone();
    url.pathname = markdownPath(pathname);
    const rewritten = NextResponse.rewrite(url);
    appendVaryAccept(rewritten.headers);
    return rewritten;
  }

  if (chosen === null && acceptHeader !== null && acceptHeader.trim() !== "") {
    return new Response(
      "Not Acceptable\n\nAvailable: text/html, text/markdown\n",
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          Vary: "Accept",
        },
        status: 406,
      },
    );
  }

  const response = NextResponse.next();
  appendVaryAccept(response.headers);
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/|_vercel/).*)"],
};
