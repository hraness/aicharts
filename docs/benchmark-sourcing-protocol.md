# Benchmark and release sourcing protocol

## Decision

AI Charts uses separate, versioned chart families. It does not add unrelated
benchmark observations as nullable columns on the Artificial Analysis coding
agent rows, and it never relabels an older benchmark score as a newer exam.

The homepage benchmark set stays small enough to explain in one view:

| Role | Current standard | Exact release boundary | Primary source | Display rule |
| --- | --- | --- | --- | --- |
| Agentic terminal engineering | Terminal-Bench 4.0 | `terminal-bench/terminal-bench@4.0.0` | [Terminal-Bench](https://www.tbench.ai/news/terminal-bench-4-0) | Primary coding benchmark. The overview shows model, agent, effort, trials, score, uncertainty, and cost; JSON retains tokens and duration. |
| Scientific workflows | Terminal-Bench-Science 0.1 | `terminal-bench-science/terminal-bench-science@0.1.0` | [Terminal-Bench-Science v0.1.0](https://github.com/harbor-framework/terminal-bench-science/releases/tag/v0.1.0) | Keep separate from general terminal engineering. |
| Professional knowledge work | GDPval-AA v2 | Exact live observation and evaluator pool | [Artificial Analysis](https://artificialanalysis.ai/evaluations/gdpval-aa) | Store Elo, observation date, and interval. Never format Elo as a percentage. |
| Computer use | OSWorld 2.0 | `osworld-v2-2026.08.08` | [Pinned OSWorld release manifest](https://github.com/xlang-ai/OSWorld-V2/blob/v2026.08.08/benchmark_releases/osworld-v2-2026.08.08.json) | Pin code, tasks, assets, website, and provider image together. Keep binary completion and partial reward separate. |
| Broad expert reasoning | Humanity's Last Exam | `cais/hle@5a81a4c7271a2a2a312b9a690f0c2fde837e4c29` | [Pinned classic HLE dataset revision](https://huggingface.co/datasets/cais/hle/tree/5a81a4c7271a2a2a312b9a690f0c2fde837e4c29) | Pin modality, judge protocol, and tools mode. Never mix classic HLE and HLE-Rolling. |

The checked Terminal-Bench 4 schema pins the owner-published eight-hour agent
timeout, rejects any submission containing disqualified trials, and records
unpublished action, token, tools, seed, retry, and agent-count fields as null.
Its source-reported confidence interval and cost retain an explicit
"method/basis unspecified" qualifier.

The checked Terminal-Bench-Science schema pins the exact 0.1.0 release and
Harbor dataset version, retains all five owner-published domain breakdowns,
and identifies unavailable model-version, harness-version, safeguard, limit,
tools, seed, retry, and error-treatment fields as null. Its binomial standard error and
aggregate evaluation cost retain explicit source-method qualifiers. The owner
payload currently contains configurations whose aggregate cost differs from
the sum of its domain cost fields, so AI Charts preserves both without
inventing a reconciliation.

[CursorBench 3.2](https://cursor.com/cursorbench) is supplemental evidence for
real repository editing. Its tasks are private, and its scores measure the
model inside Cursor's production agent harness. It must carry a `closed`
method label and must not enter a composite score.

The Artificial Analysis Coding Agent Index, DeepSWE, SWE-Atlas-QnA, and
Terminal-Bench 2.1 remain available as source-specific detail and history.
They are not the homepage standards. Terminal-Bench 2.1 and 4.0 must never
share a comparison series. AutomationBench remains on the watchlist because
its cross-application workflow signal overlaps the selected professional-work
and computer-use axes.

## Cross-release comparison rule

Anthropic's [Fable 5.1 and Mythos 5.1 release](https://www.anthropic.com/claude-fable-and-mythos-5-1)
reports Terminal-Bench 4, Terminal-Bench-Science 0.1, and CursorBench 3.2
results. Those rows remain `vendor-reported` until the benchmark owner
publishes the matching system configuration. The trusted-access Mythos result
also remains a separate safeguarded-system observation even though Anthropic
describes Fable and Mythos as the same underlying model.

OpenAI's [GPT-5.6 release](https://openai.com/index/gpt-5-6/) reports
Terminal-Bench 2.1 because it predates the selected 4.0 owner leaderboard. AI
Charts does not compare that launch score with TB4. The current owner-published
TB4 and Terminal-Bench-Science snapshots already contain GPT-5.6 Sol in Codex,
which provides the consistent comparison boundary. OpenAI's earlier OSWorld
result and Anthropic's August 2026 OSWorld task release also stay separate
because their task files differ.

## Considered structures

| Structure | Source fidelity | Migration risk | Reader clarity | Decision |
| --- | --- | --- | --- | --- |
| Rename the current Terminal-Bench 2.1 field to 4.0 | Fails | Very high | Misleading | Rejected. The scores come from different exams. |
| Add every benchmark as a nullable field on each coding-agent row | Weak | High | Low | Rejected. Sources use different models, harnesses, efforts, and trial counts. |
| Replace the current Artificial Analysis snapshot | Loses useful cost, time, and token observations | High | Medium | Rejected. The source-specific chart still answers a distinct trade-off question. |
| Keep separate checked datasets behind a shared benchmark registry | Strong | Low | High | Chosen. Each family owns its schema, version, source, and presentation. |

## Release discovery layers

Release discovery and benchmark publication are different operations:

1. **First-party candidate discovery** checks configured provider-owned
   announcement sources. It retains every model parsed from a multi-model
   release URL, including a restricted model that no aggregator lists, and
   sends unknown announcement-like URL shapes to review. A candidate records the
   provider, canonical announcement URL, sitemap last-modified candidate date,
   model names parsed from recognized canonical URL patterns,
   source freshness, and its review state.
2. **Identity discovery** uses OpenRouter to learn available model identities
   and capability metadata. OpenRouter timestamps are discovery metadata, not
   official release dates.
3. **Reviewed release dates** promote a matched candidate only after a person
   or review agent confirms the model identity and provider-owned source. The
   first-party watcher never writes the official-date ledger automatically.
   For unknown Anthropic URL shapes, the queue requires a version numeral;
   reviewed irregular launches use exact route mappings. Product-only packages,
   integrations, regional availability, programs, and policy announcements are
   dispositioned as non-releases unless the primary source also introduces a
   distinct underlying model.
4. **Benchmark observations** use a benchmark owner export when one exists.
   Vendor-reported results stay in a separate evidence class and name the
   vendor harness and protocol.

This separation prevents an aggregator omission from hiding a release without
letting an ambiguous announcement silently alter public model history.

## Observation envelope

Each source schema documents a bounded observation envelope. It preserves the
comparison and provenance fields selected below and explicitly documents fields
the source withholds; no missing protocol value is inferred. Raw trial IDs and
source presentation metadata need not be copied into the checked snapshot when
an immutable source URL remains available:

- benchmark family, display version, exact package or release tag, task split,
  and score unit;
- exact model snapshot, provider, safeguard mode, reasoning effort, agent or
  harness, and harness version;
- tools mode, agent count, token or action limit, time limit, trial count,
  seeds when published, retries, and error treatment;
- point estimate, uncertainty method and interval, cost basis, token use, and
  duration when available;
- source class (`benchmark-owner` or `vendor-reported`), source URL,
  observation date, retrieval time, and immutable source revision when one is
  available.

Missing values remain missing. They never become zero. System configurations
that use the same base model but different safeguards, agents, or effort stay
as separate observations.

## Version and refresh rules

- A benchmark major-version change creates a new chart family or explicit
  historical facet. It requires fresh runs.
- A minor-version change follows the benchmark owner's compatibility policy.
  When that policy requires regrading, the results remain separate until the
  regrade is complete.
- A patch version may reuse a result only when the benchmark owner states that
  the patch does not affect scoring.
- Every automated source has an owned schema, a minimum row and identity
  retention boundary, duplicate-key checks, an exact-version assertion, and a
  last-known-good checked snapshot.
- Timestamp-only polls do not create commits or change public freshness.
- A source-shape failure, version mismatch, validation failure, or publication
  failure opens or updates the durable automation-health issue. It never
  publishes partial data.
- The data refresh validates the exact changed tree with the same public build
  environment as CI before it creates a pull request.

## September 1, 2026 release incident

The existing release radar did not capture Anthropic's Fable 5.1 and Mythos
5.1 announcement. It only polled OpenRouter. Fable 5.1 appeared there later,
while trusted-access-only Mythos 5.1 had no aggregator identity and remained
structurally invisible. The scheduled job also could not publish unrelated
valid data changes because its build lacked the public Turnstile test key that
CI already supplied.

The remediation is to restore build parity, add first-party announcement
candidate discovery, keep OpenRouter as the identity layer, and publish TB4
through a separate owner-sourced dataset. The incident is resolved only after
the workflow succeeds end to end and the production page shows the new
sources.
