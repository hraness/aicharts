import { rename } from "node:fs/promises";
import path from "node:path";

import {
  FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS,
  deriveFirstPartyReleaseRadar,
  emptyFirstPartyReleaseRadar,
  observeFirstPartyReleaseSource,
  parseFirstPartyReleaseRadar,
  parsePreviousFirstPartyReleaseRadar,
  sourceAcceptsContentType,
  validateFirstPartyReleaseReplacement,
  type FetchedSitemap,
  type FirstPartyReleaseRadar,
  type FirstPartyReleaseSourceDefinition,
  type FirstPartyReleaseSourceId,
  type FirstPartyReleaseSourceObservation,
} from "../lib/first-party-release-data";
import { err, isRecord, ok, type Result } from "../lib/result";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "first-party-release-radar.json");
const FETCH_ATTEMPTS = 3;
const MAX_FETCHED_BYTES = 25_000_000;
const MAX_SITEMAP_INDEX_SHARDS = 25;

type FetchSourceFailure = Readonly<{
  error: Error;
  sourceId: FirstPartyReleaseSourceId;
}>;

/**
 * A degraded refresh has already written the newest valid snapshot, retaining
 * last-known-good evidence for the named sources. The error keeps CI visibly
 * unhealthy until those provider-owned sources recover.
 */
export class FirstPartyReleaseRefreshDegradedError extends Error {
  readonly failedSourceIds: readonly FirstPartyReleaseSourceId[];
  readonly snapshot: FirstPartyReleaseRadar;

  constructor(failures: readonly FetchSourceFailure[], snapshot: FirstPartyReleaseRadar) {
    const failedSourceIds = failures.map(failure => failure.sourceId);
    super(
      `First-party release radar refreshed with last-known-good evidence for ${failedSourceIds.join(", ")}; `
      + "the run remains unhealthy until every configured source succeeds.",
      { cause: new AggregateError(failures.map(failure => failure.error), "First-party source failures") },
    );
    this.name = "FirstPartyReleaseRefreshDegradedError";
    this.failedSourceIds = failedSourceIds;
    this.snapshot = snapshot;
  }
}

async function readCommittedFirstPartyReleaseRadar(
  allowMissing = false,
): Promise<Result<FirstPartyReleaseRadar, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = allowMissing
      ? parsePreviousFirstPartyReleaseRadar(input)
      : parseFirstPartyReleaseRadar(input);
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

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function decodedXmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function sitemapIndexChildren(
  definition: FirstPartyReleaseSourceDefinition,
  text: string,
): Result<readonly string[], Error> {
  if (
    /<!DOCTYPE/iu.test(text)
    || [...text.matchAll(/<sitemapindex(?:\s|>)/gu)].length !== 1
    || [...text.matchAll(/<\/sitemapindex>/gu)].length !== 1
    || /<urlset(?:\s|>)/u.test(text)
  ) {
    return err(new Error(`${definition.id} is no longer a strict sitemap index.`));
  }

  const blocks = [...text.matchAll(/<sitemap(?:\s[^>]*)?>([\s\S]*?)<\/sitemap>/gu)];
  const openingCount = [...text.matchAll(/<sitemap\b[^>]*>/gu)].length;
  const closingCount = [...text.matchAll(/<\/sitemap>/gu)].length;
  if (blocks.length !== openingCount || blocks.length !== closingCount) {
    return err(new Error(`${definition.id} contains malformed or unmatched sitemap shard entries.`));
  }
  if (blocks.length === 0 || blocks.length > MAX_SITEMAP_INDEX_SHARDS) {
    return err(new Error(
      `${definition.id} returned ${blocks.length} sitemap shards; expected 1-${MAX_SITEMAP_INDEX_SHARDS}.`,
    ));
  }

  const sourceUrl = new URL(definition.url);
  const children: string[] = [];
  for (const [index, match] of blocks.entries()) {
    const block = match[1];
    if (block === undefined) return err(new Error(`${definition.id} sitemap shard ${index} is empty.`));
    const locations = [...block.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gu)];
    if (locations.length !== 1 || locations[0]?.[1] === undefined) {
      return err(new Error(`${definition.id} sitemap shard ${index} must contain exactly one location.`));
    }

    let child: URL;
    try {
      child = new URL(decodedXmlText(locations[0][1].trim()));
    } catch (cause) {
      return err(new Error(`${definition.id} sitemap shard ${index} has an invalid location.`, { cause }));
    }
    if (
      child.protocol !== "https:"
      || child.host !== sourceUrl.host
      || child.username !== ""
      || child.password !== ""
      || child.search !== ""
      || child.hash !== ""
    ) {
      return err(new Error(`${definition.id} sitemap shard ${child.href} is outside its canonical host.`));
    }
    if (/^\/post-sitemap(?:\d+)?\.xml$/u.test(child.pathname)) children.push(child.href);
  }
  if (children.length === 0 || children.length > MAX_SITEMAP_INDEX_SHARDS) {
    return err(new Error(
      `${definition.id} returned ${children.length} post sitemap shards; expected 1-${MAX_SITEMAP_INDEX_SHARDS}.`,
    ));
  }
  if (new Set(children).size !== children.length) {
    return err(new Error(`${definition.id} contains duplicate sitemap shard locations.`));
  }
  return ok(children);
}

