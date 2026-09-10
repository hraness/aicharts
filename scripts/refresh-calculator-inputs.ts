import { rename } from "node:fs/promises";
import path from "node:path";

import {
  CALCULATOR_DEEPSEEK_PRICING_URL,
  CALCULATOR_EIA_ELECTRICITY_URL,
  CALCULATOR_OPENAI_PRICING_URL,
  CALCULATOR_VAST_RENTAL_URL,
  parseCalculatorInputsSnapshot,
  validateCalculatorInputsReplacement,
  type CalculatorInputsSnapshot,
  type CalculatorRentalOffer,
} from "../lib/calculator-inputs-data";
import { err, ok, type Result } from "../lib/result";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "calculator-inputs.json");

async function readCommittedInputs(): Promise<Result<CalculatorInputsSnapshot, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseCalculatorInputsSnapshot(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

const REQUEST_HEADERS = {
  "user-agent": "aicharts-calculator-inputs/1.0 (+https://aicharts.io)",
} as const;

async function fetchText(url: string, sourceName: string): Promise<Result<string, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { ...REQUEST_HEADERS, accept: "text/html" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${sourceName} returned HTTP ${response.status}.`);
      return ok(await response.text());
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error(`Could not download ${sourceName} after 3 attempts.`, { cause: lastError }));
}

async function postJson(
  url: string,
  body: unknown,
  sourceName: string,
): Promise<Result<unknown, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        body: JSON.stringify(body),
        headers: { ...REQUEST_HEADERS, accept: "application/json", "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${sourceName} returned HTTP ${response.status}.`);
      const parsed: unknown = await response.json();
      return ok(parsed);
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error(`Could not query ${sourceName} after 3 attempts.`, { cause: lastError }));
}

const htmlEntityReplacements: Readonly<Record<string, string>> = {
  "&#x27;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&nbsp;": " ",
  "&quot;": '"',
};

function decodeHtmlEntities(html: string): string {
  // One pass with a callback so a literal `&amp;lt;` cannot double-unescape.
  return html.replaceAll(
    /&(?:#x27|amp|gt|lt|nbsp|quot);/gu,
    entity => htmlEntityReplacements[entity] ?? entity,
  );
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replaceAll(/<script[\s\S]*?<\/script>/giu, " ")
      .replaceAll(/<style[\s\S]*?<\/style>/giu, " ")
      .replaceAll(/<[^>]+>/gu, "\n"),
  );
}

const monthNumbers: Readonly<Record<string, string>> = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12",
};

function isoDateFromLongDate(longDate: string): string | null {
  const match = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/u.exec(longDate.trim());
  if (match === null) return null;
  const month = monthNumbers[match[1]!];
  if (month === undefined) return null;
  return `${match[3]!}-${month}-${match[2]!.padStart(2, "0")}`;
}

export interface ParsedOpenAiSolRates {
  readonly cachedInputPerMillion: number;
  readonly currentBasis: "promotional" | "list";
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly promoGuaranteedThrough: string | null;
}

/**
 * The OpenAI pricing page serializes its standard table into the flight payload as
 * `["gpt-5.6-sol"],[0,<input>],[0,<cached>],[0,<cache write>],[0,<output>]`. The
 * first occurrence is the short-context standard table; Batch rows follow later.
 */
