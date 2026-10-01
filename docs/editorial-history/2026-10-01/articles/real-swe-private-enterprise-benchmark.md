# Real-SWE’s task results reorder its aggregate rankings

Specific Labs licensed private production codebases and scored eight model-and-harness pairs over 640 rollouts. The leading 38.8% is an aggregate that per-task results reorder.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

[Real-SWE](https://withspecific.com/benchmarks/real-swe) is a coding-agent benchmark from Specific Labs, published in September 2026 by Snagnik Das, Siddhant Paliwal, and Janak Sunil. Its tasks come from private production codebases that the company licensed from real businesses, and each result belongs to a model running inside its own native harness. The page captured September 14, 2026 UTC ranks Fable 5.1 in Claude Code first at 38.8%, GPT-6 Astra in Codex CLI second at 33.8%, and GPT-5.6 Sol in Codex CLI eighth at 16.2%. The question Specific Labs puts on the page is: “Can a coding agent actually do the work of a software engineer in the real world?”

## What the resolution rate covers

“Resolution rate is equivalent to pass@1, averaged over eight independent runs per task. 95% confidence intervals are shown.” Pass@1 means the share of single attempts that pass, so a rate of 38.8% says that on average about four attempts in 10 produced a change the verifier accepted. The published analysis covers 10 sample tasks, eight model and harness pairs, and eight runs per task, which is 640 rollouts in total and 80 per pair. The leaderboard rates match that sample: Fable 5.1 passed 31 of 80 rollouts in the task table below, which rounds to 38.8%.

*Real-SWE leaderboard and estimated cost per rollout, captured September 14, 2026 UTC*
| Rank | Model | Harness | Resolution rate | Estimated cost per rollout |
| --- | --- | --- | --- | --- |
| 1 | Fable 5.1 | Claude Code | 38.8% | $6.96 |
| 2 | GPT-6 Astra | Codex CLI | 33.8% | $4.67 |
| 3 | Gemini 3.8 Flash | Gemini CLI | 31.2% | $2.50 |
| 4 | GLM 5.3 | Claude Code | 28.8% | $5.12 |
| =5 | Grok 4.6 | Grok Build | 23.8% | $3.44 (incomplete usage; actual cost may be higher) |
| =5 | Muse Spark 1.3 | Muse Code | 23.8% | $2.74 |
| 7 | Kimi K3 | Kimi Code | 18.8% | $3.90 (incomplete usage; actual cost may be higher) |
| 8 | GPT-5.6 Sol | Codex CLI | 16.2% | $2.65 |

Each agent ran in an isolated sandbox. Tasks use the Harbor format, and the grader injects the verifier only at grading time. “The verifiers are inspired by existing test suites in the codebase or use those tests verbatim.” The leaderboard chart shows 95% confidence intervals, but the page does not print the interval values. The 10 tasks are a published sample; Specific Labs offers the sample on request and does not state how many tasks or codebases the full benchmark contains.

## Why private production tasks are hard

Specific Labs screened codebases for companies with substantial usage, strong engineering teams, and demanding production workloads. The disclosed examples are a Luma or Partiful competitor with more than 200,000 users and a top-100 App Store ranking, a consumer fintech platform that processes more than 100,000 bank statements, and enterprise AI sales platforms with complex business workflows. The tasks are changes those companies’ engineers were paid to make: correcting invoice tax across differently configured businesses, migrating customer identities, and metering API tokens. The published tax example asks the agent to price destination tax through a TaxJar sandbox or production authority, report refused addresses without stopping the invoice, file settled sales back under the invoice number, and show both VAT registrations on invoices between European parties.

Each environment exposes only the services its workflow needs. Across the task set those services include an AWS emulator, Docker, Kubernetes, GitHub, a Linear MCP server, PostgreSQL, MySQL, MongoDB, Gel, Redis, Go, Python, Node.js, Vitest, Slack, Intercom, Google Drive, email, and ClickUp. An agent therefore works across code, infrastructure, and business tools in one rollout, rather than against a repository and a test suite alone.

The instructions are not longer than those of comparable benchmarks. The work behind them is wider. Specific Labs reports medians for its own tasks and for four other suites; the FrontierCode and DeepSWE figures come from Cognition’s published comparison, and no files-edited figure exists for Terminal-Bench 3 or FrontierSWE v2. The prompt-length measurement covers eight repository-backed sample tasks, while the results table covers 10, and the page does not reconcile the two counts.

*Median instruction length and files edited by the reference solution, as reported by Specific Labs*
| Benchmark | Median instruction (characters) | Median files edited |
| --- | --- | --- |
| Real-SWE | 1,742 | 11 |
| FrontierCode | 2,056 | 6 |
| DeepSWE | 1,975 | 6 |
| Terminal-Bench 3 | 1,584 | Not reported |
| FrontierSWE v2 | 992 | Not reported |

Short rollouts failed about as often as long ones. 71.4% of rollouts under 10 minutes failed (70 of 98), against 73.4% of rollouts of 10 minutes or longer (398 of 542). Specific Labs attributes the difficulty to triaging several systems and understanding requirements inside codebases full of existing business logic and coding patterns, not to agents giving up early.

## Per-task results reorder the leaderboard

Six of the 10 sample tasks resolve below 15%. Two tasks resolve above 65% across all eight pairs, and one task, Analytics stream reducer, resolves in none of its 64 rollouts. The table lists passed rollouts out of eight for every pair, in leaderboard order.

*Passed rollouts out of eight per task and model, as reported by Specific Labs*
| Task | Fable 5.1 | GPT-6 Astra | Gemini 3.8 Flash | GLM 5.3 | Grok 4.6 | Muse Spark 1.3 | Kimi K3 | GPT-5.6 Sol | All pairs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multi-region sweep | 7/8 | 8/8 | 8/8 | 2/8 | 3/8 | 8/8 | 2/8 | 5/8 | 67.2% |
| API keys & environments | 8/8 | 5/8 | 7/8 | 5/8 | 4/8 | 6/8 | 0/8 | 7/8 | 65.6% |
| Entitlement overage lines | 8/8 | 7/8 | 5/8 | 3/8 | 1/8 | 1/8 | 6/8 | 1/8 | 50.0% |
| Customer identity migration | 3/8 | 1/8 | 3/8 | 4/8 | 8/8 | 3/8 | 4/8 | 0/8 | 40.6% |
| Billing schedule migration | 3/8 | 1/8 | 2/8 | 2/8 | 0/8 | 0/8 | 1/8 | 0/8 | 14.1% |
| API token metering | 1/8 | 5/8 | 0/8 | 1/8 | 0/8 | 0/8 | 1/8 | 0/8 | 12.5% |
| S3 datastore measurement | 0/8 | 0/8 | 0/8 | 3/8 | 2/8 | 1/8 | 1/8 | 0/8 | 10.9% |
| Linearizable scan | 0/8 | 0/8 | 0/8 | 2/8 | 1/8 | 0/8 | 0/8 | 0/8 | 4.7% |
| Tax jurisdiction | 1/8 | 0/8 | 0/8 | 1/8 | 0/8 | 0/8 | 0/8 | 0/8 | 3.1% |
| Analytics stream reducer | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0.0% |

The aggregate order does not survive contact with individual tasks. On Customer identity migration, Grok 4.6 passed 8 of 8 while GPT-6 Astra passed 1 of 8 and GPT-5.6 Sol passed none. On S3 datastore measurement, the three highest-ranked pairs all passed 0 of 8 while GLM 5.3 passed 3 and Grok 4.6 passed 2. On API token metering, GPT-6 Astra passed 5 of 8 while Fable 5.1 passed 1 and Gemini 3.8 Flash passed none. On Entitlement overage lines, Kimi K3 passed 6 of 8 while Grok 4.6, Muse Spark 1.3, and GPT-5.6 Sol each passed 1.

> **How to use the aggregate**
>
> Use the leaderboard to shortlist pairs, then look for the task class closest to your change. A pair that leads the aggregate can be the worst option for a migration or a datastore change in this sample, and a pair in the bottom half can be the only one that resolves a task reliably.

## Missed requirements are the most common failure

Specific Labs groups failed rollouts by observed submission behavior, following the DeepSWE taxonomy and applying it to every model in the same way:

- **Unverified assumption**: Builds on a guess about the system instead of checking it in the workspace.
- **Missed requirement**: Leaves out behavior the instruction requires.
- **Integration error**: Right idea, wired into the surrounding system incorrectly.
- **Regression**: Breaks existing behavior while making the change.
- **Wrong file**: Delivers the change somewhere the running application never calls, such as a one-off script.

*Failed rollouts per category and model, as reported by Specific Labs, with totals across all eight pairs*
| Model | Failed rollouts | Unverified assumption | Missed requirement | Integration error | Regression | Wrong file |
| --- | --- | --- | --- | --- | --- | --- |
| Fable 5.1 | 49 | 12 | 18 | 17 | 2 | 0 |
| GPT-6 Astra | 53 | 18 | 15 | 18 | 2 | 0 |
| Gemini 3.8 Flash | 55 | 6 | 16 | 27 | 6 | 0 |
| GLM 5.3 | 57 | 16 | 22 | 15 | 0 | 4 |
| Grok 4.6 | 61 | 15 | 41 | 5 | 0 | 0 |
| Muse Spark 1.3 | 61 | 12 | 22 | 25 | 2 | 0 |
| Kimi K3 | 65 | 10 | 35 | 18 | 0 | 2 |
| GPT-5.6 Sol | 67 | 29 | 21 | 11 | 6 | 0 |
| All eight pairs | 468 | 118 | 190 | 136 | 18 | 6 |

Across the 468 failed rollouts, missed requirement accounts for 190 (40.6%), integration error for 136, unverified assumption for 118, regression for 18, and wrong file for 6. The mix differs by model. Grok 4.6 attributes 67.2% of its failures to missed requirements and Kimi K3 53.8%. Gemini 3.8 Flash fails most often by integration error (49.1%), and GPT-5.6 Sol most often by unverified assumption (43.3%). Regressions and wrong-file deliveries are rare for every pair.

Specific Labs draws one conclusion from that pattern: “We’ve found that today’s models are weaker at understanding company coding patterns and frequently miss requirements or don’t verify their assumptions.” For a team pointing an agent at its own repository, the largest failure bucket in this sample is requirement capture against existing conventions, not code generation.

## Cost per rollout

Estimated cost per rollout ranges from $2.50 for Gemini 3.8 Flash to $6.96 for Fable 5.1. The highest resolution is also the most expensive rollout, but the relationship is not monotonic: GLM 5.3 cost $5.12 for 28.8%, while Gemini 3.8 Flash reached 31.2% at less than half that cost. Specific Labs flags the Grok 4.6 and Kimi K3 figures as incomplete usage whose actual cost may be higher. Mean output tokens per rollout range from 23k for GPT-5.6 Sol and 24k for GPT-6 Astra to 117k for GLM 5.3. These are evaluation estimates for this sample, not a price list.

## The harness is part of the measurement

“We use native harnesses to reflect how enterprise engineers work in practice, evaluating model-and-harness combinations rather than models in isolation.” Each score therefore belongs to a pair. Gemini 3.8 Flash ran in Gemini CLI, and Google [announced](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) on May 19, 2026 that it is transitioning Gemini CLI to Antigravity CLI, which shares a server-side harness with the Antigravity desktop application. The notice set June 18, 2026 as the date consumer Gemini CLI access would stop serving requests, while enterprise licenses and paid API keys keep Gemini CLI available. Commenters in the launch discussion raised the same harness question. The 31.2% result is specific to the Gemini CLI pairing. A result for the same model in Antigravity would be a different measurement, not a correction, and the same holds for any other model moved to a different harness.

## How to read Real-SWE beside the aicharts chart

The aicharts coding-agent chart is a checked snapshot of the public [Artificial Analysis coding-agents page](https://artificialanalysis.ai/agents/coding-agents/), retrieved Sep 25, 2026, 2:39 PM UTC. It stores each model, harness, and effort setting with an AA Index score, its component benchmarks, mean cost per task, active time, and token use. Real-SWE is not one of the site’s checked datasets, and Specific Labs publishes no resolve-rate comparison between Real-SWE and any public suite, so there is no supported conversion between the two scales.

The snapshot retrieved Sep 25, 2026, 2:39 PM UTC stores six of the eight Real-SWE model and harness names. The table pairs each Real-SWE configuration with the snapshot row that shares its model and harness name at the highest stored effort setting. A shared name does not establish matching settings or a matched run. Two pairs have no same-name row in the snapshot: Gemini 3.8 Flash in Gemini CLI, GLM 5.3 in Claude Code.

*Real-SWE pairs beside same-name rows in the aicharts snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Real-SWE pair | Real-SWE resolution | Snapshot row | AA Index | Mean cost per task |
| --- | --- | --- | --- | --- |
| Fable 5.1 · Claude Code | 38.8% | Fable 5.1 (with fallback) · Claude Code · max | 62.2 | $12.39 |
| GPT-6 Astra · Codex CLI | 33.8% | GPT-6 Astra · Codex · max | 61.6 | $7.47 |
| Gemini 3.8 Flash · Gemini CLI | 31.2% | Not in the snapshot | - | - |
| GLM 5.3 · Claude Code | 28.8% | Not in the snapshot | - | - |
| Grok 4.6 · Grok Build | 23.8% | Grok 4.6 · Grok Build · xhigh | 47.0 | $3.57 |
| Muse Spark 1.3 · Muse Code | 23.8% | Muse Spark 1.3 · Muse Code · max | 54.3 | $3.98 |
| Kimi K3 · Kimi Code | 18.8% | Kimi K3 · Kimi Code CLI · default | 51.9 | $5.05 |
| GPT-5.6 Sol · Codex CLI | 16.2% | GPT-5.6 Sol · Codex · max | 54.6 | $6.35 |

The two columns of scores measure different things. Real-SWE resolution is the share of 80 private-task rollouts that passed a company-derived verifier. AA Index is a composite of DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA on public task sets. A pair can therefore sit higher in one column than the other without either source being wrong, and the two values must not be subtracted, averaged, or plotted on one axis.

## Private provenance trades reproducibility for contamination resistance

“Tasks on private codebases are natively out of distribution.” Specific Labs argues that the code and its solutions are not available on the public internet and states that 99% of tokens in real-world enterprises are hidden from frontier models. The page asserts this from provenance; it reports no contamination measurement against the evaluated models.

Readers cannot reproduce the full evaluation from public materials. The tasks and verifiers are private, and access to the published sample is available on request. In the [Hacker News discussion](https://news.ycombinator.com/item?id=49676820) submitted on September 12, 2026, commenters objected that a benchmark whose code cannot be inspected asks readers to take the result on trust, others replied that transparency is the price of a benchmark that is harder to game, and one commenter who runs a benchmark in another domain argued that contamination should be measured every time. Those are practitioner reactions, not measurements, but they name the trade a reader accepts when using a private-task leaderboard.

## Limits

- Every rate, cost, token count, and failure share belongs to the 10-task published sample, the named model and harness pairs, and the eight-run protocol on the page captured September 14, 2026 UTC. These tables preserve that dated sample; the source leaderboard has since changed.
- Resolution is pass@1 averaged over eight runs. It does not report how close a failed rollout came, and the 95% intervals drawn on the leaderboard chart are not printed as numbers.
- Scores are harness-specific. Gemini 3.8 Flash in Gemini CLI, GLM 5.3 in Claude Code, and Kimi K3 in Kimi Code are pairs; the same model in another harness is a different measurement.
- Specific Labs publishes no resolve-rate crosswalk to SWE-bench-style public suites. Its only cross-benchmark figures are median instruction length and median files edited, and the prompt-length medians cover eight sample tasks while the results cover 10.
- Estimated cost per rollout is an evaluation estimate with incomplete usage for two pairs. It is not a subscription price or a production invoice.
- The snapshot rows in this note share model and harness names with Real-SWE pairs. They come from public task sets and separate runs, and they must not be compared numerically with Real-SWE resolution.
- Public materials do not support an independent rerun of the full evaluation. Private provenance alone does not measure contamination in the evaluated models.

## Current comparison: coding agents

The interactive chart shows the current source snapshot across benchmark performance, cost, speed, and token use.

[Explore chart](https://aicharts.io/)

## Sources

- [Introducing Real-SWE](https://withspecific.com/benchmarks/real-swe). Specific Labs, 2026. The September 2026 benchmark page reports the eight-pair leaderboard, the pass@1 definition, the ten-task sample table, the failure taxonomy counts, the instruction and files-edited medians, the cost and token estimates, and the evaluation setup.
- [An important update: Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/). Google Developers Blog, 2026. The May 19, 2026 announcement states that Gemini CLI is transitioning to Antigravity CLI, sets June 18, 2026 as the date consumer access would stop serving requests, and keeps Gemini CLI available to enterprise licenses and paid API keys.
- [Real-SWE: Benchmarking AI models on private, real-world, enterprise codebases](https://news.ycombinator.com/item?id=49676820). Hacker News, 2026. The September 12, 2026 discussion records practitioner objections to non-reproducible private tasks, replies defending the trade against gaming, the call to measure contamination, and the Gemini CLI versus Antigravity harness dispute.
- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [Why a coding-agent high score still needs a holdout](https://aicharts.io/blog/coding-agent-score-holdouts)
- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
