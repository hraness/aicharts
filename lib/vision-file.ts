import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Experiment, VisionRow } from "./vision-bench";
export async function visionRows(test:Experiment):Promise<VisionRow[]> {
  return JSON.parse(await readFile(join(process.cwd(),"public",test.path),"utf8"));
}