export function parseOpenAiSolRates(html: string): Result<ParsedOpenAiSolRates, Error> {
  const decoded = decodeHtmlEntities(html);
  const row = /gpt-5\.6-sol"\],\[0,([0-9.]+)\],\[0,([0-9.]+)\],\[0,[0-9.]+\],\[0,([0-9.]+)\]/u.exec(decoded);
  if (row === null) {
    return err(new Error("OpenAI pricing page no longer exposes a parseable gpt-5.6-sol rate row."));
  }
  const inputPerMillion = Number(row[1]);
  const cachedInputPerMillion = Number(row[2]);
  const outputPerMillion = Number(row[3]);
  if (![inputPerMillion, cachedInputPerMillion, outputPerMillion].every(value => Number.isFinite(value) && value > 0)) {
    return err(new Error("OpenAI pricing page produced non-numeric gpt-5.6-sol rates."));
  }
  const promo = /promotional pricing is available at least through ([A-Z][a-z]+ \d{1,2}, \d{4})/u.exec(decoded);
  const promoGuaranteedThrough = promo === null ? null : isoDateFromLongDate(promo[1]!);
  if (promo !== null && promoGuaranteedThrough === null) {
    return err(new Error(`OpenAI promo guarantee date is unparseable: ${promo[1]!}`));
  }
  return ok({
    cachedInputPerMillion,
    currentBasis: promoGuaranteedThrough === null ? "list" : "promotional",
    inputPerMillion,
    outputPerMillion,
    promoGuaranteedThrough,
  });
}

export interface ParsedDeepSeekFlashRates {
  readonly modelVersion: string;
  readonly offPeak: {
    readonly cacheHitInputPerMillion: number;
    readonly cacheMissInputPerMillion: number;
    readonly outputPerMillion: number;
  };
  readonly peak: {
    readonly cacheHitInputPerMillion: number;
    readonly cacheMissInputPerMillion: number;
    readonly outputPerMillion: number;
  };
}

const EXPECTED_DEEPSEEK_PEAK_HOURS = "01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday";

/**
 * The DeepSeek pricing table lists `deepseek-flash` as its first column, so the
 * first dollar figure after each OFF-PEAK/PEAK marker belongs to Flash. A second
 * column (V4 Pro today) may follow or disappear without breaking the parse.
 */
export function parseDeepSeekFlashRates(html: string): Result<ParsedDeepSeekFlashRates, Error> {
  const text = stripHtmlTags(html);
  const window = (section: string) => {
    const pattern = new RegExp(
      `${section}[\\s\\S]{0,200}?OFF-PEAK\\s*\\$([0-9.]+)[\\s\\S]{0,80}?PEAK\\s*\\$([0-9.]+)`,
      "u",
    );
    const match = pattern.exec(text);
    if (match === null) return null;
    const offPeak = Number(match[1]);
    const peak = Number(match[2]);
    return Number.isFinite(offPeak) && Number.isFinite(peak) && offPeak > 0 && peak > 0
      ? { offPeak, peak }
      : null;
  };
  const cacheHit = window("\\(CACHE HIT\\)");
  const cacheMiss = window("\\(CACHE MISS\\)");
  const output = window("1M OUTPUT TOKENS");
  if (cacheHit === null || cacheMiss === null || output === null) {
    return err(new Error("DeepSeek pricing page no longer exposes a parseable deepseek-flash rate table."));
  }
  if (!text.includes(EXPECTED_DEEPSEEK_PEAK_HOURS)) {
    return err(new Error(
      "DeepSeek peak-hour policy text changed; review the published peak hours before refreshing.",
    ));
  }
  const version = /MODEL VERSION\s*\n\s*(\S+)/u.exec(text);
  if (version === null || !version[1]!.toLowerCase().includes("flash")) {
    return err(new Error("DeepSeek pricing page no longer names a Flash model version in its first column."));
  }
  return ok({
    modelVersion: version[1]!,
    offPeak: {
      cacheHitInputPerMillion: cacheHit.offPeak,
      cacheMissInputPerMillion: cacheMiss.offPeak,
      outputPerMillion: output.offPeak,
    },
    peak: {
      cacheHitInputPerMillion: cacheHit.peak,
      cacheMissInputPerMillion: cacheMiss.peak,
      outputPerMillion: output.peak,
    },
  });
}

export interface ParsedEiaResidentialPrice {
  readonly period: string;
  readonly usResidentialCentsPerKwh: number;
}

