# AI Charts search strategy

## Positioning

AI Charts is the umbrella product for sourced, interactive comparisons of AI models and agents. Each chart should make trade-offs visible across performance, cost, speed, token use, or another decision-relevant measure. The current coding-agent comparison is the first published chart.

The canonical public repository description is:

> Open-source AI benchmark charts for comparing models and agents across performance, cost, speed, and token use.

Do not describe AI Charts as a comprehensive catalog until the product has the data and routes to support that claim. Name the active vertical whenever copy discusses the current dataset, refresh process, or chart-specific result.

## Page roles

| Page | Role | Search intent | Copy contract |
| --- | --- | --- | --- |
| `/` | Product landing page and current comparison | AI model comparison, AI agent comparison, AI benchmark charts | Frame the general product, then make the current coding-agent dataset clear through chart labels, sources, and context. |
| `/blog` | Research collection | AI model benchmarks, AI agent benchmarks, benchmark analysis | Introduce the broader editorial method and state that the first collection focuses on coding agents. |
| `/blog/[slug]` | Evidence page | Named benchmark, method, result, limitation, or model question | Stay specific to the source. Preserve the benchmark name, observation date, configuration, limits, and primary citations. |

Future chart verticals need a distinct crawlable route, canonical URL, visible heading, source disclosure, and internal links from the product and relevant research. Do not publish several routes that answer the same intent with lightly varied copy.

## Query map

AI Charts targets three connected query groups:

1. Umbrella discovery: `AI model comparison`, `AI agent comparison`, `AI benchmark charts`, and `LLM comparison`.
2. Decision trade-offs: `AI model performance vs cost`, `AI model speed comparison`, `token use comparison`, and benchmark-specific cost or quality questions.
3. Evidence: exact benchmark and methodology searches such as MirrorCode, SlopCodeBench, SWE-bench, Terminal-Bench, and questions about what a result does or does not establish.

The product and collection pages carry umbrella language. Chart pages and research articles earn narrower searches through original visualization, primary sources, reported configurations, dates, and explicit limits. Exact benchmark names must not be replaced with generic keyword variants.

## Editorial standard

Every indexable research page must:

- answer one identifiable search intent in its title, heading, introduction, and body;
- cite the paper or maintained primary source for material claims;
- distinguish reported facts from AI Charts analysis;
- attach observation dates and named configurations to changing results;
- keep limitations near the claims they qualify;
- add a useful internal link to the relevant chart and related evidence;
- provide analysis or presentation that is meaningfully more useful than repeating a source abstract.

Update a page when its underlying result changes materially. Do not change a publication date to simulate freshness. Remove or consolidate a page when it no longer provides a distinct answer.

## Technical discovery contract

The repository tests and build must preserve:

- one canonical HTTPS URL for every indexable page;
- descriptive, page-specific titles and meta descriptions;
- crawlable HTML links between the chart, collection, and evidence pages;
- a sitemap containing every public canonical route and its social image;
- `WebSite`, `WebApplication`, `CollectionPage`, `BlogPosting`, and breadcrumb structured data only where the page supports those types;
- truthful Open Graph and X card copy that matches the page role;
- permanent redirects from retired `codingchart.com` routes to the matching `aicharts.io` routes;
- static source and observation data so an upstream outage cannot remove indexable content.

These rules follow Google's guidance on [descriptive title links](https://developers.google.com/search/docs/appearance/title-link), [helpful people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), and [crawlable internal links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable).

## Measurement

Search Console and PostHog answer different parts of the search funnel.

Search Console is authoritative before arrival:

- impressions and clicks by query, page, country, and device;
- click-through rate;
- average search position;
- indexing and sitemap health.

PostHog is authoritative after arrival:

- pageviews by `traffic_channel`, `$search_engine`, and controlled `canonical_path`;
- visits to the chart and research collection;
- content-to-chart navigation;
- chart metric selections and pinned comparisons;
- Core Web Vitals captured by the browser SDK.

Google documents why [Search Console and analytics measure different systems](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console). Query and ranking conclusions must therefore come from Search Console, not referrer data alone.

The pinned [AI Charts: Search & Content dashboard](https://us.posthog.com/project/543694/dashboard/1995999) contains weekly acquisition channels, organic search engines, landing pages, and qualified chart interactions over a rolling 90 days. Add `content chart opened` to that dashboard only after the first production event verifies its live schema.

### Controlled page properties

`instrumentation-client.ts` adds these bounded values to every production event:

| Property | Allowed values |
| --- | --- |
| `site_id` | `aicharts` |
| `canonical_domain` | `aicharts.io` |
| `analytics_schema_version` | `2` |
| `canonical_path` | `/`, `/blog`, `/blog/[article]`, `/[other]` |
| `page_kind` | `benchmark_chart`, `blog_index`, `blog_article`, `other` |
| `content_group` | `ai_comparison`, `benchmark_research`, `site` |

The grouped article path deliberately avoids sending slugs, URLs, query strings, free-form text, identities, or persistent identifiers.

### Product events

| Event | Controlled properties | Qualified behavior |
| --- | --- | --- |
| `content chart opened` | `source_kind`, `destination_chart` | A reader chooses to move from research into the current comparison. |
| `chart metric selected` | `axis`, `metric` | A visitor changes a comparison dimension. |
| `chart selection pinned` | `provider_id`, `selection_kind` | A visitor focuses a model or provider for closer comparison. |
| `chart shared` | `share_method`, `x_metric`, `y_metric` | A visitor exports or shares a configured chart. |

PostHog remains cookieless, memory-only, and person-profile-free. The implementation follows PostHog's guidance for [custom events](https://posthog.com/docs/libraries/js/usage) and uses `before_send` only to add controlled first-party context without removing required internal properties.

## Baseline

The 30-day window from July 15 through August 14, 2026 UTC contained 31 pageviews: 25 direct, 5 organic search, and 1 internal. The organic visits reported Bing for 4 pageviews and Google for 1. The only observed canonical paths were `/` with 25 pageviews and `/blog` with 6. Visitors recorded 7 metric selections and 5 pinned comparisons.

This is a continuity baseline, not evidence that the broader positioning is working. The sample is small, and its page events still carry the predecessor `codingchart.com` canonical-domain value. The first useful AI Charts measurement checkpoint begins when production events report `canonical_domain = aicharts.io` and `site_id = aicharts`.

## Review cadence

Weekly:

- confirm current `aicharts.io` events reach all four dashboard views;
- investigate broken page classification, missing events, bot spikes, or sudden zeroes;
- annotate releases that materially change a title, route, chart, or article.

Monthly, compare the latest 28 complete days with the preceding 28:

- review Search Console queries, pages, clicks, impressions, click-through rate, and position;
- review PostHog acquisition, landing-page breadth, content-to-chart navigation, chart engagement, and Web Vitals;
- identify one page with rising impressions but weak click-through rate, or useful traffic with weak chart engagement;
- change copy or content only when the query and on-site evidence support the same diagnosis.

Quarterly:

- verify that product positioning still matches published chart coverage;
- consolidate pages with overlapping intent;
- choose the next chart or research page from recurring decision questions and available primary data.

At the current volume, success is directional. Broader positioning is working when general model or agent comparison queries begin earning impressions and clicks, organic entry expands beyond the homepage, and qualified chart interaction does not deteriorate. Do not set percentage growth targets until the property has a stable multi-month baseline.
