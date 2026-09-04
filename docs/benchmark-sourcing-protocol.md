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

OpenAI's [GPT-6 Astra release](https://openai.com/index/gpt-6-astra/)
reports 57.9% on Terminal-Bench 4.0 and 64.6% on
Terminal-Bench-Science 0.1. Its comparison table also reports OSWorld 2.0,
Humanity's Last Exam with tools, AutomationBench, DeepSWE, and the Artificial
Analysis Coding Agent Index. This independently supports the selected portfolio:
one owner-sourced standard for terminal coding plus distinct science,
professional-work, computer-use, and broad-reasoning views. The release does
not justify another coding standard or a composite score. Astra's launch rows
remain `vendor-reported` until each benchmark owner publishes the matching
system configuration.

Anthropic's [Fable 5.1 and Mythos 5.1 release](https://www.anthropic.com/claude-fable-and-mythos-5-1)
reports Terminal-Bench 4, Terminal-Bench-Science 0.1, and CursorBench 3.2
results. Those launch values remain `vendor-reported`. Harbor's current TB4
snapshot separately publishes Fable 5.1 with Claude Code 2.1.257 at max effort
at 57.88%. AI Charts does not substitute that owner result for Anthropic's
55.8% launch observation because the exact run configuration and result differ.
Anthropic's Terminal-Bench-Science and CursorBench launch values remain
`vendor-reported` pending matching owner observations. The trusted-access
Mythos result also remains a separate safeguarded-system observation even
though Anthropic describes Fable and Mythos as the same underlying model.

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

1. **First-party candidate discovery** checks configured lab-owned
   announcement sources before it consults an aggregator. It retains every
   model parsed from a multi-model release URL, including a restricted model
   that no marketplace lists, and sends unknown announcement-like URL shapes
   to review. A candidate records the lab, source, canonical announcement URL,
   first-seen time, model names parsed from recognized canonical URL patterns,
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

The active first-party registry covers 23 labs across 28 sources: Anthropic,
OpenAI, Google DeepMind, Meta, xAI, Mistral AI, Cohere, DeepSeek, Z.ai,
Moonshot AI/Kimi, Alibaba/Qwen, MiniMax, ByteDance Seed, Microsoft AI, NVIDIA
Nemotron, Amazon Nova, Baidu ERNIE, Tencent Hunyuan, Xiaomi MiMo, AI21 Labs,
IBM Granite, Ai2, and StepFun. A lab can own more than one source, so public
summaries report a distinct lab count and a separate source count. Source
definitions, host constraints, and minimum safe shapes remain executable
contracts in the refresh code and tests.

### Active first-party coverage