/** EIA's Electric Power Monthly Table 5.6.A: the U.S. Total row leads with residential. */
export function parseEiaResidentialPrice(html: string): Result<ParsedEiaResidentialPrice, Error> {
  const text = stripHtmlTags(html);
  const period = /by State, ([A-Z][a-z]+) (\d{4}) and \d{4}/u.exec(text);
  if (period === null) {
    return err(new Error("EIA table no longer names its reporting period; review Table 5.6.A."));
  }
  const month = monthNumbers[period[1]!];
  if (month === undefined) {
    return err(new Error(`EIA table reports an unrecognized month: ${period[1]!}`));
  }
  const total = /U\.S\. Total[\s\S]{0,80}?([0-9]+\.[0-9]+)/u.exec(text);
  if (total === null) {
    return err(new Error("EIA table no longer exposes a parseable U.S. Total residential price."));
  }
  const centsPerKwh = Number(total[1]);
  if (!Number.isFinite(centsPerKwh) || centsPerKwh <= 0) {
    return err(new Error("EIA U.S. Total residential price is non-numeric."));
  }
  return ok({ period: `${period[2]!}-${month}`, usResidentialCentsPerKwh: centsPerKwh });
}

const VAST_SKUS = [
  { gpuId: "rtx-5090", vastName: "RTX 5090" },
  { gpuId: "rtx-4090", vastName: "RTX 4090" },
  { gpuId: "h100-sxm", vastName: "H100 SXM" },
] as const;

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function rentalOfferFromVastResponse(
  gpuId: string,
  response: unknown,
): Result<CalculatorRentalOffer, Error> {
  if (typeof response !== "object" || response === null || !("offers" in response)) {
    return err(new Error(`Vast.ai response for ${gpuId} has no offers field.`));
  }
  const offers = (response as { offers: unknown }).offers;
  if (!Array.isArray(offers)) {
    return err(new Error(`Vast.ai offers for ${gpuId} are not an array.`));
  }
  const prices = offers
    .map(offer => (
      typeof offer === "object" && offer !== null && "dph_total" in offer
        ? (offer as { dph_total: unknown }).dph_total
        : null
    ))
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0);
  if (prices.length < 3) {
    return err(new Error(
      `Vast.ai lists only ${prices.length} verified ${gpuId} offers; the market feed is stale or the query broke.`,
    ));
  }
  return ok({
    gpuId,
    offerCount: prices.length,
    usdPerHour: Math.round(medianOf(prices) * 100) / 100,
  });
}

type CalculatorInputsRefreshDependencies = Readonly<{
  fetchText: typeof fetchText;
  now: () => string;
  postJson: typeof postJson;
  readCommittedInputs: typeof readCommittedInputs;
  writeCommittedInputs: (snapshot: CalculatorInputsSnapshot) => Promise<void>;
}>;

async function writeCommittedInputs(snapshot: CalculatorInputsSnapshot): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
}

const defaultRefreshDependencies: CalculatorInputsRefreshDependencies = {
  fetchText,
  now: () => new Date().toISOString(),
  postJson,
  readCommittedInputs,
  writeCommittedInputs,
};

export async function validateCommittedCalculatorInputs(): Promise<
  Result<CalculatorInputsSnapshot, Error>
> {
  return readCommittedInputs();
}

/**
 * Live-refreshes the OpenAI, DeepSeek, EIA, and Vast.ai sections and preserves the
 * curated hardware, plan, and subsidy-anchor sections byte for byte. Every source
 * must parse and every replacement guard must pass, or the checked snapshot stays.
 */
