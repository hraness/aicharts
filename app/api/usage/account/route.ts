import { handleUsageAccount } from "@/lib/usage/account-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleUsageAccount;
export const HEAD = handleUsageAccount;
export const POST = handleUsageAccount;
export const OPTIONS = handleUsageAccount;
export const PUT = handleUsageAccount;
export const PATCH = handleUsageAccount;
export const DELETE = handleUsageAccount;
