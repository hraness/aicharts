import { NextResponse } from "next/server";
import rawDataset from "@/data/releases.json";
import { RELEASES_HEADERS } from "@/lib/api";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(rawDataset, { headers: RELEASES_HEADERS });
}