export async function refreshCalculatorInputs(
  overrides: Partial<CalculatorInputsRefreshDependencies> = {},
): Promise<Result<CalculatorInputsSnapshot, Error>> {
  const dependencies = { ...defaultRefreshDependencies, ...overrides };
  const previous = await dependencies.readCommittedInputs();
  if (!previous.ok) return previous;

  const openAiHtml = await dependencies.fetchText(CALCULATOR_OPENAI_PRICING_URL, "OpenAI pricing");
  if (!openAiHtml.ok) return openAiHtml;
  const openAiRates = parseOpenAiSolRates(openAiHtml.value);
  if (!openAiRates.ok) return openAiRates;

  const deepSeekHtml = await dependencies.fetchText(CALCULATOR_DEEPSEEK_PRICING_URL, "DeepSeek pricing");
  if (!deepSeekHtml.ok) return deepSeekHtml;
  const deepSeekRates = parseDeepSeekFlashRates(deepSeekHtml.value);
  if (!deepSeekRates.ok) return deepSeekRates;

  const eiaHtml = await dependencies.fetchText(CALCULATOR_EIA_ELECTRICITY_URL, "EIA Electric Power Monthly");
  if (!eiaHtml.ok) return eiaHtml;
  const electricity = parseEiaResidentialPrice(eiaHtml.value);
  if (!electricity.ok) return electricity;

  const rentalOffers: CalculatorRentalOffer[] = [];
  for (const sku of VAST_SKUS) {
    const response = await dependencies.postJson(
      CALCULATOR_VAST_RENTAL_URL,
      {
        gpu_name: { eq: sku.vastName },
        limit: 20,
        num_gpus: { eq: 1 },
        order: [["dph_total", "asc"]],
        rentable: { eq: true },
        type: "ask",
        verified: { eq: true },
      },
      `Vast.ai ${sku.vastName}`,
    );
    if (!response.ok) return response;
    const offer = rentalOfferFromVastResponse(sku.gpuId, response.value);
    if (!offer.ok) return offer;
    rentalOffers.push(offer.value);
  }

  const retrievedAt = dependencies.now();
  const candidate: CalculatorInputsSnapshot = {
    ...previous.value,
    deepSeekApiPricing: {
      ...previous.value.deepSeekApiPricing,
      modelVersion: deepSeekRates.value.modelVersion,
      offPeak: deepSeekRates.value.offPeak,
      peak: deepSeekRates.value.peak,
      source: { ...previous.value.deepSeekApiPricing.source, retrievedAt },
    },
    electricity: {
      ...previous.value.electricity,
      period: electricity.value.period,
      source: { ...previous.value.electricity.source, retrievedAt },
      usResidentialCentsPerKwh: electricity.value.usResidentialCentsPerKwh,
    },
    gpuRental: {
      ...previous.value.gpuRental,
      offers: rentalOffers,
      source: { ...previous.value.gpuRental.source, retrievedAt },
    },
    openAiApiPricing: {
      ...previous.value.openAiApiPricing,
      current: {
        cachedInputPerMillion: openAiRates.value.cachedInputPerMillion,
        inputPerMillion: openAiRates.value.inputPerMillion,
        outputPerMillion: openAiRates.value.outputPerMillion,
      },
      currentBasis: openAiRates.value.currentBasis,
      promoGuaranteedThrough: openAiRates.value.promoGuaranteedThrough,
      source: { ...previous.value.openAiApiPricing.source, retrievedAt },
    },
  };

  const validated = parseCalculatorInputsSnapshot(candidate);
  if (!validated.ok) {
    return err(new Error(
      `Refreshed calculator inputs are invalid: ${validated.error.message}`,
      { cause: validated.error },
    ));
  }
  const safeReplacement = validateCalculatorInputsReplacement(previous.value, validated.value);
  if (!safeReplacement.ok) return safeReplacement;

  await dependencies.writeCommittedInputs(validated.value);
  return ok(validated.value);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedCalculatorInputs()
    : await refreshCalculatorInputs();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const verb = checkOnly ? "Validated" : "Refreshed";
    console.log(
      `${verb} calculator inputs: Sol ${result.value.openAiApiPricing.currentBasis} `
      + `$${result.value.openAiApiPricing.current.inputPerMillion}/$${result.value.openAiApiPricing.current.outputPerMillion} per 1M, `
      + `Flash off-peak $${result.value.deepSeekApiPricing.offPeak.cacheMissInputPerMillion}/$${result.value.deepSeekApiPricing.offPeak.outputPerMillion} per 1M, `
      + `${result.value.electricity.usResidentialCentsPerKwh}c/kWh (${result.value.electricity.period}), `
      + `${result.value.gpuRental.offers.length} rental SKUs in data/calculator-inputs.json.`,
    );
  }
}