function urlBlocksFromSitemapShard(
  definition: FirstPartyReleaseSourceDefinition,
  text: string,
  childUrl: string,
): Result<readonly string[], Error> {
  if (
    /<!DOCTYPE/iu.test(text)
    || [...text.matchAll(/<urlset(?:\s|>)/gu)].length !== 1
    || [...text.matchAll(/<\/urlset>/gu)].length !== 1
    || /<sitemapindex(?:\s|>)/u.test(text)
  ) {
    return err(new Error(`${definition.id} child ${childUrl} is no longer a strict sitemap urlset.`));
  }
  const blocks = [...text.matchAll(/<url(?:\s[^>]*)?>[\s\S]*?<\/url>/gu)].map(match => match[0]);
  const openingCount = [...text.matchAll(/<url\b[^>]*>/gu)].length;
  const closingCount = [...text.matchAll(/<\/url>/gu)].length;
  if (blocks.length !== openingCount || blocks.length !== closingCount) {
    return err(new Error(`${definition.id} child ${childUrl} contains malformed or unmatched URL entries.`));
  }
  return blocks.length > 0
    ? ok(blocks)
    : err(new Error(`${definition.id} child ${childUrl} contains no URL entries.`));
}

function acceptHeader(definition: FirstPartyReleaseSourceDefinition): string {
  if (definition.format === "html-deepseek-updates") return "text/html";
  if (definition.format === "rss") return "application/rss+xml,application/xml;q=0.9,text/xml;q=0.8";
  if (definition.format.startsWith("sitemap-")) return "application/xml,text/xml;q=0.9";
  // xAI's Markdown endpoint returns a false 404 when text/markdown is the
  // preferred representation, despite serving Markdown for text/plain.
  return "text/plain,*/*;q=0.9";
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Readonly<{ byteLength: number; text: string }>> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw new Error(`Response declared ${declaredLength} bytes; expected at most ${maximumBytes}.`);
    }
  }
  if (response.body === null) return { byteLength: 0, text: "" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let byteLength = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel("First-party source exceeded its byte limit.");
      throw new Error(`Response exceeded the ${maximumBytes}-byte limit while streaming.`);
    }
    chunks.push(decoder.decode(chunk.value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return { byteLength, text: chunks.join("") };
}

async function fetchDocument(
  definition: FirstPartyReleaseSourceDefinition,
  url: string,
  fetchImplementation: FetchImplementation,
  waitBeforeRetry: (milliseconds: number) => Promise<unknown>,
  maximumBytes = MAX_FETCHED_BYTES,
): Promise<Result<FetchedSitemap, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImplementation(url, {
        headers: {
          accept: acceptHeader(definition),
          "user-agent": "aicharts-first-party-release-radar/1.0 (+https://aicharts.io)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 200) throw new Error(`${definition.providerName} returned HTTP ${response.status} for ${url}.`);
      if (response.url !== "" && response.url !== new URL(url).href) {
        throw new Error(`${definition.providerName} redirected ${url} to unexpected location ${response.url}.`);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!sourceAcceptsContentType(definition, contentType)) {
        throw new Error(
          `${definition.providerName} returned unexpected content type ${contentType || "(missing)"} for ${url}.`,
        );
      }
      const body = await readBoundedResponseBody(response, maximumBytes);
      if (body.byteLength === 0) {
        throw new Error(`${definition.providerName} returned 0 bytes for ${url}; expected 1-${maximumBytes}.`);
      }
      return ok({
        byteLength: body.byteLength,
        contentType,
        httpStatus: 200,
        text: body.text,
      });
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < FETCH_ATTEMPTS) await waitBeforeRetry(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error(
    `Could not download ${definition.providerName}'s first-party release source after ${FETCH_ATTEMPTS} attempts.`,
    { cause: lastError },
  ));
}

export async function fetchFirstPartyReleaseSource(
  definition: FirstPartyReleaseSourceDefinition,
  fetchImplementation: FetchImplementation = fetch,
  waitBeforeRetry: (milliseconds: number) => Promise<unknown> = Bun.sleep,
): Promise<Result<FetchedSitemap, Error>> {
  const root = await fetchDocument(definition, definition.url, fetchImplementation, waitBeforeRetry);
  if (!root.ok || definition.format !== "sitemap-index") return root;

  const childUrls = sitemapIndexChildren(definition, root.value.text);
  if (!childUrls.ok) return childUrls;
  const urlBlocks: string[] = [];
  let byteLength = root.value.byteLength;
  for (const childUrl of childUrls.value) {
    const remainingBytes = MAX_FETCHED_BYTES - byteLength;
    if (remainingBytes <= 0) {
      return err(new Error(`${definition.id} sitemap index reached the ${MAX_FETCHED_BYTES}-byte aggregate limit.`));
    }
    const child = await fetchDocument(
      definition,
      childUrl,
      fetchImplementation,
      waitBeforeRetry,
      remainingBytes,
    );
    if (!child.ok) return child;
    byteLength += child.value.byteLength;
    const blocks = urlBlocksFromSitemapShard(definition, child.value.text, childUrl);
    if (!blocks.ok) return blocks;
    urlBlocks.push(...blocks.value);
  }
  return ok({
    byteLength,
    contentType: root.value.contentType,
    httpStatus: 200,
    text: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urlBlocks,
      "</urlset>",
    ].join("\n"),
  });
}

type FirstPartyReleaseRefreshDependencies = Readonly<{
  fetchSitemap: typeof fetchFirstPartyReleaseSource;
  now: () => string;
  readCommitted: (allowMissing?: boolean) => Promise<Result<FirstPartyReleaseRadar, Error>>;
  writeCommitted: (snapshot: FirstPartyReleaseRadar) => Promise<void>;
}>;

const defaultRefreshDependencies: FirstPartyReleaseRefreshDependencies = {
  fetchSitemap: fetchFirstPartyReleaseSource,
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

  const observedAt = dependencies.now();
  const observations: FirstPartyReleaseSourceObservation[] = [];
  const failures: FetchSourceFailure[] = [];
  for (const item of fetched) {
    if (!item.result.ok) {
      failures.push({ error: item.result.error, sourceId: item.definition.id });
      continue;
    }
    const observation = observeFirstPartyReleaseSource(item.definition, item.result.value, observedAt);
    if (!observation.ok) {
      failures.push({
        error: new Error(
          `${item.definition.providerName} first-party release source changed shape: ${observation.error.message}`,
          { cause: observation.error },
        ),
        sourceId: item.definition.id,
      });
      continue;
    }
    observations.push(observation.value);
  }

  const priorSourceIds = new Set(previous.value.sources.map(source => source.id));
  const failuresWithoutFallback = failures.filter(failure => !priorSourceIds.has(failure.sourceId));
  if (failuresWithoutFallback.length > 0) {
    return err(new Error(
      `First-party release refresh cannot add configured sources without healthy initial evidence: `
      + failuresWithoutFallback.map(failure => failure.sourceId).join(", ") + ".",
      { cause: new AggregateError(failuresWithoutFallback.map(failure => failure.error)) },
    ));
  }
  const retainedSourceIds = new Set(failures.map(failure => failure.sourceId));

  const derived = deriveFirstPartyReleaseRadar(
    observations,
    previous.value,
    observedAt,
    { retainedSourceIds },
  );
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
  return failures.length === 0
    ? ok(parsed.value)
    : err(new FirstPartyReleaseRefreshDegradedError(failures, parsed.value));
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
