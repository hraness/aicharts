# AI Charts search strategy

## Positioning

AI Charts is the umbrella product for sourced, interactive comparisons of AI models and agents. Each chart should make trade-offs visible across performance, cost, speed, token use, or another decision-relevant measure. The current coding-agent comparison is the first published chart.

The canonical public repository description is:

> Open-source AI benchmark charts for comparing models and agents across performance, cost, speed, and token use.

Do not describe AI Charts as a comprehensive catalog until the product has the data and routes to support that claim. Name the active vertical whenever copy discusses the current dataset, refresh process, or chart-specific result.

## Page roles

| Page | Role | Search intent | Copy contract |
| --- | --- | --- | --- |
| `/` | Product landing page and current comparison | AI model comparison, AI agent comparison, AI benchmark charts | Frame the general product in a server-rendered H1, then answer the current coding-agent snapshot with an H2 dated to `retrievedAt`, two to four sentences, and the current-leader HTML table before the interactive chart. |
| `/data` | Dataset, methodology, and provenance | AI coding agent benchmark data, benchmark methodology, machine-readable AI benchmark data | Describe the checked snapshot in visible HTML, name its upstream source and retrieval time, explain normalization and limits, and link the JSON distribution. |
| `/models` | Model-card collection | AI model benchmark cards, shareable model comparison | List every current model-and-profile card in static HTML with the source snapshot date and crawlable card links. |
| `/models/[creator]/[model]/[profile]` | Model profile card | Named AI model benchmark, cost, speed, and token use | Keep the stable canonical and Gateway identities distinct from the execution profile. Show observed ranges, source date, branded image, and method link. |
| `/blog` | Research collection | AI model benchmarks, AI agent benchmarks, benchmark analysis | Introduce the broader editorial method and state that the first collection focuses on coding agents. |
| `/blog/[slug]` | Evidence page | Named benchmark, method, result, limitation, or model question | Stay specific to the source. Preserve the benchmark name, observation date, configuration, limits, and primary citations. |

Future chart verticals need a distinct crawlable route, canonical URL, visible heading, source disclosure, and internal links from the product and relevant research. Do not publish several routes that answer the same intent with lightly varied copy.

## Query map

AI Charts targets three connected query groups:

1. Umbrella discovery: `AI model comparison`, `AI agent comparison`, `AI benchmark charts`, and `LLM comparison`.
2. Decision trade-offs: `AI model performance vs cost`, `AI model speed comparison`, `token use comparison`, and benchmark-specific cost or quality questions. The AA Index versus cost note answers that question for the current coding-agent snapshot with named configurations and the checked Artificial Analysis retrieval date. The open-models note answers whether classified open-weight rows sit with the current AA Index leaders. The scoreboard-versus-product note answers whether a SemiAnalysis catch-up composite is a reason to collapse those named rows into an open-won headline. The consumer-bill note answers whether a news-eval dollar chart is a reason to collapse those named rows into a cheap-won headline. The holdout note answers why a public-suite high score still needs hidden cases. The expertise note answers why that named-suite score still needs a person who can specify and audit the work.
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

## Answer-engine discovery

Answer-engine optimization is people-first technical SEO plus evidence that another system can inspect and cite. Google's AI search guidance says the same foundational Search requirements apply to AI features. OpenAI likewise requires its search crawler to be allowed before a site can appear in ChatGPT search. AI Charts therefore makes its useful content available in static or server-rendered HTML, uses descriptive headings and crawlable links, identifies primary sources, and publishes a machine-readable copy of the data behind the visible chart.

Do not add `llms.txt` as a search shortcut, keyword variant, or substitute for visible HTML. Google does not use it for Search. A truthful `/llms.txt` agent guide is allowed when it describes existing public pages and how to request Markdown. Do not split prose into artificial fragments, publish thin keyword variants, add unsupported structured-data types, or repeat a claim only to influence generated answers. Schema helps machines interpret content; it cannot replace content a visitor can see and verify.

The `/data` page is the citable boundary for the current coding-agent snapshot. It must show the dataset name, description, publisher role, upstream creator and source URL, retrieval time, covered metrics, normalization method, important limits, license or notice boundary, and a link to the JSON distribution. Any `Dataset` structured data must match that visible description. AI Charts is the publisher and visualizer of the normalized snapshot; it must not present itself as the creator of Artificial Analysis measurements.

These rules follow Google's [AI search optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), and [structured data](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) guidance, plus OpenAI's [publisher and developer FAQ](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq).

## Technical discovery contract

The repository tests and build must preserve:

