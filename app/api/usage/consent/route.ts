import { handleUsageConsent } from "@/lib/usage/consent-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleUsageConsent;
export const HEAD = handleUsageConsent;
export const POST = handleUsageConsent;
export const OPTIONS = handleUsageConsent;
export const PUT = handleUsageConsent;
export const PATCH = handleUsageConsent;
export const DELETE = handleUsageConsent;
