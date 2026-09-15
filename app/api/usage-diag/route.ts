import { getContext } from "@vercel/oidc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const ctx = getContext() as { headers?: Record<string, string> };
  const ctxHeaders = ctx?.headers ?? {};
  const keys = Object.keys(ctxHeaders);
  return Response.json({
    contextPopulated: ctx !== undefined && ctx !== null && Object.keys(ctx).length > 0,
    ctxHeaderCount: keys.length,
    ctxHasOidcToken: typeof ctxHeaders["x-vercel-oidc-token"] === "string",
    reqHasOidcToken: request.headers.get("x-vercel-oidc-token") !== null,
    envHasOidcToken: typeof process.env.VERCEL_OIDC_TOKEN === "string" && process.env.VERCEL_OIDC_TOKEN.length > 0,
    ctxHeaderNames: keys.filter(k => k.startsWith("x-vercel") || k === "authorization"),
  });
}
