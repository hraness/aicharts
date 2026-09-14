import { describe, expect, test } from "bun:test";
import { goldenCalculatorSnapshot } from "../lib/calculator-golden-fixture";
import type { CalculatorInputsSnapshot } from "../lib/calculator-inputs-data";
import { err, ok } from "../lib/result";
import {
  parseDeepSeekFlashRates,
  parseEiaResidentialPrice,
  parseOpenAiSolRates,
  refreshCalculatorInputs,
  rentalOfferFromVastResponse,
} from "./refresh-calculator-inputs";

const openAiPromoPage = `
<html><body><script>self.__next_f.push([1,"rows: [[0,&quot;gpt-5.6-sol&quot;],[0,4],[0,0.4],[0,5],[0,20]],[1,[[0,&quot;gpt-5.6-terra&quot;],[0,2],[0,0.2],[0,2.5],[0,12]]]"])</script>
<p>GPT-5.6 Sol&#x27;s promotional pricing is available at least through November 21, 2026.</p></body></html>`;

const openAiListPage = `
<html><body><script>self.__next_f.push([1,"rows: [[0,&quot;gpt-5.6-sol&quot;],[0,5],[0,0.5],[0,6.25],[0,30]]"])</script></body></html>`;

const deepSeekPage = `
<html><body>
<td>MODEL VERSION</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td>
<td>PRICING</td>
<td>1M INPUT TOKENS (CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td><td>PEAK</td><td>$0.006</td><td>$0.044</td>
<td>1M INPUT TOKENS (CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td><td>PEAK</td><td>$0.3</td><td>$1.32</td>
<td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td><td>PEAK</td><td>$1.2</td><td>$3.96</td>
<p>(3) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak).</p>
</body></html>`;

const deepSeekSingleColumnPage = deepSeekPage
  .replaceAll("<td>$0.022</td>", "")
  .replaceAll("<td>$0.044</td>", "")
  .replaceAll("<td>$0.66</td>", "")
  .replaceAll("<td>$1.32</td>", "")
  .replaceAll("<td>$1.98</td>", "")
  .replaceAll("<td>$3.96</td>", "")
  .replace("<td>DeepSeek-V4-Pro-0813</td>", "");

const eiaPage = `
<html><body><table>
<tr><td>Average Price of Electricity to Ultimate Customers by End-Use Sector,</td></tr>
<tr><td>by State, June 2026 and 2025 (Cents per Kilowatthour)</td></tr>
<tr><td>New England</td><td>27.60</td><td>28.00</td></tr>
<tr><td>U.S. Total</td><td>18.34</td><td>17.47</td></tr>
</table></body></html>`;

function vastResponse(prices: readonly number[]): unknown {
  return { offers: prices.map(price => ({ dph_total: price })) };
}

describe("OpenAI pricing parser", () => {
  test("reads the promotional Sol rates and the published guarantee date", () => {
    const parsed = parseOpenAiSolRates(openAiPromoPage);
    expect(parsed).toEqual(ok({
      cachedInputPerMillion: 0.4,
      currentBasis: "promotional",
      inputPerMillion: 4,
      outputPerMillion: 20,
      promoGuaranteedThrough: "2026-11-21",
    }));
  });

  test("treats a page without promotional prose as list pricing", () => {
    const parsed = parseOpenAiSolRates(openAiListPage);
    expect(parsed).toEqual(ok({
      cachedInputPerMillion: 0.5,
      currentBasis: "list",
      inputPerMillion: 5,
      outputPerMillion: 30,
      promoGuaranteedThrough: null,
    }));
  });

  test("fails closed when the rate row disappears", () => {
    const parsed = parseOpenAiSolRates("<html><body>New pricing experience</body></html>");
    expect(parsed.ok).toBe(false);
  });
});

describe("DeepSeek pricing parser", () => {
  test("reads Flash rates from the first pricing column", () => {
    const parsed = parseDeepSeekFlashRates(deepSeekPage);
    expect(parsed).toEqual(ok({
      modelVersion: "DeepSeek-V4.1-Flash",
      offPeak: { cacheHitInputPerMillion: 0.003, cacheMissInputPerMillion: 0.15, outputPerMillion: 0.6 },
      peak: { cacheHitInputPerMillion: 0.006, cacheMissInputPerMillion: 0.3, outputPerMillion: 1.2 },
    }));
  });

  test("still parses after the announced V4 Pro column retirement", () => {
    const parsed = parseDeepSeekFlashRates(deepSeekSingleColumnPage);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.offPeak.outputPerMillion).toBe(0.6);
  });

  test("fails closed when the published peak-hour policy changes", () => {
    const changed = deepSeekPage.replace("01:00 - 04:00", "02:00 - 05:00");
    const parsed = parseDeepSeekFlashRates(changed);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain("peak-hour");
  });

  test("fails closed when the first column is no longer a Flash model", () => {
    const swapped = deepSeekPage.replace("DeepSeek-V4.1-Flash", "DeepSeek-V5-Pro");
    expect(parseDeepSeekFlashRates(swapped).ok).toBe(false);
  });
});

