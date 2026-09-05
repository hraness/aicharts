# Analytics instrumentation

AI Charts uses one small, typed PostHog boundary to measure acquisition and useful interaction without collecting visitor-entered content. This document is the implementation contract for agents and contributors. `lib/analytics.ts` is the event source of truth; `lib/page-analytics.ts` is the page-context and URL-normalization source of truth.

## Runtime boundary

`instrumentation-client.ts` initializes PostHog only in production on `aicharts.io` or `www.aicharts.io`, and only against the exact approved US or EU regional ingest origin. The SDK is cookieless, memory-only, person-profile-free, and has autocapture and session replay disabled. Automatic pageviews, page leaves, and bounded Web Vitals remain enabled.

Every browser event passes through `normalizedPageAnalyticsProperties` before it leaves the page. The normalizer:

- rewrites `$current_url`, `$pathname`, entry URLs, and previous-page fields to canonical grouped paths;
- rewrites `www.aicharts.io` entry URLs to the canonical `https://aicharts.io` origin;
- reduces referrers to origins and validates referring-domain fields, retaining acquisition domains without referrer paths;
- removes raw external-click URLs, query-derived campaign and click identifiers, query strings, and hashes;
- retains scalar Web Vitals values while dropping the SDK detail objects that duplicate navigation URLs;
- rejects client rate-limit warning events whose SDK-generated message contains a raw path;
- adds a bounded page classification and public `content_id`.

`context_schema_version` is `3`. It versions the page properties applied to all events. `event_schema_version` is `3` for the typed product events below and `1` for SDK-generated events such as `$pageview`, `$pageleave`, and Web Vitals. These fields are deliberately separate.

The server request-error hook uses the same exact ingest-host approval. It retains only a standard error type plus bounded framework route fields; original exception messages and stacks never leave the server.

| Public route | `canonical_path` | `content_id` |
| --- | --- | --- |
| `/` | `/` | `home` |
| `/blog` | `/blog` | `blog:index` |
| `/blog/{article}` | `/blog/[article]` | `blog:{article}` |
| `/data` | `/data` | `data:index` |
| `/models` | `/models` | `models:index` |
| `/models/{creator}/{model}/{profile}` | `/models/[creator]/[model]/[profile]` | `model-card:{creator}/{model}/{profile}` |
| any other route | `/[other]` | `other` |

Article and model-card identifiers must appear in the small client-safe public-route allowlists, which have drift tests against the publishing registries. Unknown but syntactically valid slugs still collapse to `other`. These are public content identifiers, not visitor or account identifiers.

## Event allowlist

All custom events are members of `AnalyticsEventMap`. `analyticsEventPayload` reconstructs each payload from allowed keys, validates its enums and identifiers at runtime, and drops excess runtime properties.

| Event | Controlled properties | Meaning |
| --- | --- | --- |
| `site link clicked` | `surface`, `link_kind`, `destination_kind`, `destination_id` | A public anchor was activated. |
| `newsletter signup request submitted` | `audience=aicharts`, `surface=global_footer` | The shared footer form emitted a submit request. |
| `content chart opened` | `source_kind`, `destination_chart` | A reader chose the current comparison from editorial content. |
| `chart metric selected` | `chart_id`, `axis`, `metric` | A visitor changed one dimension of a named chart. |
| `chart selection pinned` | `chart_id`, `provider_id`, `selection_kind` | A visitor pinned a provider or model comparison in a named chart. |
| `chart shared` | `chart_id`, `share_method`, `share_outcome`, `x_metric`, `y_metric` | A configured named-chart share action produced the stated outcome. |
| `model cards filtered` | `filter_dimension`, `filter_value`, `result_count` | A provider, Top, or New filter outcome was applied. |
| `model card shared` | `model_id`, `profile_id`, `share_method`, `share_outcome` | A canonical model-card share action produced the stated outcome. |

