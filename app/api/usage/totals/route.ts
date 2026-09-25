import { handleUsageTotals } from "@/lib/usage/stats-totals-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleUsageTotals;
export const HEAD = handleUsageTotals;
export const POST = handleUsageTotals;
export const OPTIONS = handleUsageTotals;
export const PUT = handleUsageTotals;
export const PATCH = handleUsageTotals;
export const DELETE = handleUsageTotals;
