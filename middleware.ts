import { NextResponse, type NextRequest } from "next/server";

import {
  appendVaryAccept,
  isMarkdownType,
  preferredType,
} from "@/lib/http-accept";
import { CANONICAL_MARKDOWN_REQUEST_HEADER } from "@/lib/markdown-http";

const MARKDOWN_PREFIX = "/api/markdown";
const NEGOTIABLE_PAGE_PATHS = new Set([
  "/",
  "/blog",
  "/data",
  "/models",
]);

function isNextDataRequest(request: NextRequest): boolean {
  return request.headers.has("rsc")
    || request.headers.has("next-router-prefetch")
    || request.headers.has("next-router-state-tree")
    || request.headers.has("next-router-segment-prefetch");
}

function withoutMarkdownAlias(pathname: string): string {
  const stripped = pathname.endsWith(".md") ? pathname.slice(0, -3) : pathname;
  if (stripped === "") return "/";
  return stripped.length > 1 ? stripped.replace(/\/+$/u, "") : stripped;
}

function isNegotiablePagePath(pathname: string): boolean {
  const normalized = withoutMarkdownAlias(pathname);
  if (NEGOTIABLE_PAGE_PATHS.has(normalized)) return true;

  const segments = normalized.split("/").filter(Boolean);
  return (segments[0] === "blog"
      && segments.length === 2
      && /^[a-z0-9-]+$/u.test(segments[1] ?? ""))
    || (segments[0] === "models" && segments.length === 4);
}

function markdownPath(pathname: string): string {
  const stripped = pathname.endsWith(".md") ? pathname.slice(0, -3) : pathname;
  if (stripped === "" || stripped === "/") return MARKDOWN_PREFIX;
  return `${MARKDOWN_PREFIX}${stripped}`;
}

export function middleware(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (isNextDataRequest(request) || !isNegotiablePagePath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.endsWith(".md")) {
    const url = request.nextUrl.clone();
    url.pathname = markdownPath(pathname);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete(CANONICAL_MARKDOWN_REQUEST_HEADER);
    const rewritten = NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    });
    appendVaryAccept(rewritten.headers);
    return rewritten;
  }

  const acceptHeader = request.headers.get("accept");
  const chosen = preferredType(acceptHeader);

  if (isMarkdownType(chosen)) {
    const url = request.nextUrl.clone();
    url.pathname = markdownPath(pathname);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete(CANONICAL_MARKDOWN_REQUEST_HEADER);
    requestHeaders.set(CANONICAL_MARKDOWN_REQUEST_HEADER, "1");
    const rewritten = NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    });
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