Filter dimensions are `provider`, `top_only`, and `sort`. Values are a checked provider ID or `all`, `enabled`/`disabled`, and `new`/`default`, respectively. Chart IDs are the bounded public surfaces `coding_agents` and `intelligence_efficiency`, so interaction funnels remain attributable without collecting labels or point text. Metric values stay native to each chart: the coding chart uses its checked X/Y vocabulary, while intelligence efficiency uses `costUsdPerTask` and `outputTokensPerTask` on its X axis. Chart and model-card share outcomes distinguish `initiated`, `completed`, `cancelled`, and `downloaded` where those states apply. Record only the outcome the component actually observes.

## Delegated link tracking

`AnalyticsBoundary` installs one capture-phase listener at the root, so server-rendered pages remain static and every semantic public `a[href]` is covered without per-link client code. It reads only:

- the closest controlled `data-analytics-surface`;
- the anchor destination needed for in-memory classification;
- the presence of `download`;
- controlled `data-analytics-destination-kind` and `data-analytics-destination-id` overrides;
- the existing controlled Ask-AI provider identifier.

The raw href, query, hash, and link text are never placed in an event. Link kinds are `anchor`, `download`, `internal`, and `outbound`. Destination kinds distinguish articles, model cards, site pages and resources, datasets, assets, sections, sources, repositories, social services, Ask-AI services, and Hraness. Unknown outbound hosts collapse to `destination_kind=source` and `destination_id=external:other`.

Use the narrowest existing surface. Current surfaces are `site`, `global_header`, `global_footer`, `home_orientation`, `home_portfolio`, `benchmark_chart`, `home_editorial`, `blog_header`, `blog_index`, `blog_article`, `blog_related`, `data_document`, `models_header`, `models_gallery`, `model_release_radar`, `model_card`, and `error_recovery`.

Add both destination override attributes only when the default URL classifier cannot supply a useful stable ID, normally for a named primary source:

```tsx
<a
  data-analytics-destination-id="source:terminal-bench"
  data-analytics-destination-kind="source"
  href={sourceUrl}
>
  Terminal-Bench
</a>
```

Invalid or mismatched override pairs are ignored. Do not add a custom click handler for an ordinary anchor.

## Newsletter state

The delegated footer event is intentionally named `newsletter signup request submitted`. It fires when the browser submits the shared Hraness footer form; it does not claim that Cloudflare accepted the proof, Hraness Accounts accepted the request, an email was sent, or the reader confirmed the subscription.

An accepted-request event must come from an explicit success callback in the shared footer or Accounts provider contract. A confirmed-subscription event must come from Hraness Accounts, where confirmation is authoritative. Do not infer either state by reading status text, observing DOM mutations, intercepting `fetch`, or scraping form data. The analytics boundary never reads the email field or Turnstile response.

## Adding measurement

1. Use a semantic anchor and an existing `data-analytics-surface` for navigation; delegated tracking is automatic.
2. For a non-navigation outcome, add the smallest controlled property shape to `AnalyticsEventMap` and validate every property in `controlledEventProperties`.
3. Capture through `captureAnalyticsEvent` or the existing narrow wrapper. Never import `posthog-js` or call `posthog.capture` from a feature component.
4. Prefer completion outcomes to intent when the browser exposes them. Do not instrument hover, cosmetic controls, or events without a product question.
5. Add pure classification and privacy tests. If a new source file imports PostHog directly, the import-guard test must fail.

Do not send raw URLs, query strings, hashes, referrer paths, link text, email addresses, Turnstile values, errors, free-form search or form text, visitor identities, or persistent identifiers. Public bounded article, provider, model, profile, benchmark, and source IDs are allowed.

Run the focused contract checks with:

```sh
bun test lib/analytics.test.ts lib/page-analytics.test.ts lib/analytics-imports.test.ts components/analytics-boundary.test.tsx instrumentation-client.test.ts app/layout.test.ts
bun run typecheck
```
