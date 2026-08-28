# GPT subsidy ledger adapter

The GPT subsidy collector reads aggregate local Codex usage through a small adapter installed at `~/.local/bin/aicharts-gpt-subsidy-ledger`. The adapter emits token and API-equivalent cost totals. It never emits prompts, responses, repository paths, session IDs, account identifiers, or individual message rows.

## Install

Run the checked installer from the repository root:

```sh
./scripts/install-gpt-subsidy-ledger.sh
```

The installer checks out Tokscale 4.13.0 at commit `0149a44329fb89865837dde40adb8cd9bc06bead`, verifies the adapter, updater, and shared-contract source hashes against the measurement manifest, copies the checked adapter, [price manifest](https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-pricing.json), and measurement manifest into that checkout, and verifies both copied manifests byte for byte. Before Cargo runs, it removes only those installer-owned injected files from any interrupted prior run and rejects every other untracked or ignored path, including an injected `build.rs` or `.cargo/config.toml`. Each installation tests and compiles with the pinned lockfile in a fresh temporary Cargo target, warms Tokscale's incremental Codex source cache with that newly built candidate, and atomically replaces `~/.local/bin/aicharts-gpt-subsidy-ledger` only after the warmup succeeds. The pinned Tokscale checkout and source cache stay under `${XDG_DATA_HOME:-$HOME/.local/share}/aicharts/gpt-subsidy-ledger`; no Tokscale source or third-party price catalog is vendored into AI Charts.

The installer requires Git, Cargo, and the standard `install` utility. It always installs the production adapter at `~/.local/bin/aicharts-gpt-subsidy-ledger`, which is the updater's fixed executable path. Set `AICHARTS_GPT_SUBSIDY_INSTALL_ROOT` before running it only when the installer-owned source checkout, temporary build target, and installation warm-up cache must live elsewhere. Normal publisher runs unset `TOKSCALE_CONFIG_DIR`, so their persistent adapter cache follows `${XDG_DATA_HOME:-$HOME/.local/share}`; use `XDG_DATA_HOME` to relocate that production state.

## Contract

The executable accepts an inclusive history start and exclusive end as RFC 3339 timestamps:

```sh
~/.local/bin/aicharts-gpt-subsidy-ledger \
  2026-07-19T00:00:00.000Z \
  2026-08-25T00:00:00.000Z
```

The start must be a UTC day boundary. The range can contain at most 366 UTC days. Standard output contains one compact JSON value with this shape:

```json
{
  "schemaVersion": 1,
  "parser": {
    "name": "tokscale",
    "version": "4.13.0",
    "commit": "0149a44329fb89865837dde40adb8cd9bc06bead"
  },
  "deduplication": "tokscale-global-event-identity",
  "measurementBasis": {
    "kind": "aicharts-gpt-subsidy-measurement",
    "revision": "2026-08-25.2",
    "sha256": "64-lowercase-hex-characters",
    "frozenAt": "2026-08-25T00:00:00Z"
  },
  "range": {
    "startInclusive": "2026-07-19T00:00:00.000Z",
    "endExclusive": "2026-08-25T00:00:00.000Z"
  },
  "pricingCoverage": {
    "status": "complete",
    "modelIds": ["codex-auto-review", "gpt-5.6-sol"],
    "proxyModelIds": ["codex-auto-review"],
    "unpricedModelIds": [],
    "basis": {
      "kind": "aicharts-openai-rate-manifest",
      "sha256": "64-lowercase-hex-characters",
      "frozenAt": "2026-08-25T00:00:00Z"
    }
  },
  "days": [
    {
      "date": "2026-07-20",
      "complete": true,
      "tokens": {
        "uncachedInput": 0,
        "cachedInput": 0,
        "output": 0,
        "total": 0
      },
      "apiEquivalentUsd": 0
    }
  ]
}
```

Dates are contiguous UTC buckets, including zero-usage days. A midnight-exclusive end produces only complete days; only a partial final UTC day has `complete: false`. Token counts are exact JSON-safe integers and always satisfy `uncachedInput + cachedInput + output = total`. Tokscale cache-write tokens are priced separately and folded into the public uncached-input bucket. Tokscale separates reasoning from output internally; the adapter recombines reasoning into the public output bucket exactly once.

