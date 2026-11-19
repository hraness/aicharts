import { NextResponse } from "next/server";
import rawDataset from "@/data/releases.json";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(rawDataset, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
