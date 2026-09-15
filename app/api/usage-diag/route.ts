import { getContext } from "@vercel/oidc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER = "https://usage.aicharts.io/internal/pairing";
const SECRET = "diag-9f3d2c";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("k") !== SECRET) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const ctx = getContext() as { headers?: Record<string, string> };
  const ctxHeaders = ctx?.headers ?? {};
  const token = ctxHeaders["x-vercel-oidc-token"];
  const intentId = url.searchParams.get("intentId");
  const out: Record<string, unknown> = {
    contextPopulated: ctx !== undefined && ctx !== null && Object.keys(ctx).length > 0,
    ctxHasOidcToken: typeof token === "string",
    tokenIsJwt: typeof token === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token),
  };
  if (typeof token === "string" && intentId !== null && /^[0-9a-f]{64}$/.test(intentId)) {
    try {
      const body = JSON.stringify({ schemaVersion: 1, operation: "beginBrowserAttempt",
        input: { intentId, browserNonce: "ab".repeat(32) } });
      const res = await fetch(WORKER, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
        body, redirect: "manual", credentials: "omit", cache: "no-store",
      });
      const text = await res.text();
      out.workerStatus = res.status;
      out.workerContentType = res.headers.get("content-type");
      out.workerHasContentEncoding = res.headers.has("content-encoding");
      out.workerBody = text.slice(0, 400);
      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
        out.tokenClaims = { iss: payload.iss, aud: payload.aud, sub: payload.sub, owner_id: payload.owner_id };
      } catch { out.tokenClaims = "unparseable"; }
    } catch (e) {
      out.workerError = String(e);
    }
  }
  return Response.json(out);
}
