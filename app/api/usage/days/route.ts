import { handleUsagePrivateDays } from "@/lib/usage/private-days-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleUsagePrivateDays;
export const HEAD = handleUsagePrivateDays;
export const POST = handleUsagePrivateDays;
export const OPTIONS = handleUsagePrivateDays;
export const PUT = handleUsagePrivateDays;
export const PATCH = handleUsagePrivateDays;
export const DELETE = handleUsagePrivateDays;
