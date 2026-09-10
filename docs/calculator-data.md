# Calculator data sources and refresh

The `/calculator` page prices one implied monthly token volume five ways. Its inputs live in the checked snapshot `data/calculator-inputs.json`, parsed fail-closed by `lib/calculator-inputs-data.ts` and served to the page through `lib/calculator-inputs-collection.ts`. The cost model itself is pure math in `lib/calculator-math.ts` with golden-number and property tests.

## Live sections

`bun run calculator:refresh` (`scripts/refresh-calculator-inputs.ts`) refreshes four sections from their authoritative sources and fails closed on any parse error, thin market, or out-of-bounds movement:

| Section | Source | Method |
| --- | --- | --- |
| `openAiApiPricing.current` | [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) | First `gpt-5.6-sol` standard-table row in the serialized page payload, plus the promotional-guarantee prose. Absent promo prose flips `currentBasis` to `list`. |
| `deepSeekApiPricing` | [DeepSeek pricing docs](https://api-docs.deepseek.com/quick_start/pricing) | First pricing column (`deepseek-flash`) of the server-rendered table. The schema enforces the published off-peak-is-half-of-peak policy, and a changed peak-hour sentence fails the refresh for review. |
| `electricity` | [EIA Electric Power Monthly, Table 5.6.A](https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a) | U.S. Total residential average and its reporting month. |
| `gpuRental` | [Vast.ai bundles API](https://console.vast.ai/api/v0/bundles/) | Median hourly ask of the cheapest verified single-GPU on-demand offers, up to 20 per SKU, minimum three offers. |

Guards in `validateCalculatorInputsReplacement` reject any live rate that moves more than 8x in either direction, rental SKUs that appear or disappear, and any automated edit to a curated section. The scheduled `data-refresh.yml` workflow runs the refresh on the four-hour benchmarks lane, restores timestamp-only diffs, and publishes material changes through the required-CI pull-request gate like every other owned snapshot.

## Curated sections

Hardware purchase prices, throughput profiles, the plan price, the OpenAI list-fallback rates, and the SemiAnalysis subsidy anchor are reviewed edits with dated citations in the snapshot. Each throughput profile is labeled `measured`, `published-band`, or `bandwidth-estimate` and carries its source URL and observation date. TODO: automate an MSRP/street-price feed and a decode-benchmark feed; until then, update these values by editing the snapshot and letting `bun run calculator:check` and the schema guards validate the result.

The subsidy anchor records the SemiAnalysis June 2026 stress-test method, its published ceilings (ChatGPT Pro 20x about $14,000, Claude Max 20x about $8,000), and a `lastVerifiedOn` date. When re-verifying, search for a newer public re-run of the stress test and update `reverificationNote` with what was found.

## Validation

`bun run calculator:check` validates the committed snapshot offline and is part of `check:generated`. Narrow tests: `bun test lib/calculator-inputs-data.test.ts lib/calculator-math.test.ts lib/calculator-math.property.test.ts scripts/refresh-calculator-inputs.test.ts`.
