import { describe, expect, test } from "bun:test";
import calculatorInputsData from "@/data/calculator-inputs.json";
import {
  calculatorInputsModifiedAt,
  namedSubsidyCeiling,
  parseCalculatorInputsSnapshot,
  validateCalculatorInputsReplacement,
  type CalculatorInputsSnapshot,
} from "./calculator-inputs-data";

function checkedSnapshot(): CalculatorInputsSnapshot {
  const parsed = parseCalculatorInputsSnapshot(calculatorInputsData);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function mutated(
  transform: (snapshot: CalculatorInputsSnapshot) => unknown,
): unknown {
  const clone = structuredClone(checkedSnapshot());
  return transform(clone) ?? clone;
}

describe("calculator inputs schema", () => {
  test("accepts the checked snapshot", () => {
    const parsed = parseCalculatorInputsSnapshot(calculatorInputsData);
    expect(parsed.ok).toBe(true);
  });

  test("keeps DeepSeek peak rates at exactly double the off-peak rates", () => {
    const snapshot = checkedSnapshot();
    expect(snapshot.deepSeekApiPricing.peak.outputPerMillion)
      .toBe(snapshot.deepSeekApiPricing.offPeak.outputPerMillion * 2);
    const broken = mutated((clone) => {
      clone.deepSeekApiPricing.peak.outputPerMillion = clone.deepSeekApiPricing.offPeak.outputPerMillion * 3;
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });

  test("rejects cached input that is not cheaper than uncached input", () => {
    const broken = mutated((clone) => {
      clone.openAiApiPricing.current.cachedInputPerMillion = clone.openAiApiPricing.current.inputPerMillion;
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });

  test("rejects promotional pricing without a published guarantee date", () => {
    const broken = mutated((clone) => {
      clone.openAiApiPricing.promoGuaranteedThrough = null;
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });

  test("rejects hardware profiles that reference unknown or unpurchasable GPUs", () => {
    const unknownGpu = mutated((clone) => {
      clone.hardware.profiles[0]!.gpuId = "rtx-9999";
    });
    expect(parseCalculatorInputsSnapshot(unknownGpu).ok).toBe(false);

    const rentalOnlyGpuAsHome = mutated((clone) => {
      clone.hardware.profiles[0]!.gpuId = "h100-sxm";
    });
    expect(parseCalculatorInputsSnapshot(rentalOnlyGpuAsHome).ok).toBe(false);
  });

  test("rejects rental plans without a matching market offer", () => {
    const broken = mutated((clone) => {
      clone.gpuRental.offers = clone.gpuRental.offers.filter(offer => offer.gpuId !== "h100-sxm");
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });

  test("rejects rental offers backed by fewer than three market listings", () => {
    const broken = mutated((clone) => {
      clone.gpuRental.offers[0]!.offerCount = 2;
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });

  test("rejects duplicate hardware profile ids", () => {
    const broken = mutated((clone) => {
      clone.hardware.profiles[1]!.id = clone.hardware.profiles[0]!.id;
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });

  test("rejects a DeepSeek cache hit that is not cheaper than a cache miss", () => {
    const broken = mutated((clone) => {
      clone.deepSeekApiPricing.offPeak.cacheHitInputPerMillion = clone.deepSeekApiPricing.offPeak.cacheMissInputPerMillion;
      clone.deepSeekApiPricing.peak.cacheHitInputPerMillion = clone.deepSeekApiPricing.peak.cacheMissInputPerMillion;
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });

  test("rejects duplicate or reserved electricity preset ids", () => {
    const duplicate = mutated((clone) => {
      clone.electricity.residentialPresets[1]!.id = clone.electricity.residentialPresets[0]!.id;
    });
    expect(parseCalculatorInputsSnapshot(duplicate).ok).toBe(false);
    // "us-average" is the UI's follow-the-snapshot option and "custom" its free-input state.
    for (const reserved of ["us-average", "custom"]) {
      const collision = mutated((clone) => {
        clone.electricity.residentialPresets[0]!.id = reserved;
      });
      expect(parseCalculatorInputsSnapshot(collision).ok).toBe(false);
    }
  });

  test("cites every electricity preset with a dated source", () => {
    const snapshot = checkedSnapshot();
    expect(snapshot.electricity.residentialPresets.length).toBeGreaterThanOrEqual(3);
    for (const preset of snapshot.electricity.residentialPresets) {
      expect(preset.sourceUrl.startsWith("https://")).toBe(true);
      expect(Number.isNaN(Date.parse(preset.asOf))).toBe(false);
    }
  });

  test("requires both named subsidy ceilings the copy quotes", () => {
    const broken = mutated((clone) => {
      clone.subsidyAnchor.publishedCeilings = clone.subsidyAnchor.publishedCeilings
        .filter(ceiling => ceiling.plan !== "Claude Max 20x");
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
    const snapshot = checkedSnapshot();
    expect(namedSubsidyCeiling(snapshot.subsidyAnchor, "ChatGPT Pro 20x").impliedMultiple).toBe(70);
    expect(namedSubsidyCeiling(snapshot.subsidyAnchor, "Claude Max 20x").impliedMultiple).toBe(40);
  });

  test("rejects impossible calendar dates and reporting months", () => {
    for (const asOf of ["2026-02-29", "2026-04-31", "2026-13-01"]) {
      expect(parseCalculatorInputsSnapshot(mutated(clone => { clone.plan.asOf = asOf; })).ok).toBe(false);
    }
    for (const period of ["2026-00", "2026-13"]) {
      expect(parseCalculatorInputsSnapshot(mutated(clone => { clone.electricity.period = period; })).ok).toBe(false);
    }
    expect(parseCalculatorInputsSnapshot(mutated(clone => { clone.plan.asOf = "2024-02-29"; })).ok).toBe(true);
  });

  test("rejects ambiguous duplicate subsidy ceilings", () => {
    const broken = mutated(clone => {
      clone.subsidyAnchor.publishedCeilings.push({ ...clone.subsidyAnchor.publishedCeilings[0]!, impliedMultiple: 99 });
    });
    expect(parseCalculatorInputsSnapshot(broken).ok).toBe(false);
  });
});

describe("calculator inputs provenance", () => {
  test("derives the modification date from the newest retrieval or as-of date", () => {
    const snapshot = checkedSnapshot();
    const modifiedAt = calculatorInputsModifiedAt(snapshot);
    expect(Number.isNaN(Date.parse(modifiedAt))).toBe(false);
    const allDates = [
      snapshot.deepSeekApiPricing.source.retrievedAt,
      snapshot.electricity.source.retrievedAt,
      snapshot.gpuRental.source.retrievedAt,
      snapshot.openAiApiPricing.source.retrievedAt,
    ];
    for (const date of allDates) {
      expect(Date.parse(modifiedAt)).toBeGreaterThanOrEqual(Date.parse(date));
    }
  });

  test("cites every hardware figure with a dated source", () => {
    const snapshot = checkedSnapshot();
    for (const gpu of snapshot.hardware.gpus) {
      if (gpu.purchase !== null) {
        expect(gpu.purchase.sourceUrl.startsWith("https://")).toBe(true);
        expect(Number.isNaN(Date.parse(gpu.purchase.asOf))).toBe(false);
      }
    }
    for (const profile of snapshot.hardware.profiles) {
      expect(profile.sourceUrl.startsWith("https://")).toBe(true);
      expect(Number.isNaN(Date.parse(profile.sourceObservedOn))).toBe(false);
    }
  });

  test("dated electricity and list-fallback edits advance discovery provenance", () => {
    for (const update of [
      (snapshot: CalculatorInputsSnapshot) => { snapshot.electricity.residentialPresets[0]!.asOf = "2099-01-01"; },
      (snapshot: CalculatorInputsSnapshot) => { snapshot.openAiApiPricing.listFallbackDocumentedOn = "2099-01-01"; },
      (snapshot: CalculatorInputsSnapshot) => { snapshot.subsidyAnchor.methodPublishedOn = "2099-01-01"; },
    ]) {
      const snapshot = checkedSnapshot();
      update(snapshot);
      expect(calculatorInputsModifiedAt(snapshot)).toBe("2099-01-01T00:00:00Z");
    }
  });
});

describe("calculator inputs replacement guards", () => {
  test("accepts an unchanged snapshot", () => {
    const result = validateCalculatorInputsReplacement(checkedSnapshot(), checkedSnapshot());
    expect(result.ok).toBe(true);
  });

  test("accepts ordinary market movement", () => {
    const previous = checkedSnapshot();
    const candidate = structuredClone(previous);
    candidate.gpuRental.offers[0]!.usdPerHour = previous.gpuRental.offers[0]!.usdPerHour * 1.5;
    candidate.electricity.usResidentialCentsPerKwh = 19.1;
    expect(validateCalculatorInputsReplacement(previous, candidate).ok).toBe(true);
  });

  test("rejects a rate jump beyond the 8x bound as a scrape failure", () => {
    const previous = checkedSnapshot();
    const candidate = structuredClone(previous);
    candidate.openAiApiPricing.current = {
      cachedInputPerMillion: 4,
      inputPerMillion: 40,
      outputPerMillion: 200,
    };
    const result = validateCalculatorInputsReplacement(previous, candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("8x");
  });

  test("rejects rental SKUs appearing or disappearing without review", () => {
    const previous = checkedSnapshot();
    const missing = structuredClone(previous);
    missing.gpuRental.offers = missing.gpuRental.offers.slice(0, 2);
    expect(validateCalculatorInputsReplacement(previous, missing).ok).toBe(false);
  });

  test("rejects automated edits to curated sections", () => {
    const previous = checkedSnapshot();
    const candidate = structuredClone(previous);
    candidate.hardware.gpus[0]!.purchase!.usd = 1;
    const result = validateCalculatorInputsReplacement(previous, candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Curated");
  });

  test("rejects automated edits to the curated electricity presets", () => {
    const previous = checkedSnapshot();
    const candidate = structuredClone(previous);
    candidate.electricity.residentialPresets[0]!.centsPerKwh = 1;
    const result = validateCalculatorInputsReplacement(previous, candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Curated");
  });

  test("rejects stale retrievals in each source and a regressed EIA reporting period", () => {
    const previous = checkedSnapshot();
    for (const key of ["openAiApiPricing", "deepSeekApiPricing", "electricity", "gpuRental"] as const) {
      const candidate = structuredClone(previous);
      candidate[key].source.retrievedAt = "2000-01-01T00:00:00Z";
      expect(validateCalculatorInputsReplacement(previous, candidate).ok).toBe(false);
    }
    const candidate = structuredClone(previous);
    candidate.electricity.period = "2000-01";
    expect(validateCalculatorInputsReplacement(previous, candidate).ok).toBe(false);
  });

  test("compares retrieval instants rather than offset timestamp spellings", () => {
    const previous = checkedSnapshot();
    previous.electricity.source.retrievedAt = "2026-06-01T01:00:00+01:00";
    const candidate = structuredClone(previous);
    candidate.electricity.source.retrievedAt = "2026-06-01T00:00:00Z";
    expect(validateCalculatorInputsReplacement(previous, candidate).ok).toBe(true);
  });

  test("automated refresh cannot replace the source, policy or curated fallback date", () => {
    const previous = checkedSnapshot();
    const changes: readonly ((snapshot: CalculatorInputsSnapshot) => void)[] = [
      snapshot => { snapshot.openAiApiPricing.source.url = "https://example.com/different-source"; },
      snapshot => { snapshot.deepSeekApiPricing.source.name = "Different provider"; },
      snapshot => { snapshot.gpuRental.methodology = "Cheapest single listing"; },
      snapshot => { snapshot.deepSeekApiPricing.peakHoursPerWeek = 1; },
      snapshot => { snapshot.deepSeekApiPricing.peakHoursUtc = "Different hours"; },
      snapshot => { snapshot.openAiApiPricing.listFallbackDocumentedOn = "2099-01-01"; },
    ];
    for (const change of changes) {
      const candidate = structuredClone(previous);
      change(candidate);
      expect(validateCalculatorInputsReplacement(previous, candidate).ok).toBe(false);
    }
  });
});
