import { handleUsageStats } from "@/lib/usage/stats-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleUsageStats;
export const HEAD = handleUsageStats;
export const POST = handleUsageStats;
export const OPTIONS = handleUsageStats;
export const PUT = handleUsageStats;
export const PATCH = handleUsageStats;
export const DELETE = handleUsageStats;
