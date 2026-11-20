import { NextResponse } from "next/server";
import measurements from "@/data/local-benchmarks.json";
import { RELEASES_HEADERS } from "@/lib/api";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(measurements, { headers: RELEASES_HEADERS });
}
