import { createPublicSiteMetadata } from "@hraness/web-discovery";

import calculatorInputsData from "@/data/calculator-inputs.json";
import { CalculatorExplorer } from "@/components/calculator-explorer";
import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import {
  calculatorInputsModifiedAt,
  namedSubsidyCeiling,
  parseCalculatorInputsSnapshot,
} from "@/lib/calculator-inputs-data";
import { CALCULATOR_KNOB_BOUNDS } from "@/lib/calculator-math";
import { searchSite } from "@/app/site";

import "@/styles/chart-home.css";
import "@/styles/calculator.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI cost calculator | AI Charts",
  description: "Compare the monthly cost of a fully used ChatGPT Pro seat against OpenAI API rates, DeepSeek Flash, home GPUs, and rented GPUs at the same token volume.",
}, { canonicalPath: "/calculator" });

const longDate = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function formatDate(isoDate: string): string {
  return longDate.format(new Date(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate));
}

function formatMonth(isoMonth: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC", year: "numeric" })
    .format(new Date(`${isoMonth}-01T00:00:00Z`));
}

export default function CalculatorPage() {
  const parsed = parseCalculatorInputsSnapshot(calculatorInputsData);
  if (!parsed.ok) throw new Error(`Checked calculator inputs are invalid: ${parsed.error.message}`, { cause: parsed.error });
  const inputs = parsed.value;
  const ratesAsOf = calculatorInputsModifiedAt(inputs);
  const anchor = inputs.subsidyAnchor;
  const proCeiling = namedSubsidyCeiling(anchor, "ChatGPT Pro 20x");
  const maxCeiling = namedSubsidyCeiling(anchor, "Claude Max 20x");

  return <>
    <SiteHeader current="/calculator" />
    <main className="chart-home calculator-home" id="main-content">
      <header className="chart-page-intro">
        <h1>AI cost calculator</h1>
        <p>One fully used ChatGPT Pro 20x seat implies a monthly token volume. This page prices that same volume five ways: the subscription sticker, the {inputs.openAiApiPricing.modelName} API, the {inputs.deepSeekApiPricing.modelVersion} API, GPUs you buy, and GPUs you rent.</p>
        <p className="chart-page-intro__coverage">Rates as of {formatDate(ratesAsOf)}.</p>
      </header>
      <CalculatorExplorer snapshot={inputs} />
      <section aria-labelledby="calculator-method-heading" className="calculator-provenance">
        <h2 id="calculator-method-heading">Method</h2>
        <p>
          The anchor is a <a href={anchor.methodSourceUrl} rel="noopener noreferrer">{formatDate(anchor.methodPublishedOn)} SemiAnalysis stress test</a>: the firm bought each OpenAI and Anthropic subscription tier, ran long-horizon coding and agent tasks until weekly limits were exhausted, and valued the consumed tokens at public API rates. A maxed ChatGPT Pro 20x seat reached about ${proCeiling.apiEquivalentUsdPerMonth.toLocaleString("en-US")} of API-equivalent usage ({proCeiling.impliedMultiple} times its price), and Claude Max 20x reached about ${maxCeiling.apiEquivalentUsdPerMonth.toLocaleString("en-US")} ({maxCeiling.impliedMultiple} times). The calculator defaults to the more conservative {anchor.defaultMultiple} times; the subsidy knob covers 10 to 100 times.
        </p>
        <p>
          The subsidy value converts to tokens at the selected GPT-5.6 Sol rates with the chosen input-to-output mix and cache-hit rate. Every other path then prices that same token volume. Hardware and rental paths convert the month&rsquo;s output tokens into an aggregate decode rate over the selected duty cycle, and size a fleet of whole units against each profile&rsquo;s single-stream decode figure.
        </p>
        <p>
          Owning hardware costs depreciation plus electricity. Depreciation is straight-line: the purchase price, less the resale-value knob&rsquo;s residual (default 0%), spreads evenly over the useful-life knob&rsquo;s months. Electricity multiplies each unit&rsquo;s rated power draw by the duty-cycle hours and the electricity knob&rsquo;s rate. The rate defaults to the EIA United States residential average and adjusts from {CALCULATOR_KNOB_BOUNDS.electricityCentsPerKwh.min}&cent; to {CALCULATOR_KNOB_BOUNDS.electricityCentsPerKwh.max}&cent; per kWh, a band that covers residential grid rates worldwide: <a href="https://www.globalpetrolprices.com/electricity_prices/" rel="noopener noreferrer">GlobalPetrolPrices</a> household averages for 2023 through Q2 2026 run from under 1&cent; in subsidized markets (Iran, Ethiopia) to about 47&cent; in Bermuda, and Hawaii&rsquo;s June 2026 average is 52.72&cent; (checked September 10, 2026). Use the presets or your utility bill&rsquo;s energy rate to set a local figure.
        </p>
        <h3>Sources</h3>
        <ul>
          <li>
            <a href={inputs.openAiApiPricing.source.url} rel="noopener noreferrer">{inputs.openAiApiPricing.source.name}</a>: {inputs.openAiApiPricing.modelName} at ${inputs.openAiApiPricing.current.inputPerMillion} input / ${inputs.openAiApiPricing.current.cachedInputPerMillion} cached input / ${inputs.openAiApiPricing.current.outputPerMillion} output per 1M tokens{inputs.openAiApiPricing.promoGuaranteedThrough === null ? "" : `, promotional through at least ${formatDate(inputs.openAiApiPricing.promoGuaranteedThrough)}`}. Retrieved {formatDate(inputs.openAiApiPricing.source.retrievedAt)}. List fallback ${inputs.openAiApiPricing.listFallback.inputPerMillion} / ${inputs.openAiApiPricing.listFallback.cachedInputPerMillion} / ${inputs.openAiApiPricing.listFallback.outputPerMillion} documented {formatDate(inputs.openAiApiPricing.listFallbackDocumentedOn)}.
          </li>
          <li>
            <a href={inputs.plan.sourceUrl} rel="noopener noreferrer">ChatGPT pricing</a>: {inputs.plan.name} at ${inputs.plan.monthlyPriceUsd} a month, as of {formatDate(inputs.plan.asOf)}.
          </li>
          <li>
            <a href={inputs.deepSeekApiPricing.source.url} rel="noopener noreferrer">{inputs.deepSeekApiPricing.source.name}</a>: {inputs.deepSeekApiPricing.modelVersion} (model id <code>{inputs.deepSeekApiPricing.modelId}</code>) at ${inputs.deepSeekApiPricing.offPeak.cacheHitInputPerMillion} cache hit / ${inputs.deepSeekApiPricing.offPeak.cacheMissInputPerMillion} cache miss / ${inputs.deepSeekApiPricing.offPeak.outputPerMillion} output per 1M tokens off-peak, double at peak. Peak hours are {inputs.deepSeekApiPricing.peakHoursUtc}. Retrieved {formatDate(inputs.deepSeekApiPricing.source.retrievedAt)}.
          </li>
          <li>
            <a href={inputs.electricity.source.url} rel="noopener noreferrer">{inputs.electricity.source.name}</a>: United States residential average of {inputs.electricity.usResidentialCentsPerKwh} cents per kWh for {formatMonth(inputs.electricity.period)}. Retrieved {formatDate(inputs.electricity.source.retrievedAt)}.
          </li>
          {inputs.electricity.residentialPresets.map(preset => (
            <li key={preset.id}>
              <a href={preset.sourceUrl} rel="noopener noreferrer">{preset.label} electricity preset</a>: {preset.centsPerKwh} cents per kWh. {preset.sourceName}. Checked {formatDate(preset.asOf)}.
            </li>
          ))}
          <li>
            <a href="https://vast.ai" rel="noopener noreferrer">{inputs.gpuRental.source.name}</a>: {inputs.gpuRental.methodology} Retrieved {formatDate(inputs.gpuRental.source.retrievedAt)}.
          </li>
          {inputs.hardware.gpus.map(gpu => (
            gpu.purchase === null ? null : (
              <li key={gpu.id}>
                <a href={gpu.purchase.sourceUrl} rel="noopener noreferrer">{gpu.purchase.sourceName}</a>: {gpu.name} at ${gpu.purchase.usd.toLocaleString("en-US")} ({gpu.purchase.kind === "msrp" ? "MSRP" : gpu.purchase.kind === "street" ? "street price" : "used market"}), as of {formatDate(gpu.purchase.asOf)}.
              </li>
            )
          ))}
          <li>
            Throughput profiles: <a href="https://www.lmsys.org/blog/2025-10-13-nvidia-dgx-spark/" rel="noopener noreferrer">LMSYS DGX Spark review</a> (October 13, 2025), <a href="https://www.lmsys.org/blog/2025-11-03-gpt-oss-on-nvidia-dgx-spark/" rel="noopener noreferrer">LMSYS GPT-OSS on DGX Spark</a> (November 3, 2025), and a <a href="https://spark.enverge.ai/blog/dgx-spark-prefill-vs-decode" rel="noopener noreferrer">memory-bandwidth decode method</a> for figures no published benchmark covers. Each profile is labeled measured, published band, or bandwidth estimate.
          </li>
          <li>
            <a href={anchor.secondarySourceUrl} rel="noopener noreferrer">{anchor.secondarySourceName}</a>, alongside the primary thread. Method last verified {formatDate(anchor.lastVerifiedOn)}: {anchor.reverificationNote}
          </li>
        </ul>
        <h3>Assumptions and limits</h3>
        <ul>
          <li>Open-weight models on the hardware and rental paths are not GPT-5.6 Sol. The comparison holds token volume constant, not capability.</li>
          <li>The SemiAnalysis figures are API-retail equivalents, not OpenAI&rsquo;s serving costs. OpenAI does not lose the full sticker gap on a maxed seat.</li>
          <li>Fleet sizing counts decode only. Prefill (input processing) is excluded, which flatters the local paths on input-heavy mixes.</li>
          <li>Throughput profiles are single-stream, order-of-magnitude figures. Batched serving raises aggregate throughput well beyond them.</li>
          <li>Depreciation assumes no residual value unless the resale-value knob sets one, and ignores financing, taxes, and disposal costs. Used-GPU prices vary too much to promise a recovery.</li>
          <li>Electricity assumes grid supply at one flat residential rate. There is no on-site solar or other self-generation, no time-of-use optimization, and no cooling overhead beyond the GPUs&rsquo; rated draw.</li>
          <li>Home hardware costs exclude the host system, cooling, networking, and failures; rental costs exclude storage, egress, and interruptions.</li>
          <li>Multi-agent workflows multiply token volume. The Ultra knob scales the implied volume up to 10 times.</li>
        </ul>
        <p>
          API rates, electricity, and rental prices come from a checked snapshot with a guarded automated refresh (<code>bun run calculator:refresh</code>). Hardware prices and the subsidy anchor change only through reviewed edits with dated citations.
        </p>
      </section>
      <ChartPageFooter />
    </main>
  </>;
}