| Lab | Official discovery surface | Boundary |
| --- | --- | --- |
| Anthropic | [Site sitemap](https://www.anthropic.com/sitemap.xml) | Whole-host URL delta, including root launches, Claude pages, news, research, and system cards. |
| OpenAI | [Release sitemap](https://openai.com/sitemap.xml/release/), [safety sitemap](https://openai.com/sitemap.xml/safety/), and [API model catalog](https://developers.openai.com/api/docs/models/all) | New release and safety URLs plus the featured catalog fingerprint. The catalog can detect availability before an announcement enters the release sitemap. |
| Google DeepMind | [DeepMind sitemap](https://deepmind.google/sitemap.xml) | Model and model-card URLs, including Gemini, Gemma, Veo, Imagen, Lyria, and Genie families. |
| Meta | [Meta AI research sitemap](https://research.meta.ai/sitemap.xml) and [Meta announcements guide](https://about.fb.com/llms.txt) | Research model URLs plus dated newsroom announcement links. |
| xAI | [Release notes](https://docs.x.ai/developers/release-notes) | Release-note heading fingerprint for Grok model additions. |
| Mistral AI | [Current site sitemap](https://mistral.ai/sitemap-0.xml) | Model-launch URLs under the official news namespace. |
| Cohere | [Documentation sitemap](https://docs.cohere.com/sitemap.xml) | Model changelog URL additions; deployment-wide timestamps are ignored. |
| DeepSeek | [Site sitemap](https://www.deepseek.com/sitemap.xml) and [API change log](https://api-docs.deepseek.com/updates/) | Official site releases plus dated API model headings; generic API-news pages are excluded. |
| Z.ai | [Model release notes](https://docs.z.ai/release-notes/new-released) | Dated GLM release-note fingerprint. |
| Moonshot AI/Kimi | [Platform documentation sitemap](https://platform.kimi.com/docs/sitemap.xml) | Kimi model-guide URL additions. |
| Alibaba/Qwen | [Model changelog](https://docs.qwencloud.com/changelog/models) | Dated model changelog fingerprint. |
| MiniMax | [Model release notes](https://platform.minimax.io/docs/release-notes/models) | Model release-note fingerprint; shallow marketing sitemaps remain supplemental. |
| ByteDance Seed | [Site sitemap](https://seed.bytedance.com/sitemap.xml) | Model-launch blog URLs with locale variants canonicalized. |
| Microsoft AI | [Model sitemap](https://microsoft.ai/model-sitemap.xml) | MAI model-page URL additions. |
| NVIDIA Nemotron | [Nemotron RSS](https://blogs.nvidia.com/blog/tag/nemotron/feed/) | Dated Nemotron posts; every candidate still requires review because the feed also carries ecosystem news. |
| Amazon Nova | [Nova category RSS](https://aws.amazon.com/blogs/aws/category/artificial-intelligence/amazon-machine-learning/amazon-bedrock/amazon-nova/feed/) | Dated model-launch URLs with roundups and product-only posts excluded. |
| Baidu ERNIE | [English blog sitemap](https://ernie.baidu.com/blog/en/sitemap.xml) | English model-release posts with relative URLs resolved against the first-party host. |
| Tencent Hunyuan | [Tencent sitemap index](https://www.tencent.com/sitemap_index.xml) | Hunyuan and Tencent HY model-release posts across all post sitemap children. |
| Xiaomi MiMo | [MiMo sitemap](https://mimo.mi.com/sitemap.xml) | English model-release news URLs; locale variants are excluded. |
| AI21 Labs | [Blog post sitemap](https://www.ai21.com/post-sitemap.xml) | Jamba and Jurassic launch posts, including an exact mapping for the non-announcement Jamba 1.7 release mention; SDK, integration, and comparison posts are excluded. |
| IBM Granite | [IBM Research current sitemap shard](https://research.ibm.com/sitemap-0.xml) | Granite-specific model-release posts. Candidate rows require dates even though unrelated sitemap rows may omit them. |
| Ai2 | [Ai2 sitemap](https://allenai.org/sitemap.xml) | Model-release posts for OLMo, Molmo, Tülu, SERA, and related open-model families, with exact mappings for high-signal launch slugs that omit a model version. |
| StepFun | [English platform documentation sitemap](https://platform.stepfun.ai/docs/sitemap.xml) and [China platform documentation sitemap](https://platform.stepfun.com/docs/sitemap.xml) | Exact model-detail pages under the English and Chinese model namespaces. The China source adds the explicitly named, unversioned Step Explore model; router, category, quickstart, cookbook, and mobile-agent pages are excluded. Both lanes are URL-delta coverage. |

Discovery is based on canonical URL deltas. A canonical announcement URL that
was not in the durable ledger creates a candidate. Sitemap `lastmod` values and
other provider timestamps can change after publication, so they remain
secondary change evidence and never define a new release, an official release
date, or a benchmark observation. Later source edits refresh source-level health
and can update a candidate's parsed model names, presence, and last-changed
marker. They do not rewrite its original source-modified date, first-seen time,
identity, source ownership, or reviewed status.

StepFun's dated [Step Edge announcement](https://static.stepfun.com/blog/step-edge/)
demonstrates the remaining provider-side discovery limit: the official static
site sitemap does not enumerate its `/blog/*` microsites. Step Edge therefore
remains a targeted manual/watchlist check instead of being presented as strict
automated coverage. The mutable platform overview and sitemap timestamps may
corroborate a review, but cannot supply an official release date by themselves.

Active discovery does not guarantee chart admission. Modality-specific labs and
publishers with broad or noisy announcement surfaces remain on the source
watchlist until their releases add a distinct comparable signal. That watchlist
currently includes Apple Foundation Models, Black Forest Labs/FLUX, Runway,
Stability AI, ElevenLabs, Perplexity/Sonar, LG EXAONE, Naver HyperCLOVA,
01.AI, Sakana AI, and TII/MBZUAI. Perplexity's
[official changelog](https://docs.perplexity.ai/docs/resources/changelog.md)
mixes Sonar lifecycle events with platform and third-party model changes, while
[01.AI's sitemap](https://www.01.ai/sitemap.xml) currently exposes corporate
pages rather than a usable model-release history. Both stay under review for a
narrower first-party surface. Huawei/Pangu also remains on the watchlist:
its [MaaS release bulletin](https://support.huaweicloud.com/bulletin-maas/bulletin-maas-0001.md)
is a structured but mixed catalog whose rows mostly announce third-party model
availability, while Huawei's broad corporate sitemap omits machine-readable
dates. Adding Pangu requires a source-specific bulletin adapter that admits only
Huawei-owned model rows and keeps model-version dates distinct from release
dates.

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
- First-party sources degrade independently. When one source is unavailable or
  changes shape, the refresh retains that source's last-known-good snapshot and
  candidates and continues processing healthy sources. The preserved retrieval
  time and the failed automation run expose the stale slice. The refresh never
  substitutes an empty result for a failed source.
- A source-shape failure, version mismatch, validation failure, or publication
  failure opens or updates the durable automation-health issue. The checked
  ledger stays schema-valid, and a failed source stays on its previous slice.
- A newly observed first-party candidate opens or updates the durable release
  review issue immediately after release discovery. That alert does not wait
  for Terminal-Bench, Terminal-Bench-Science, Artificial Analysis, or another
  benchmark refresh. Production data still passes the repository's complete
  validation and publication gates.
- The data refresh validates the exact changed tree with the same public build
  environment as CI before it creates a pull request.

## September 2026 release-discovery incidents

On September 1, the release radar did not capture Anthropic's Fable 5.1 and
Mythos 5.1 announcement. It only polled OpenRouter. Fable 5.1 appeared there
later, while trusted-access-only Mythos 5.1 had no aggregator identity and
remained structurally invisible. The scheduled job also could not publish
unrelated valid data changes because its build lacked the public Turnstile test
key that CI already supplied.

On September 3, the OpenAI watcher would not have caught GPT-6 Astra end to end.
It polled only OpenAI's release sitemap while Astra material appeared on another
OpenAI-owned discovery surface. The parser would also have treated the route as
unresolved, and an unrelated benchmark refresh failure could have prevented the
release-review alert.

The remediation restores build parity, monitors the multi-lab first-party
registry, detects canonical URL additions across each lab's official sources,
and preserves a durable manual-review queue. OpenRouter remains the secondary
identity layer. An off-minute hourly release lane runs both discovery layers and
the review alert independently from the four-hour benchmark lane; the heavier
Artificial Analysis import remains daily. Terminal-Bench 4 stays a separate
owner-sourced dataset. A later outage can therefore preserve one source at its
previous retrieval time without erasing its history or hiding a candidate found
by a healthy source.
