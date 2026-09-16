import { handleUsageLeaderboard } from "@/lib/usage/leaderboard-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleUsageLeaderboard;
export const HEAD = handleUsageLeaderboard;
export const POST = handleUsageLeaderboard;
export const OPTIONS = handleUsageLeaderboard;
export const PUT = handleUsageLeaderboard;
export const PATCH = handleUsageLeaderboard;
export const DELETE = handleUsageLeaderboard;
