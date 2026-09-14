import { handleUsageAuth } from "@/lib/usage/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleUsageAuth;
export const POST = handleUsageAuth;
// Explicit exports keep Next's automatic HEAD and OPTIONS handling from
// starting authentication or returning responses without the privacy policy.
export const HEAD = handleUsageAuth;
export const OPTIONS = handleUsageAuth;
export const PUT = handleUsageAuth;
export const PATCH = handleUsageAuth;
export const DELETE = handleUsageAuth;