`apiEquivalentUsd` uses the checked AI Charts price manifest for every message. Official rows cite the corresponding OpenAI model page. GPT-5.6 cache writes use 1.25 times the uncached-input rate. GPT-5.4 and GPT-5.6 full requests above 272,000 combined input tokens use twice the input rates and 1.5 times the output rate. A nonzero cache-write bucket fails when the cited model page does not publish a cache-write price.

`codex-auto-review` is an internal alias without a published API price. The manifest labels it as a proxy for GPT-5.6 Luna, the lowest-priced published GPT-5.6 tier in this snapshot. The proxy source URL, rates, and long-context rule must exactly match the official Luna row. Successful output identifies it in `proxyModelIds`; it is never presented as an official rate.

The adapter fails without JSON output for an unknown model, non-OpenAI provider, missing token-bucket rate, invalid manifest, or proxy drift. `pricingCoverage.modelIds` and `proxyModelIds` are sorted, bounded audit lists. A successful result always reports `status: "complete"` and an empty `unpricedModelIds` array. `pricingCoverage.basis.sha256` hashes the exact checked manifest bytes embedded in the installed binary. The updater independently hashes the repository copy and compares both the hash and `frozenAt` before replacing retained observations.

Every retained observation is normalized to the price manifest frozen on August 25, 2026. Daily runs cannot fetch or mutate pricing and therefore cannot silently revalue prior observations. There is no in-place price refresh in v1. A new model or price basis requires a deliberate series or schema migration.

The installed adapter defaults `TOKSCALE_CONFIG_DIR` to its own `tokscale-config` directory for the incremental source-message cache. Tokscale's pricing service is never constructed. A `custom-pricing.json` in this dedicated profile is forbidden even though it cannot affect the embedded math. Set `TOKSCALE_CONFIG_DIR` explicitly only for isolated testing.

## Session and fork semantics

The adapter asks Tokscale for every local Codex session and archived session, then relies on Tokscale's global event identity deduplication. Root-session-only scans are not correct for this dataset because child agents make genuine model calls that are absent from the root transcript. Counting every file directly is also wrong because fork and subagent files replay inherited parent token snapshots.

Tokscale 4.13.0 handles both cases in its Codex parser. It skips a fork child's inherited cumulative baseline, scopes replay identities to the fork parent, and globally collapses equal cumulative-total identities across active and archived files while retaining the child's new totals. Its persistent source cache avoids reparsing unchanged files and incrementally extends growing rollouts. It still deserializes and materializes the full cached corpus, performs global deduplication, and only then applies the requested date range. At the current 1.35 million-message corpus, a warm daily collection takes about eight minutes rather than time proportional only to new work.

The output deliberately has no active-account or quota-window field. Local session files do not carry a durable account identity that can be joined safely to the currently signed-in ChatGPT Pro account, especially across account switches. Some raw events can contain transient rate-limit snapshots, but they vary by limit ID and reset time and are not a durable historical account ledger. The separate private account recorder now samples future quota windows through the read-only Codex app-server contract and binds them to private account fingerprints after an account-switch race check. It does not backfill historical session metadata or change this public adapter contract. The published series therefore does not claim that a weekly quota was exhausted or identify when it reset. Current remaining limits belong to the signed-in usage dashboard or Codex `/status`, as described in the [official Codex pricing documentation](https://learn.chatgpt.com/docs/pricing).

The v2 public snapshot publishes the measured API-retail-equivalent value of each trailing seven-day UTC window. It does not project that value into a month or divide it by a single plan price. Historical observations use `accountAttribution.status: "unavailable"`, zero coverage, a null observed-account count, and a null `subscriptionAdjustedMultiple`.

Future observations may report partial sampled account attribution after a separate account-change monitor has covered part of their window. An hourly sampler cannot prove complete coverage because an account can change and change back between samples; complete attribution would require a continuous event source. Account identity is not subscription evidence, so v2 keeps the adjusted multiple null even with complete account coverage. Publishing one would require a separate checked plan-price and billing-period contract. The public snapshot never publishes account identifiers.

For fixture or isolated-home verification, set `AICHARTS_GPT_SUBSIDY_HOME` to an absolute home directory containing `.codex/sessions` and `.codex/archived_sessions`. `TOKSCALE_CONFIG_DIR` can isolate Tokscale's persistent source-message cache. The adapter's integration fixture exercises this exact call path with a parent session, replayed child baseline, genuine child continuation, and an active/archive duplicate, then asserts the globally deduplicated token totals on both cold and warm-cache passes.
