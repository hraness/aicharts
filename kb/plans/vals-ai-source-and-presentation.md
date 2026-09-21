---
title: Admit Vals AI as a source and adopt its page grammar
description: Import Vals AI benchmark results as a separate independent-evaluator evidence class, and restructure benchmark pages around the motivation, results, takeaways, methodology, and updates pattern Vals uses.
type: plan
area: benchmarks
status: in-progress
repository_scopes:
  - data
  - lib
  - scripts
  - app/benchmarks
  - app/globals.css
  - docs/benchmark-sourcing-protocol.md
tags:
  - sourcing
  - presentation
---

# Admit Vals AI as a source and adopt its page grammar

## Outcome

AI Charts carries [Vals AI](https://www.vals.ai) results as a labeled
independent-evaluator evidence class, covering professional-domain work the
current portfolio does not measure at all, and each benchmark page reads as a
sourced argument rather than a control panel with a chart in it.

## Context

The current portfolio measures coding, reasoning, research, memory, images,
video, audio, and world models. It contains no finance, legal, medical, tax, or
education evaluation. Vals runs 47 benchmarks, of which roughly half are
private professional-domain tests it owns outright (Finance Agent v2, Excel
Modeling Benchmark, Legal Research Bench, HLAB, CorpFin v2, Tax Agent Bench,
MedCode, MedScribe, Public Benefits Bench, ProofBench, Vibe Code Bench, Code
Migration). That is the gap, and no other public aggregator fills it.

Vals is also a re-runner of public benchmarks the site already charts from
their owners (SWE-bench Verified, GPQA Diamond, MMLU Pro, AIME, LiveCodeBench,
IOI, Terminal-Bench 2.0, 2.1, 4.0, Terminal-Bench Science). Those results are a
different system from the owner leaderboards and must never share a series with
them.

### Payload shape

Benchmark pages are server-rendered Astro. Each page inlines its full dataset
in the `props` attribute of the `astro-island` whose `component-url` matches
`BenchmarkView`, using Astro's `[type, value]` serialization. A decoded
`/benchmarks/vals_index` payload gives:

- `metadata`: `benchmark`, `slug`, `benchmark_id`, `family`, `version`,
  `updated`, `dataset_type` (`private` or public), `industry`, `runner`,
  `mode`, `archived`, `total_models`, and a `tasks` map of component
  benchmark ids to display names.
- `tasks[taskId][modelId]`: `accuracy`, `stderr`, `latency`, `cost_per_test`,
  `token_totals` (`input_tokens`, `output_tokens`, `reasoning_tokens`,
  `cache_read_tokens`, `cache_write_tokens`), `temperature`, `top_p`,
  `max_output_tokens`, `reasoning`, `reasoning_effort`, `verbosity`,
  `compute_effort`, `provider`, and `harness`.

Field coverage on the Vals Index page is 59 models across eight task columns,
with accuracy, standard error, and latency on every row and cost on 58 of 59.
Model ids are already namespaced (`anthropic/claude-opus-5`), which makes
joining to the model card catalog tractable.

`https://www.vals.ai/sitemap.xml` carries a per-slug `lastmod`, so change
detection costs one request.

This extraction is the same shape as the existing Artificial Analysis importer,
which reads an embedded page payload and cross-checks it against published
JSON-LD. `robots.txt` is `User-agent: * / Allow: /`.

## Scope

### In scope

- A `vals-ai` source module, schema, refresh script, and committed snapshot.
- A new `independent-evaluator` evidence class in the sourcing protocol.
- Atlas entries for admitted Vals benchmarks, each with its own comparison rule.
- A benchmark page template with motivation, results, takeaways, methodology,
  and updates sections.
- Tabular numerals, per-category theming, and a provenance header row.

### Non-goals

- Merging any Vals re-run of a public benchmark into that benchmark's owner
  series.
- Building an AI Charts composite from Vals component scores. The Vals Index is
  the publisher's composite and is charted as such or not at all.
- Importing Application Reports, Vals Smith, or Government pages.
- Replacing the warm paper palette or dropping dark mode.

## Constraints and decisions

1. **Evidence class.** Vals owns its private benchmarks, so those rows are
   owner-published. Its public-benchmark re-runs are neither owner-published nor
   vendor-reported. Add `independent-evaluator` to the evidence classes, and
   require every such row to name the evaluator, the harness, and the run count.
2. **Never merge re-runs.** Vals publishes Terminal-Bench 4.0 and
   Terminal-Bench Science results. The site already carries Harbor's owner
   snapshots for both. They stay in separate series with separate comparison
   rules, the same boundary the protocol already draws between Terminal-Bench
   2.1 and 4.0.
3. **Licensing is an open gate.** Vals publishes no data license and describes
   its test sets as proprietary. `robots.txt` permits crawling and the payload
   is public, but that is not a redistribution grant. Email `contact@vals.ai`
   for written permission or an API before the first snapshot ships. Attribute
   and link every row to its source page regardless of the answer. This is the
   one item that needs the owner and cannot be resolved in the repository.
4. **Pin the version.** `metadata.version` and `metadata.updated` are
   published per benchmark, and the Vals Index changelog shows components being
   swapped in and out across v1 and v2. Pin `family` plus `version`, and treat a
   version bump as a new admission rather than a refresh, matching the
   Intelligence Index v4.1.1 and v4.3 precedent.
5. **Composite transparency.** If the Vals Index is admitted, carry its GDP
   weights, its formula, and its Code Migration subset caveat as displayed
   limitations. The index scores a 60-task subset of the 120-task Code
   Migration run, which is a real limitation a reader has to see.
6. **Keep dark mode.** Vals forces light. Every token adopted here has to
   resolve in both themes.

## Presentation findings

What Vals does that is worth taking:

1. **The benchmark page is an article.** Its heading order is Motivation,
   Results, Key Takeaways, Methodology, Updates. The chart sits inside prose
   that states why the benchmark exists before showing who wins. AI Charts
   splits that material across an explorer, `/data`, and `/blog`, so a reader
   landing on a chart gets numbers with no argument around them.
2. **Key Takeaways names leaders and numbers in sentences.** "GPT-5.6 Luna
   reaches 59.88% at $0.77 per test, 6.2 points behind the fourth-place model at
   less than a twentieth of its cost." The site already holds every value needed
   to generate that line deterministically from the snapshot.
3. **A per-benchmark methodology changelog.** Dated entries record exactly what
   changed and why, including removals ("Removed SWE-Bench Verified from the
   coding bucket. SWE-Bench has become saturated."). The sourcing protocol
   already governs this discipline internally; it is not shown to readers.
4. **Provenance sits in the hero.** Classification badge, updated date, version
   number, and model count appear beside the title before any control.
5. **Cost is a peer of accuracy, not a table column.** The chart header is a
   two-state toggle between accuracy and cost.
6. **A sane default cohort.** "Showing latest, top and frontier models (22)"
   with provider chips to widen it, instead of every row at once.
7. **Numbers are set in mono with tabular figures.** The type system is Söhne,
   Martina Plantijn, and Berkeley Mono. The site currently falls back to a
   generic system mono stack.
8. **Per-category theming.** `--theme-50` through `--theme-950` ramps in muted
   blue, green, olive, red, and neutral are redefined per section, so each
   benchmark family carries a quiet identity without rainbow charts.
9. **A version selector as a first-class control**, rather than a second URL.

What not to copy: the forced light theme, the absence of shareable view state,
PNG export, a machine-readable distribution, and per-row uncertainty display in
the table. Those are existing AI Charts advantages.

## Work

Dependency ordered.

1. Send the licensing request to `contact@vals.ai`. Record the reply in this
   plan. Steps 2 through 5 can proceed in parallel; step 6 blocks on the reply.
2. Add `independent-evaluator` to `docs/benchmark-sourcing-protocol.md` with
   its display rule and its prohibition on sharing a series with owner data.
3. Write `lib/vals-ai-data.ts`: the snapshot schema, the island decoder, the
   version pin, and the parse and validate pair, following the Artificial
   Analysis module layout.
4. Write `scripts/refresh-vals-ai.ts` with fixtures, sitemap-driven change
   detection, and a replacement validator that rejects a version bump.
5. Admit the first cohort and commit `data/vals-ai.json`. Proposed order:
   Vals Index, Finance Agent v2, Legal Research Bench, MedCode, and Tax Agent
   Bench. Each gets an atlas entry with its own question, measure, comparison
   rule, and limitations.
6. Ship the pages once licensing clears.
7. Presentation, independently shippable: benchmark page template, generated
   takeaways, per-benchmark changelog surface, hero provenance row, tabular
   numerals, per-category theme ramps, and a default cohort filter.

## Execution log

### 2026-09-21 · importer admitted

Steps 2 through 5 are built on `claude/vals-ai-source`. Step 1 (the licensing
request to `contact@vals.ai`) is still open and is the only owner item; Ben
chose to ship the import attributed rather than hold it behind that reply.

Decisions taken during execution:

- **The evidence-class boundary is a schema literal, not a review step.** Vals
  marks each board `private` or `public`, and `public` means Vals re-ran
  someone else's benchmark. `lib/benchmark-atlas-vals-data.ts` pins
  `z.literal("private")`, and the importer refuses a flipped board with the
  reason in the error. A Vals re-run of Terminal-Bench or SWE-bench cannot
  reach a chart even if someone adds its slug to the admitted list.
- **Identifiers are carried verbatim.** Vals publishes model ids, not product
  names, and its display names are not in the page payload. Prettifying
  `meta/muse_spark_1_3_max` would mean inventing a name, so the id is the
  label and the published provider is shown beside it.
- **Cost follows the publisher's own flag.** MedCode sets
  `use_cost_per_test: false` while still carrying numbers in its payload. Those
  numbers are dropped and the board gets no cost axis.
- **The full published board is imported, not an editorial selection.** Unlike
  the ARC and research cohorts, each Vals board is already the complete set for
  that benchmark, and `total_models` is cross-checked against the row count.

Deviation from the plan: no new benchmark page template was built. The existing
atlas catalog already drives `/benchmarks`, `/data`, the per-cohort JSON
downloads, and the Markdown representations, so the five boards reached every
surface without new routes. The presentation work in step 7 stays open.

Evidence: `bun run check` exits 0 on 34fb68e plus this branch, covering 1,673
tests, the generated-snapshot checks, the full build, and the browser contract
suite. `bun run atlas:vals:check` reports 299 observations across five private
boards. All five `/data/benchmark-atlas/vals-*` downloads prerender.

### 2026-09-21 · page grammar adopted

Step 7 on `claude/benchmark-page-grammar`, shipped as a separate change from the
import. The explorer now reads motivation, results, takeaways, caveats, source,
which is the order Vals uses, instead of controls followed by bars.

- **Generated takeaways.** `lib/benchmark-atlas-takeaways.ts` derives two to
  four sentences from the checked snapshot: the leader and runner-up, whether
  their uncertainty ranges separate them, the cheapest result within five points
  of the leader, and the cohort span. A refresh moves the prose with the data.
  The separation sentence is a claim Vals does not make and the repository's own
  uncertainty handling already supports.
- **Rules, not judgments.** Each sentence states the rule it applied. The cost
  sentence is suppressed on relative units, where "within five points" would be
  an invented claim, and when the leader is already cheapest. The interval type
  is named in the caption and inspector rather than inlined, because source
  labels do not read as sentence fragments.
- **Provenance as labelled facts.** The run-on `.atlas-context` caption became a
  definition list of evidence class, version, source date, and configuration
  count, with `<time>` on the date.
- **Motivation above the fold.** `entry.summary` and `entry.measure` moved out
  of the bottom disclosure to a lead paragraph above the toolbar.
- **Per-family accents.** `data-atlas-category` on the explorer selects one of
  five muted accent ramps through the existing `--atlas-accent`, `--atlas-tint`,
  and `--atlas-bar` tokens. Every value clears AA in both themes; the lowest is
  6.46:1.
- **Tabular numerals** on ranks, scores, provenance values, scatter axes, and
  the takeaway prose.

Deviation: the per-benchmark methodology changelog is still not built. It needs
authored dated entries for 29 datasets and no existing field carries them, so it
stays open rather than being filled with invented history.

Evidence: `bun run check` exits 0. 21 new tests cover the takeaway sentences,
seven properties over generated cohorts, and the page order. Screenshots in both
themes confirmed the layout and the accent families.

## Verification

- Importer fixtures cover a full page, a missing cost field, an archived
  benchmark, and a changed version.
- A test asserts no chart series mixes a Vals re-run with an owner snapshot of
  the same benchmark.
- A test asserts every Vals row renders its evaluator, harness, and source link.
- Generated takeaway sentences are property-tested against the snapshot so no
  rank or delta can drift from the data.
- Both themes pass the existing contrast checks with the new theme ramps.

## Recovery

Each Vals benchmark is a separate atlas entry over one committed snapshot, so
withdrawing the source is a data file removal plus its entries. Nothing in the
existing portfolio depends on it.
