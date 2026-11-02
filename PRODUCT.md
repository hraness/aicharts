# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People choosing AI models or coding agents who need to compare published benchmark results, evaluation conditions, and costs.

## Product Purpose

aicharts plots published AI benchmark scores against cost and tokens per task. Each chart links its source data and methodology.

## Positioning

Compare results within a named benchmark and version. Show the model, provider, harness, effort, and reported cost or token basis behind each point. Keep separate benchmarks on their own scales and leave missing measurements unknown.

## Operating Context

The public website reads committed benchmark snapshots. Refresh scripts validate upstream data before a reviewed snapshot update; a request to the production site does not depend on a live upstream leaderboard. Visitors can browse charts, tables, model pages, benchmark explanations, and source data.

## Capabilities and Constraints

- Interactive charts compare benchmark scores with reported cost, tokens, or duration where the dataset supplies them.
- Benchmark pages distinguish charted results, source-only guides, and evaluations being watched for future coverage.
- Each result preserves its benchmark version, configuration, source, retrieval date, units, and available uncertainty.
- Sharing and image exports preserve the selected public benchmark view.
- Model comparisons, published analysis, and data downloads are public. Newsletter subscriptions are optional and separate from product use.
- Reported evaluation costs and calculator estimates do not establish a visitor’s bill or predict performance on their own tasks.

## Brand Commitments

The product is aicharts at aicharts.io. Extend its existing chart and publication design rather than introduce a separate brand.

## Evidence on Hand

Committed benchmark datasets, source links, retrieval metadata, import checks, comparison rules, and published methodology support the displayed results. Source-only guides have no invented measurements. Historical benchmark versions keep their original labels.

## Product Principles

1. Keep every comparison tied to its benchmark, version, and evaluation conditions.
2. Show coverage, freshness, and unknowns alongside the relevant results.
3. Preserve source-reported units, cost bases, and uncertainty.
4. Make public data available for readers and agents to inspect.

## Accessibility & Inclusion

Charts and tables must support keyboard, pointer, touch, and screen-reader use. Preserve visible focus, readable tabular numerals, narrow-screen chart panning, and meaningful empty and error states.
