import { rename } from "node:fs/promises";
import path from "node:path";

import {
  FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS,
  deriveFirstPartyReleaseRadar,
  emptyFirstPartyReleaseRadar,
  observeFirstPartyReleaseSource,
  parseFirstPartyReleaseRadar,
  validateFirstPartyReleaseReplacement,
  type FetchedSitemap,
  type FirstPartyReleaseRadar,
  type FirstPartyReleaseSourceDefinition,
} from "../lib/first-party-release-data";
import { err, isRecord, ok, type Result } from "../lib/result";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "first-party-release-radar.json");

async function readCommittedFirstPartyReleaseRadar(
  allowMissing = false,
): Promise<Result<FirstPartyReleaseRadar, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseFirstPartyReleaseRadar(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    if (allowMissing && isRecord(cause) && cause.code === "ENOENT") {
      return ok(emptyFirstPartyReleaseRadar());
    }
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function writeCommittedFirstPartyReleaseRadar(snapshot: FirstPartyReleaseRadar): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
}

async function fetchSitemap(
  definition: FirstPartyReleaseSourceDefinition,
): Promise<Result<FetchedSitemap, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(definition.url, {
        headers: {
          accept: "application/xml,text/xml;q=0.9",
          "user-agent": "aicharts-first-party-release-radar/1.0 (+https://aicharts.io)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${definition.providerName} returned HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!contentType.includes("xml")) {
        throw new Error(`${definition.providerName} returned unexpected content type ${contentType || "(missing)"}.`);
      }
      const text = await response.text();
      return ok({
        byteLength: new TextEncoder().encode(text).byteLength,
        contentType,
        httpStatus: 200,
        text,
      });
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error(
    `Could not download ${definition.providerName}'s first-party release sitemap after 3 attempts.`,
    { cause: lastError },
  ));
}

type FirstPartyReleaseRefreshDependencies = Readonly<{
  fetchSitemap: typeof fetchSitemap;
  now: () => string;
  readCommitted: (allowMissing?: boolean) => Promise<Result<FirstPartyReleaseRadar, Error>>;
  writeCommitted: (snapshot: FirstPartyReleaseRadar) => Promise<void>;
}>;

const defaultRefreshDependencies: FirstPartyReleaseRefreshDependencies = {
  fetchSitemap,
  now: () => new Date().toISOString(),
  readCommitted: readCommittedFirstPartyReleaseRadar,
  writeCommitted: writeCommittedFirstPartyReleaseRadar,
};

export async function validateCommittedFirstPartyReleaseRadar(): Promise<Result<FirstPartyReleaseRadar, Error>> {
  return readCommittedFirstPartyReleaseRadar();
}

export async function refreshFirstPartyReleaseRadar(
  overrides: Partial<FirstPartyReleaseRefreshDependencies> = {},
): Promise<Result<FirstPartyReleaseRadar, Error>> {
  const dependencies = { ...defaultRefreshDependencies, ...overrides };
  const previous = await dependencies.readCommitted(true);
  if (!previous.ok) return previous;

  const fetched = await Promise.all(FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.map(async definition => ({
    definition,
    result: await dependencies.fetchSitemap(definition),
  })));
  const failed = fetched.find(item => !item.result.ok);
  if (failed !== undefined && !failed.result.ok) return failed.result;

  const observedAt = dependencies.now();
  const observations = [];
  for (const item of fetched) {
    if (!item.result.ok) return item.result;
    const observation = observeFirstPartyReleaseSource(item.definition, item.result.value, observedAt);
    if (!observation.ok) {
      return err(new Error(
        `${item.definition.providerName} first-party release source changed shape: ${observation.error.message}`,
        { cause: observation.error },
      ));
    }
    observations.push(observation.value);
  }

  const derived = deriveFirstPartyReleaseRadar(observations, previous.value, observedAt);
  const parsed = parseFirstPartyReleaseRadar(derived);
  if (!parsed.ok) {
    return err(new Error(
      `Normalized first-party release radar is invalid: ${parsed.error.message}`,
      { cause: parsed.error },
    ));
  }
  const replacement = validateFirstPartyReleaseReplacement(previous.value, parsed.value);
  if (!replacement.ok) return replacement;

  await dependencies.writeCommitted(parsed.value);
  return ok(parsed.value);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedFirstPartyReleaseRadar()
    : await refreshFirstPartyReleaseRadar();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const needsReview = result.value.candidates.filter(candidate => candidate.status === "needs-review").length;
    const verb = checkOnly ? "Validated" : "Refreshed";
    console.log(
      `${verb} ${result.value.candidates.length} durable first-party release candidates `
      + `(${needsReview} needing review) in data/first-party-release-radar.json.`,
    );
  }
}