describe("EIA electricity parser", () => {
  test("reads the U.S. Total residential average and its reporting period", () => {
    expect(parseEiaResidentialPrice(eiaPage)).toEqual(ok({
      period: "2026-06",
      usResidentialCentsPerKwh: 18.34,
    }));
  });

  test("fails closed when the U.S. Total row disappears", () => {
    const withoutTotal = eiaPage.replace("U.S. Total", "National");
    expect(parseEiaResidentialPrice(withoutTotal).ok).toBe(false);
  });
});

describe("Vast.ai rental offers", () => {
  test("takes the median of the cheapest verified offers", () => {
    const offer = rentalOfferFromVastResponse("rtx-5090", vastResponse([0.41, 0.48, 0.54, 0.6, 0.9]));
    expect(offer).toEqual(ok({ gpuId: "rtx-5090", offerCount: 5, usdPerHour: 0.54 }));
  });

  test("averages the middle pair for an even offer count", () => {
    const offer = rentalOfferFromVastResponse("rtx-4090", vastResponse([0.4, 0.5, 0.7, 0.8]));
    expect(offer).toEqual(ok({ gpuId: "rtx-4090", offerCount: 4, usdPerHour: 0.6 }));
  });

  test("fails closed on a thin market", () => {
    const offer = rentalOfferFromVastResponse("h100-sxm", vastResponse([3.9, 4.2]));
    expect(offer.ok).toBe(false);
    if (!offer.ok) expect(offer.error.message).toContain("stale");
  });

  test("ignores malformed offers instead of pricing them at zero", () => {
    const offer = rentalOfferFromVastResponse("rtx-5090", {
      offers: [{ dph_total: 0.5 }, { dph_total: null }, { dph_total: 0.6 }, {}, { dph_total: 0.7 }],
    });
    expect(offer).toEqual(ok({ gpuId: "rtx-5090", offerCount: 3, usdPerHour: 0.6 }));
  });
});

describe("calculator inputs refresh flow", () => {
  function dependencies(overrides: {
    openAiPage?: string;
    deepSeekPageBody?: string;
    eiaPageBody?: string;
    vastPrices?: readonly number[];
  } = {}) {
    const written: CalculatorInputsSnapshot[] = [];
    return {
      written,
      deps: {
        fetchText: (url: string) => {
          if (url.includes("openai")) return Promise.resolve(ok(overrides.openAiPage ?? openAiPromoPage));
          if (url.includes("deepseek")) return Promise.resolve(ok(overrides.deepSeekPageBody ?? deepSeekPage));
          return Promise.resolve(ok(overrides.eiaPageBody ?? eiaPage));
        },
        now: () => "2026-09-11T10:00:00.000Z",
        postJson: () => Promise.resolve(ok(vastResponse(overrides.vastPrices ?? [0.5, 0.55, 0.6]))),
        // The previous snapshot must be the frozen golden fixture, not the live
        // committed file: replacement-guard ratios in this test must never move
        // when the daily refresh updates real market rates.
        readCommittedInputs: () => Promise.resolve(ok(goldenCalculatorSnapshot())),
        writeCommittedInputs: (snapshot: CalculatorInputsSnapshot) => {
          written.push(snapshot);
          return Promise.resolve();
        },
      },
    };
  }

  test("refreshes live sections and preserves the curated sections byte for byte", async () => {
    const { deps, written } = dependencies();
    const result = await refreshCalculatorInputs(deps);
    expect(result.ok).toBe(true);
    expect(written).toHaveLength(1);
    const refreshed = written[0]!;
    const previous = goldenCalculatorSnapshot();
    expect(refreshed.openAiApiPricing.source.retrievedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(refreshed.gpuRental.offers.every(offer => offer.usdPerHour === 0.55)).toBe(true);
    expect(refreshed.hardware).toEqual(previous.hardware);
    expect(refreshed.subsidyAnchor).toEqual(previous.subsidyAnchor);
    expect(refreshed.plan).toEqual(previous.plan);
  });

  test("does not write when a source page becomes unparseable", async () => {
    const { deps, written } = dependencies({ deepSeekPageBody: "<html>maintenance</html>" });
    const result = await refreshCalculatorInputs(deps);
    expect(result.ok).toBe(false);
    expect(written).toHaveLength(0);
  });

  test("does not write when a live rate jumps past the replacement bound", async () => {
    const { deps, written } = dependencies({
      openAiPage: openAiPromoPage
        .replace("[0,4],[0,0.4],[0,5],[0,20]", "[0,400],[0,40],[0,500],[0,2000]"),
    });
    const result = await refreshCalculatorInputs(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("8x");
    expect(written).toHaveLength(0);
  });

  test("does not write when a network fetch fails", async () => {
    const { deps, written } = dependencies();
    const failing = {
      ...deps,
      postJson: () => Promise.resolve(err(new Error("Vast.ai unreachable"))),
    };
    const result = await refreshCalculatorInputs(failing);
    expect(result.ok).toBe(false);
    expect(written).toHaveLength(0);
  });
});
