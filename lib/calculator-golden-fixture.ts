import { CALCULATOR_INPUTS } from "./calculator-inputs-collection";
import type { CalculatorInputsSnapshot } from "./calculator-inputs-data";

/**
 * Test fixture. Golden numbers must not move when the daily refresh updates live
 * market rates, so this pins the September 10, 2026 rates over the checked
 * snapshot's curated sections (which the automated refresh cannot change).
 */
export function goldenCalculatorSnapshot(): CalculatorInputsSnapshot {
  const snapshot = structuredClone(CALCULATOR_INPUTS);
  snapshot.openAiApiPricing.current = {
    cachedInputPerMillion: 0.4,
    inputPerMillion: 4,
    outputPerMillion: 20,
  };
  snapshot.openAiApiPricing.currentBasis = "promotional";
  snapshot.openAiApiPricing.listFallback = {
    cachedInputPerMillion: 0.5,
    inputPerMillion: 5,
    outputPerMillion: 30,
  };
  snapshot.deepSeekApiPricing.offPeak = {
    cacheHitInputPerMillion: 0.003,
    cacheMissInputPerMillion: 0.15,
    outputPerMillion: 0.6,
  };
  snapshot.deepSeekApiPricing.peak = {
    cacheHitInputPerMillion: 0.006,
    cacheMissInputPerMillion: 0.3,
    outputPerMillion: 1.2,
  };
  snapshot.deepSeekApiPricing.peakHoursPerWeek = 35;
  snapshot.electricity.usResidentialCentsPerKwh = 18.34;
  snapshot.gpuRental.offers = [
    { gpuId: "rtx-5090", offerCount: 20, usdPerHour: 0.54 },
    { gpuId: "rtx-4090", offerCount: 15, usdPerHour: 0.6 },
    { gpuId: "h100-sxm", offerCount: 4, usdPerHour: 3.47 },
  ];
  return snapshot;
}
