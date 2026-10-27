import { rename, rm } from "node:fs/promises";
import path from "node:path";

import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL } from "../lib/artificial-analysis-intelligence-data";
import {
  commitArtificialAnalysisWeights,
  parseArtificialAnalysisWeightsSnapshot,
  type ArtificialAnalysisWeightsSnapshot,
} from "../lib/artificial-analysis-weights";
import { err, isRecord, ok, type Result } from "../lib/result";
import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT } from "./refresh-artificial-analysis-intelligence-v4-3";
import {
  decodeArtificialAnalysisManifest,
  extractArtificialAnalysisIntelligencePage,
  fetchArtificialAnalysisSourceBytes,
  parseArtificialAnalysisModelsPayload,
} from "./refresh-artificial-analysis-intelligence";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "artificial-analysis-weights.json");

async function readCommittedSnapshot(allowMissing = false): Promise<
  Result<ArtificialAnalysisWeightsSnapshot | null, Error>
> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseArtificialAnalysisWeightsSnapshot(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    if (allowMissing && isRecord(cause) && cause.code === "ENOENT") return ok(null);
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function writeCommittedSnapshot(snapshot: ArtificialAnalysisWeightsSnapshot): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    await rename(temporaryPath, OUTPUT_PATH);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function refreshArtificialAnalysisWeights(
  overrides: Readonly<{
    fetchPage?: () => Promise<Result<string, Error>>;
    fetchManifest?: (url: string) => Promise<Result<Uint8Array, Error>>;
    now?: () => string;
    readCommittedSnapshot?: () => Promise<Result<ArtificialAnalysisWeightsSnapshot | null, Error>>;
    writeCommittedSnapshot?: (snapshot: ArtificialAnalysisWeightsSnapshot) => Promise<void>;
  }> = {},
): Promise<Result<ArtificialAnalysisWeightsSnapshot, Error>> {
  const fetchPage = overrides.fetchPage ?? (async () => {
    const bytes = await fetchArtificialAnalysisSourceBytes(
      ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
      "text/html,application/xhtml+xml",
      8 * 1024 * 1024,
    );
    if (!bytes.ok) return bytes;
    try {
      return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes.value));
    } catch (cause) {
      return err(new Error("Could not decode the Artificial Analysis models page.", { cause }));
    }
  });
  const fetchManifest = overrides.fetchManifest
    ?? ((url: string) => fetchArtificialAnalysisSourceBytes(url, "text/plain", 32 * 1024 * 1024));
  const now = overrides.now ?? (() => new Date().toISOString());
  const read = overrides.readCommittedSnapshot ?? (() => readCommittedSnapshot(true));
  const write = overrides.writeCommittedSnapshot ?? writeCommittedSnapshot;

  const html = await fetchPage();
  if (!html.ok) return html;
  const page = extractArtificialAnalysisIntelligencePage(
    html.value,
    ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT,
  );
  if (!page.ok) return page;
  const manifest = await fetchManifest(
    new URL(page.value.manifest.path, ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL).href,
  );
  if (!manifest.ok) return manifest;
  const decoded = await decodeArtificialAnalysisManifest(manifest.value, page.value.manifest.key);
  if (!decoded.ok) return decoded;
  const payload = parseArtificialAnalysisModelsPayload(decoded.value);
  if (!payload.ok) return payload;
  return commitArtificialAnalysisWeights(payload.value.models, now(), { read, write });
}

export async function validateCommittedArtificialAnalysisWeights(): Promise<
  Result<ArtificialAnalysisWeightsSnapshot, Error>
> {
  const result = await readCommittedSnapshot();
  if (!result.ok) return result;
  return result.value === null
    ? err(new Error(`Could not read ${OUTPUT_PATH}.`))
    : ok(result.value);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedArtificialAnalysisWeights()
    : await refreshArtificialAnalysisWeights();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    console.log(
      `${checkOnly ? "Validated" : "Refreshed"} ${result.value.records.length} Artificial Analysis weight identities in data/artificial-analysis-weights.json.`,
    );
  }
}