- one canonical HTTPS URL for every indexable page;
- descriptive, page-specific titles and meta descriptions;
- homepage-owned identity, including explicit indexable robots, so 404 responses keep a distinct title, noindex, and no homepage canonical;
- crawlable HTML links between the chart, collection, and evidence pages;
- stable canonical routes for cataloged model cards, deterministic provisional routes for uncatalogued arrivals, profile-specific titles, downloadable branded images, and dedicated 1200×630 social previews;
- a sitemap containing every public canonical route and its social image;
- static or server-rendered primary content and provenance that do not depend on client JavaScript to become meaningful;
- `WebSite`, `WebApplication`, `Dataset`, `CollectionPage`, `BlogPosting`, and breadcrumb structured data only where the visible page supports those types;
- a truthful sitemap `lastmod` derived from the latest meaningful page, article, or checked-data change, never an unchanged poll, deployment, or request time;
- truthful Open Graph and X card copy that matches the page role;
- permanent redirects from retired `codingchart.com` routes to the matching `aicharts.io` routes;
- an allowed `OAI-SearchBot` user agent and no CDN rule that silently blocks it;
- a crawlable `/data` page and stable JSON distribution whose data and timestamps match the chart;
- static source and observation data so an upstream outage cannot remove indexable content.

These rules follow Google's guidance on [descriptive title links](https://developers.google.com/search/docs/appearance/title-link), [helpful people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), and [crawlable internal links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable).

## Search properties and site migration

Search Console setup is part of production ownership, not an optional launch task:

1. Add and verify Domain properties for `aicharts.io` and the retired `codingchart.com` domain with DNS TXT records. Keep both properties verified while the migration is being evaluated.
2. Confirm every old path resolves through a direct `301` redirect to the matching `https://aicharts.io` path. Search Console's Change of Address validator requires `301` specifically. Avoid redirect chains and do not redirect unrelated pages to the homepage.
3. Use Search Console's Change of Address tool for the move from `codingchart.com` to `aicharts.io` after both properties are verified and the redirects are live.
4. Submit `https://aicharts.io/sitemap.xml` in the new property. Keep the sitemap listed in `robots.txt`, inspect the homepage, `/data`, `/blog`, and each evidence page, then watch indexing and migration errors.
5. In the new property, confirm Settings → Search generative AI includes the site. Inclusion is the default, but the production owner must verify it rather than infer it from ordinary Search traffic. Review the Generative AI performance report when the property has enough impressions for Google to expose it.
6. Keep redirects, both domain registrations, and old-property verification in place for at least one year. Do not remove them merely because the new domain has begun receiving impressions.

Google documents [Domain properties and DNS verification](https://support.google.com/webmasters/answer/34592), the [Change of Address tool](https://support.google.com/webmasters/answer/9370220), [site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes), the [Search generative AI control](https://support.google.com/webmasters/answer/16908024), and the [Generative AI performance report](https://support.google.com/webmasters/answer/16984139).

Import the verified Search Console property into [Bing Webmaster Tools](https://www.bing.com/webmasters/help/import-sites-from-search-console-91fa6552) and submit the same sitemap. Use [IndexNow](https://www.indexnow.org/documentation) only when a canonical URL is added, removed, or changes materially. A successful daily check that produces no content change must not send IndexNow notifications or alter freshness metadata.

## Public repository discovery

The canonical source repository is `https://github.com/hraness/aicharts`. Keep its public metadata aligned with the product:

- description: `Open-source AI benchmark charts for comparing models and agents across performance, cost, speed, and token use.`;
- homepage: `https://aicharts.io`;
- focused topics that name the technology, data form, and current benchmark domain without exhausting GitHub's topic limit;
- a readable README that links the live chart, `/data`, `/blog`, source, notice, contribution, and security information;
- an MIT license for the software and a separate notice for third-party data and trademarks;
- a valid root `CITATION.cff` so GitHub exposes a consistent software citation.

The citation describes AI Charts software and visualization work. Claims based on the checked snapshot must also cite Artificial Analysis or the relevant primary benchmark source, with retrieval date, metrics, and configuration. GitHub documents repository discovery through [topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) and citation support through [`CITATION.cff`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-citation-files).

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
| `canonical_path` | `/`, `/data`, `/models`, `/models/[model]/[profile]`, `/blog`, `/blog/[article]`, `/gpt-subsidy`, `/[other]` |
| `page_kind` | `benchmark_chart`, `benchmark_data`, `model_cards`, `model_card`, `blog_index`, `blog_article`, `gpt_subsidy`, `other` |
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
- review Search Console indexing, sitemap, crawl, and migration errors for both domain properties;
- review Search Console generative-AI visibility when its report is available;
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
