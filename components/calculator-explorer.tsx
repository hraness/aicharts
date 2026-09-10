"use client";

import { Knob, NativeSelectField, type NativeSelectOption } from "@hraness/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { CalculatorInputsSnapshot } from "@/lib/calculator-inputs-data";
import {
  CALCULATOR_KNOB_BOUNDS,
  computeCalculatorScenario,
  DEFAULT_CALCULATOR_KNOBS,
  POWER_USER_HOURS_PER_WEEK,
  usefulLifeCheckpointMonths,
  type CalculatorKnobs,
  type DeepSeekWindow,
  type DutyCycle,
  type SolRateBasis,
} from "@/lib/calculator-math";
import { calculatorFaviconHref } from "@/lib/calculator-favicon";
import { calculatorKnobsEqual, calculatorKnobsFromSearch, calculatorKnobsSearch } from "@/lib/calculator-share";
import { openAiEffortColors, providerColor } from "@/lib/chart-colors";
import { captureAnalyticsEvent, type CalculatorAnalyticsControl } from "@/lib/analytics";
import { SegmentedControl } from "@/components/ui";

const usdWhole = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});
const usdCents = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

function formatUsd(value: number): string {
  return value >= 100 ? usdWhole.format(value) : usdCents.format(value);
}

function formatTokens(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatTps(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatCents(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}¢`;
}

type CostBarSegment = Readonly<{
  color: string;
  id: string;
  label: string;
  valueUsd: number;
}>;

type CostBarRow = Readonly<{
  annotation?: string;
  detail: string;
  id: string;
  label: string;
  segments: readonly CostBarSegment[];
}>;

function rowTotal(row: CostBarRow): number {
  return row.segments.reduce((sum, segment) => sum + segment.valueUsd, 0);
}

/**
 * Horizontal cost bars in the site's HTML bar idiom. Rows are static text plus a
 * proportional track, so pointer, keyboard, and touch users read the same values.
 */
function CostBarChart({
  "aria-label": ariaLabel,
  rows,
}: Readonly<{
  "aria-label": string;
  rows: readonly CostBarRow[];
}>) {
  const maximum = Math.max(...rows.map(rowTotal), 1e-9);
  return (
    <ul aria-label={ariaLabel} className="calculator-bars">
      {rows.map((row) => {
        const total = rowTotal(row);
        return (
          <li className="calculator-bars__row" key={row.id}>
            <span className="calculator-bars__copy">
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </span>
            <span aria-hidden="true" className="calculator-bars__track">
              {row.segments.map(segment => (
                segment.valueUsd <= 0 ? null : (
                  <i
                    key={segment.id}
                    style={{
                      background: segment.color,
                      width: `${Math.max(0.4, segment.valueUsd / maximum * 100)}%`,
                    }}
                  />
                )
              ))}
            </span>
            <span className="calculator-bars__value">
              {formatUsd(total)}
              {row.annotation === undefined ? null : <small>{row.annotation}</small>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Swatch({ color }: Readonly<{ color: string }>) {
  return <i aria-hidden="true" className="calculator-legend__swatch" style={{ background: color }} />;
}

function CalculatorKnob({
  bounds,
  control,
  label,
  onChange,
  renderValue,
  value,
}: Readonly<{
  bounds: Readonly<{ min: number; max: number; step: number }>;
  control: CalculatorAnalyticsControl;
  label: string;
  onChange: (value: number) => void;
  renderValue: (value: number) => ReactNode;
  value: number;
}>) {
  return (
    <Knob
      density="compact"
      label={label}
      max={bounds.max}
      min={bounds.min}
      onChange={onChange}
      onChangeEnd={() => {
        captureAnalyticsEvent({ name: "calculator adjusted", properties: { control } });
      }}
      renderValue={renderValue}
      step={bounds.step}
      touchPan="horizontal"
      value={value}
    />
  );
}

export function CalculatorExplorer({
  snapshot,
}: Readonly<{ snapshot: CalculatorInputsSnapshot }>) {
  const [knobs, setKnobs] = useState<CalculatorKnobs>(DEFAULT_CALCULATOR_KNOBS);
  const scenario = useMemo(() => computeCalculatorScenario(snapshot, knobs), [knobs, snapshot]);
  const profileIds = useMemo(() => snapshot.hardware.profiles.map(profile => profile.id), [snapshot]);

  // The URL is the shareable state: read it on load and on history navigation.
  useEffect(() => {
    const readUrl = () => {
      const next = calculatorKnobsFromSearch(window.location.search, profileIds);
      setKnobs(current => (calculatorKnobsEqual(current, next) ? current : next));
    };
    readUrl();
    window.addEventListener("popstate", readUrl);
    return () => window.removeEventListener("popstate", readUrl);
  }, [profileIds]);

  // Write knobs back after a short pause so knob drags do not spam history
  // (Safari rate-limits replaceState), and only when the query actually changes.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = calculatorKnobsSearch(knobs, window.location.search);
      const nextUrl = `${window.location.pathname}${search === "" ? "" : `?${search}`}${window.location.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [knobs]);

  // The tab icon shows the headline monthly figure for the current scenario.
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLLinkElement>("link[rel~=\"icon\"]")];
    if (links.length === 0) return;
    const originals = links.map(link => [link, link.href, link.type] as const);
    for (const link of links) {
      link.href = calculatorFaviconHref(scenario.spendUsd);
      link.type = "image/svg+xml";
    }
    return () => {
      for (const [link, href, type] of originals) {
        link.href = href;
        link.type = type;
      }
    };
  }, [scenario.spendUsd]);

  const setKnob = (partial: Partial<CalculatorKnobs>) => {
    setKnobs(current => ({ ...current, ...partial }));
  };
  const selectKnob = (partial: Partial<CalculatorKnobs>, control: CalculatorAnalyticsControl) => {
    setKnob(partial);
    captureAnalyticsEvent({ name: "calculator adjusted", properties: { control } });
  };

  const gpuNames = useMemo(() => new Map(
    snapshot.hardware.gpus.map(gpu => [gpu.id, gpu.name] as const),
  ), [snapshot]);
  const profileOptions: readonly NativeSelectOption<string>[] = useMemo(() => (
    snapshot.hardware.profiles.map(profile => ({ id: profile.id, label: profile.name }))
  ), [snapshot]);

  const openaiColor = providerColor("openai");
  const deepseekColor = providerColor("deepseek");
  const nvidiaColor = providerColor("nvidia");
  const stickerColor = openAiEffortColors.none;
  const cachedInputColor = openAiEffortColors.max;
  const outputColor = openAiEffortColors.medium;
  // Depreciation keeps the solid NVIDIA green; electricity is a neutral diagonal
  // hatch so the two ownership segments stay distinct in both themes.
  const powerBase = "color-mix(in oklab, var(--foreground) 58%, var(--background))";
  const powerFill = `repeating-linear-gradient(135deg, ${powerBase} 0 4px, color-mix(in oklab, var(--foreground) 16%, var(--background)) 4px 8px)`;
  const rentalColor = `color-mix(in oklab, ${nvidiaColor} 60%, var(--foreground) 12%)`;

  const solBasisLabel = knobs.solRateBasis === "current"
    ? snapshot.openAiApiPricing.currentBasis === "promotional" ? "promotional rates" : "current rates"
    : "list rates";
  const windowLabels: Record<DeepSeekWindow, string> = {
    blended: "blended rates",
    offPeak: "off-peak rates",
    peak: "peak rates",
  };
  const homeGpuName = gpuNames.get(scenario.profile.gpuId) ?? scenario.profile.gpuId;
  const rentalGpuName = gpuNames.get(scenario.profile.rental.gpuId) ?? scenario.profile.rental.gpuId;
  const dutyLabel = knobs.dutyCycle === "continuous"
    ? "24/7"
    : `${POWER_USER_HOURS_PER_WEEK} h/week`;

  // The preset control mirrors the knob: null follows the snapshot's US average,
  // an explicit value selects the matching preset or reads as a custom rate.
  const US_AVERAGE_PRESET_ID = "us-average";
  const electricityPresetId = knobs.electricityCentsPerKwh === null
    ? US_AVERAGE_PRESET_ID
    : snapshot.electricity.residentialPresets.find(
      preset => preset.centsPerKwh === knobs.electricityCentsPerKwh,
    )?.id ?? "custom";
  const electricityPresetItems = [
    { cents: snapshot.electricity.usResidentialCentsPerKwh, id: US_AVERAGE_PRESET_ID, label: "US avg" },
    ...snapshot.electricity.residentialPresets.map(preset => ({
      cents: preset.centsPerKwh,
      id: preset.id,
      label: preset.label,
    })),
  ].sort((left, right) => left.cents - right.cents);
  const homeUpfrontAnnotation = knobs.residualValuePercent > 0
    ? `${formatUsd(scenario.home.upfrontUsd)} up front, ${formatUsd(scenario.home.residualValueUsd)} resale`
    : `${formatUsd(scenario.home.upfrontUsd)} up front`;

  const pathRows: readonly CostBarRow[] = [
    {
      detail: `${knobs.seats} seat${knobs.seats === 1 ? "" : "s"} at ${formatUsd(snapshot.plan.monthlyPriceUsd)}`,
      id: "sticker",
      label: `${snapshot.plan.name} sticker`,
      segments: [{ color: stickerColor, id: "sticker", label: "Sticker", valueUsd: scenario.stickerUsd }],
    },
    {
      detail: `Same volume at ${solBasisLabel}`,
      id: "sol",
      label: `${snapshot.openAiApiPricing.modelName} API`,
      segments: [{ color: openaiColor, id: "sol", label: "Sol API", valueUsd: scenario.sol.breakdown.totalUsd }],
    },
    {
      detail: `Same volume at ${windowLabels[knobs.deepSeekWindow]}`,
      id: "deepseek",
      label: `${snapshot.deepSeekApiPricing.modelVersion} API`,
      segments: [{ color: deepseekColor, id: "deepseek", label: "DeepSeek API", valueUsd: scenario.deepSeek.selectedUsd }],
    },
    {
      annotation: homeUpfrontAnnotation,
      detail: `${scenario.home.gpuCount}x ${homeGpuName} over ${knobs.amortizationMonths} months, ${dutyLabel}`,
      id: "home",
      label: "Home hardware",
      segments: [
        { color: nvidiaColor, id: "depreciation", label: "Depreciation", valueUsd: scenario.home.depreciationMonthlyUsd },
        { color: powerFill, id: "power", label: "Electricity", valueUsd: scenario.home.electricityMonthlyUsd },
      ],
    },
    {
      detail: `${scenario.rental.gpuCount}x ${rentalGpuName} at ${usdCents.format(scenario.rental.unitUsdPerHour)}/hr, ${dutyLabel}`,
      id: "rental",
      label: "Rented GPUs",
      segments: [{ color: rentalColor, id: "rental", label: "Rental", valueUsd: scenario.rental.monthlyUsd }],
    },
  ];

  const structureRows: readonly CostBarRow[] = [
    {
      annotation: homeUpfrontAnnotation,
      detail: `${formatUsd(scenario.home.depreciationMonthlyUsd)} depreciation + ${formatUsd(scenario.home.electricityMonthlyUsd)} electricity`,
      id: "home",
      label: `Buy ${scenario.home.gpuCount}x ${homeGpuName}`,
      segments: [
        { color: nvidiaColor, id: "depreciation", label: "Depreciation", valueUsd: scenario.home.depreciationMonthlyUsd },
        { color: powerFill, id: "power", label: "Electricity", valueUsd: scenario.home.electricityMonthlyUsd },
      ],
    },
    {
      detail: `${scenario.rental.unitCount} unit${scenario.rental.unitCount === 1 ? "" : "s"} for ${formatTps(scenario.hoursPerMonth)} h/month`,
      id: "rental",
      label: `Rent ${scenario.rental.gpuCount}x ${rentalGpuName}`,
      segments: [{ color: rentalColor, id: "rental", label: "Rental", valueUsd: scenario.rental.monthlyUsd }],
    },
  ];

  // Ownership cost accrues linearly, so quarter marks of the useful life show
  // the depreciation and electricity stacks growing toward the full-life total.
  const accrualRows: readonly CostBarRow[] = usefulLifeCheckpointMonths(knobs.amortizationMonths)
    .map(month => ({
      annotation: month === knobs.amortizationMonths ? homeUpfrontAnnotation : undefined,
      detail: `${formatUsd(scenario.rental.monthlyUsd * month)} rented over the same months`,
      id: `month-${month}`,
      label: `Month ${month}`,
      segments: [
        {
          color: nvidiaColor,
          id: "depreciation",
          label: "Depreciation",
          valueUsd: scenario.home.depreciationMonthlyUsd * month,
        },
        {
          color: powerFill,
          id: "power",
          label: "Electricity",
          valueUsd: scenario.home.electricityMonthlyUsd * month,
        },
      ],
    }));

  const solDetailRows: readonly CostBarRow[] = [
    {
      detail: `${formatTokens(scenario.volume.missedInputTokens)} tokens at $${scenario.sol.rates.inputPerMillion}/1M`,
      id: "input-miss",
      label: "Input, cache miss",
      segments: [{ color: openaiColor, id: "miss", label: "Cache miss", valueUsd: scenario.sol.breakdown.missedInputUsd }],
    },
    {
      detail: `${formatTokens(scenario.volume.cachedInputTokens)} tokens at $${scenario.sol.rates.cachedInputPerMillion}/1M`,
      id: "input-hit",
      label: "Input, cache hit",
      segments: [{ color: cachedInputColor, id: "hit", label: "Cache hit", valueUsd: scenario.sol.breakdown.cachedInputUsd }],
    },
    {
      detail: `${formatTokens(scenario.volume.outputTokens)} tokens at $${scenario.sol.rates.outputPerMillion}/1M`,
      id: "output",
      label: "Output",
      segments: [{ color: outputColor, id: "output", label: "Output", valueUsd: scenario.sol.breakdown.outputUsd }],
    },
  ];

  return (
    <div className="calculator-explorer">
      <section aria-label="Calculator assumptions" className="calculator-controls">
        <div className="calculator-controls__knobs">
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.seats}
            control="seats"
            label="Seats"
            onChange={seats => setKnob({ seats })}
            renderValue={value => value}
            value={knobs.seats}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.subsidyMultiple}
            control="subsidy_multiple"
            label="Subsidy"
            onChange={subsidyMultiple => setKnob({ subsidyMultiple })}
            renderValue={value => `${value}x`}
            value={knobs.subsidyMultiple}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.utilizationPercent}
            control="utilization"
            label="Utilization"
            onChange={utilizationPercent => setKnob({ utilizationPercent })}
            renderValue={value => `${value}%`}
            value={knobs.utilizationPercent}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.cacheHitPercent}
            control="cache_hit"
            label="Cache hits"
            onChange={cacheHitPercent => setKnob({ cacheHitPercent })}
            renderValue={value => `${value}%`}
            value={knobs.cacheHitPercent}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.inputTokensPerOutputToken}
            control="token_mix"
            label="In:out mix"
            onChange={inputTokensPerOutputToken => setKnob({ inputTokensPerOutputToken })}
            renderValue={value => `${value}:1`}
            value={knobs.inputTokensPerOutputToken}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.ultraMultiple}
            control="ultra_multiple"
            label="Ultra"
            onChange={ultraMultiple => setKnob({ ultraMultiple })}
            renderValue={value => `${value}x`}
            value={knobs.ultraMultiple}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.amortizationMonths}
            control="amortization_months"
            label="Useful life"
            onChange={amortizationMonths => setKnob({ amortizationMonths })}
            renderValue={value => `${value} mo`}
            value={knobs.amortizationMonths}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.residualValuePercent}
            control="resale_value"
            label="Resale value"
            onChange={residualValuePercent => setKnob({ residualValuePercent })}
            renderValue={value => `${value}%`}
            value={knobs.residualValuePercent}
          />
          <CalculatorKnob
            bounds={CALCULATOR_KNOB_BOUNDS.electricityCentsPerKwh}
            control="electricity_rate"
            label="Electricity"
            onChange={electricityCentsPerKwh => setKnob({ electricityCentsPerKwh })}
            renderValue={value => `${formatCents(value)}/kWh`}
            value={scenario.home.electricityCentsPerKwh}
          />
        </div>
        <div className="calculator-controls__modes">
          <div className="calculator-mode">
            <span aria-hidden="true" className="calculator-mode__label">Sol rates</span>
            <SegmentedControl<SolRateBasis>
              aria-label="Sol rates"
              className="chart-segmented-control"
              items={[
                {
                  id: "current",
                  label: `${snapshot.openAiApiPricing.currentBasis === "promotional" ? "Promo" : "Current"} $${snapshot.openAiApiPricing.current.inputPerMillion}/$${snapshot.openAiApiPricing.current.outputPerMillion}`,
                },
                {
                  id: "list",
                  label: `List $${snapshot.openAiApiPricing.listFallback.inputPerMillion}/$${snapshot.openAiApiPricing.listFallback.outputPerMillion}`,
                },
              ]}
              onChange={solRateBasis => selectKnob({ solRateBasis }, "sol_rate_basis")}
              value={knobs.solRateBasis}
            />
          </div>
          <div className="calculator-mode">
            <span aria-hidden="true" className="calculator-mode__label">DeepSeek window</span>
            <SegmentedControl<DeepSeekWindow>
              aria-label="DeepSeek window"
              className="chart-segmented-control"
              items={[
                { id: "offPeak", label: "Off-peak" },
                { id: "peak", label: "Peak" },
                { id: "blended", label: "Blended" },
              ]}
              onChange={deepSeekWindow => selectKnob({ deepSeekWindow }, "deepseek_window")}
              value={knobs.deepSeekWindow}
            />
          </div>
          <div className="calculator-mode">
            <span aria-hidden="true" className="calculator-mode__label">Electricity rate</span>
            <SegmentedControl<string>
              aria-label="Electricity rate"
              className="chart-segmented-control"
              items={electricityPresetItems.map(item => ({
                id: item.id,
                label: `${item.label} ${formatCents(item.cents)}`,
              }))}
              onChange={(presetId) => {
                const preset = electricityPresetItems.find(item => item.id === presetId);
                if (preset === undefined) return;
                selectKnob({
                  electricityCentsPerKwh: presetId === US_AVERAGE_PRESET_ID ? null : preset.cents,
                }, "electricity_preset");
              }}
              value={electricityPresetId}
            />
          </div>
          <div className="calculator-mode">
            <span aria-hidden="true" className="calculator-mode__label">Duty cycle</span>
            <SegmentedControl<DutyCycle>
              aria-label="Duty cycle"
              className="chart-segmented-control"
              items={[
                { id: "powerUser", label: `${POWER_USER_HOURS_PER_WEEK} h/week` },
                { id: "continuous", label: "24/7" },
              ]}
              onChange={dutyCycle => selectKnob({ dutyCycle }, "duty_cycle")}
              value={knobs.dutyCycle}
            />
          </div>
          <NativeSelectField
            className="calculator-profile-select"
            label="Hardware profile"
            onChange={hardwareProfileId => selectKnob({ hardwareProfileId }, "hardware_profile")}
            options={profileOptions}
            size="compact"
            surface="pane"
            value={knobs.hardwareProfileId}
          />
        </div>
      </section>

      <section aria-labelledby="calculator-paths-heading" className="calculator-chart">
        <h2 id="calculator-paths-heading">Monthly cost by path</h2>
        <p className="calculator-chart__context">
          {`Every path serves the same implied volume: ${formatTokens(scenario.volume.totalTokens)} tokens a month, valued at ${formatUsd(scenario.spendUsd)} on ${snapshot.openAiApiPricing.modelName} ${solBasisLabel}.`}
        </p>
        <CostBarChart aria-label="Monthly cost by path" rows={pathRows} />
        <p className="calculator-chart__note">
          {knobs.solRateBasis === "current" && snapshot.openAiApiPricing.currentBasis === "promotional"
            ? `At list rates ($${snapshot.openAiApiPricing.listFallback.inputPerMillion}/$${snapshot.openAiApiPricing.listFallback.outputPerMillion} per 1M), the same volume costs ${formatUsd(scenario.sol.otherBasisUsd)}.`
            : `At the current rates ($${snapshot.openAiApiPricing.current.inputPerMillion}/$${snapshot.openAiApiPricing.current.outputPerMillion} per 1M), the same volume costs ${formatUsd(scenario.sol.otherBasisUsd)}.`}
          {" "}
          {`DeepSeek off-peak ${formatUsd(scenario.deepSeek.offPeakUsd)}, peak ${formatUsd(scenario.deepSeek.peakUsd)}, blended ${formatUsd(scenario.deepSeek.blendedUsd)}.`}
        </p>
      </section>

      <section aria-labelledby="calculator-structure-heading" className="calculator-chart">
        <h2 id="calculator-structure-heading">Own or rent the same throughput</h2>
        <p className="calculator-chart__context">
          {`${scenario.profile.modelClass} at about ${formatTps(scenario.profile.unitDecodeTps)} decode tok/s per unit. The load needs ${formatTps(scenario.requiredTps)} aggregate tok/s across ${formatTps(scenario.hoursPerMonth)} hours a month.`}
        </p>
        <CostBarChart aria-label="Home hardware versus rental cost" rows={structureRows} />
        <p className="calculator-legend">
          <Swatch color={nvidiaColor} /> Depreciation
          <Swatch color={powerFill} /> Electricity
          <Swatch color={rentalColor} /> Rental
        </p>
        <p className="calculator-chart__note">
          {`Owning depreciates the ${formatUsd(scenario.home.upfrontUsd)} purchase straight-line over ${knobs.amortizationMonths} months to a ${knobs.residualValuePercent}% resale value, plus grid electricity at ${formatCents(scenario.home.electricityCentsPerKwh)}/kWh. Set the electricity knob to the energy rate on your utility bill or a public tariff sheet; the presets span cheap hydro to island rates.`}
        </p>
      </section>

      <section aria-labelledby="calculator-accrual-heading" className="calculator-chart">
        <h2 id="calculator-accrual-heading">Ownership cost over the useful life</h2>
        <p className="calculator-chart__context">
          {`Cumulative cost of owning at each quarter of the ${knobs.amortizationMonths}-month useful life. Owning accrues ${formatUsd(scenario.home.totalMonthlyUsd * knobs.amortizationMonths)} by the end; renting the same throughput accrues ${formatUsd(scenario.rental.monthlyUsd * knobs.amortizationMonths)}.`}
        </p>
        <CostBarChart aria-label="Cumulative ownership cost over the useful life" rows={accrualRows} />
        <p className="calculator-legend">
          <Swatch color={nvidiaColor} /> Depreciation
          <Swatch color={powerFill} /> Electricity
        </p>
      </section>

      <section aria-labelledby="calculator-sol-heading" className="calculator-chart">
        <h2 id="calculator-sol-heading">Where the Sol API dollars go</h2>
        <CostBarChart aria-label="Sol API cost breakdown" rows={solDetailRows} />
      </section>

      <section aria-labelledby="calculator-load-heading" className="calculator-load">
        <h2 id="calculator-load-heading">Implied load</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Monthly tokens</th>
              <td>{`${formatTokens(scenario.volume.inputTokens)} in + ${formatTokens(scenario.volume.outputTokens)} out = ${formatTokens(scenario.volume.totalTokens)}`}</td>
            </tr>
            <tr>
              <th scope="row">Required decode rate</th>
              <td>{`${formatTps(scenario.requiredTps)} tok/s aggregate (${dutyLabel})`}</td>
            </tr>
            <tr>
              <th scope="row">Home fleet</th>
              <td>{`${scenario.home.gpuCount}x ${homeGpuName} (${formatUsd(scenario.home.upfrontUsd)} up front)`}</td>
            </tr>
            <tr>
              <th scope="row">Rental fleet</th>
              <td>{`${scenario.rental.gpuCount}x ${rentalGpuName} at ${usdCents.format(scenario.rental.unitUsdPerHour)}/hr`}</td>
            </tr>
            <tr>
              <th scope="row">Throughput basis</th>
              <td>{`${scenario.profile.unitDecodeTpsBasis === "measured" ? "Measured benchmark" : scenario.profile.unitDecodeTpsBasis === "published-band" ? "Published band" : "Bandwidth estimate"} (${scenario.profile.sourceName})`}</td>
            </tr>
          </tbody>
        </table>
        <p className="calculator-chart__note">{scenario.profile.note}</p>
      </section>
    </div>
  );
}
