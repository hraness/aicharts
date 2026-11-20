import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import measurements from "@/data/local-benchmarks.json";
import { RELEASES_HEADERS } from "@/lib/api";

export const dynamic = "force-static";

export async function GET() {
  // Parse original snapshot bytes so the public export retains source precision.
  // Bundling numeric literals into JavaScript can round their last decimal place.
  const filenames = ["local-hardware.json", "local-hardware-language.json", "local-hardware-nonlanguage.json", "local-hardware-iphone-studies.json", "local-hardware-llm-extra.json", "local-hardware-model-extra.json"];
  const [base, ...supplements] = await Promise.all(filenames.map(async file =>
    JSON.parse(await readFile(join(process.cwd(), "data", file), "utf8"))
  ));
  const deviceBenchmarks = { ...base, suites: [...base.suites, ...supplements.flatMap(snapshot => snapshot.suites)] };
  return NextResponse.json({ ...measurements, deviceBenchmarks }, { headers: RELEASES_HEADERS });
}
