# HarnessTax finds cost gaps at similar success rates

UC Berkeley and Arena researchers ran 21 model and harness pairs on two public suites. Success stayed close across harnesses; cost did not.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

[HarnessTax](https://harnesstax.github.io/) is a 2026 evaluation by Melissa Z. Pan, Shuo Yang, Negar Arabzadeh, Ion Stoica, and Matei Zaharia at UC Berkeley, with Wei-Lin Chiang at Arena. The page captured September 16, 2026 UTC asks how much a coding-agent harness changes task success and cost when the model stays the same.

A harness is the software that gives a model tools, manages context, and runs the task. The authors compare 21 model and harness pairs: seven models in Claude Code, Codex CLI, and Pi, on 30 randomly sampled tasks from SWE-bench Lite and 30 from Terminal-Bench 2.0. Codex CLI appears as Codex in the result tables. Each pair gets three attempts per task.

## What the 21 pairs cover

The authors start from each harness’s native configuration, select its high-effort setting, and cap each attempt at 100 agent turns. Turn counts and effort settings follow each harness’s own definitions. Task success uses each benchmark’s official evaluator. Cost and success are averaged across a task’s three attempts, then across the 30 tasks. The 95% confidence intervals use 10,000 bootstrap resamples of those task averages. Token costs use a fixed direct-API price list dated September 1, 2026, applied to each model in every harness.

On SWE-bench Lite, the task containers have no external network. The authors disable the default web tools in Claude Code and Codex and reject hosted tool declarations at the API request. For Pi they add two packages to configure subscription keys and control agent turns. They access Kimi K3 through Fireworks AI and keep that model’s single native thinking mode in all three harnesses.

## Cost moves more than success

The same model can achieve similar success rates at up to 5x costs. Claude Fable 5 has similar observed success across the three harnesses on SWE-bench Lite: it solves 97.8% of attempts in Claude Code, 96.7% in Codex, and 96.7% in Pi, while Claude Code costs about twice as much as Pi ($1.33 versus $0.67). Across shared models, the authors report geometric-mean cost ratios: Claude Code costs about 2.0× as much as Pi and 1.6× as much as Codex on SWE-bench Lite, and 1.5× as much as Pi on Terminal-Bench 2.0. The average harness effect on success stays within ±2% on SWE-bench Lite and about ±5% on Terminal-Bench 2.0.

The published SWE-bench Lite table’s largest same-model cost spread is GPT-5.6 Luna at $0.030 in Pi and $0.152 in Claude Code, with success rates of 53.3% and 55.6%. That pairing is the comparison behind the authors’ “up to 5x” figure. They call paying more for essentially the same success a harness tax: a default agent pairing can hide that gap if you only look at resolve rate.

*HarnessTax SWE-bench Lite success rate and standardized cost per attempt, captured September 16, 2026 UTC*
| Model | Harness | Success rate | Cost per attempt |
| --- | --- | --- | --- |
| Claude Fable 5 | Claude Code | 97.8% | $1.329 |
| Claude Fable 5 | Codex | 96.7% | $0.890 |
| Claude Fable 5 | Pi | 96.7% | $0.666 |
| Claude Opus 4.8 | Claude Code | 86.7% | $0.976 |
| Claude Opus 4.8 | Codex | 88.9% | $0.694 |
| Claude Opus 4.8 | Pi | 82.2% | $0.473 |
| Claude Sonnet 4.6 | Claude Code | 66.7% | $0.669 |
| Claude Sonnet 4.6 | Codex | 68.9% | $0.745 |
| Claude Sonnet 4.6 | Pi | 64.4% | $0.679 |
| Claude Haiku 4.5 | Claude Code | 52.2% | $0.426 |
| Claude Haiku 4.5 | Codex | 57.8% | $0.392 |
| Claude Haiku 4.5 | Pi | 60.0% | $0.374 |
| GPT-5.6 Sol | Claude Code | 77.8% | $1.540 |
| GPT-5.6 Sol | Codex | 73.3% | $0.561 |
| GPT-5.6 Sol | Pi | 74.4% | $0.441 |
| GPT-5.6 Luna | Claude Code | 55.6% | $0.152 |
| GPT-5.6 Luna | Codex | 55.6% | $0.035 |
| GPT-5.6 Luna | Pi | 53.3% | $0.030 |
| Kimi K3 | Claude Code | 76.7% | $0.784 |
| Kimi K3 | Codex | 74.4% | $0.845 |
| Kimi K3 | Pi | 72.2% | $0.455 |

*HarnessTax Terminal-Bench 2.0 success rate and standardized cost per attempt, captured September 16, 2026 UTC*
| Model | Harness | Success rate | Cost per attempt |
| --- | --- | --- | --- |
| Claude Fable 5 | Claude Code | 75.6% | $1.554 |
| Claude Fable 5 | Codex | 72.2% | $0.976 |
| Claude Fable 5 | Pi | 71.1% | $1.079 |
| Claude Opus 4.8 | Claude Code | 68.9% | $0.899 |
| Claude Opus 4.8 | Codex | 72.2% | $0.848 |
| Claude Opus 4.8 | Pi | 72.2% | $0.758 |
| Claude Sonnet 4.6 | Claude Code | 62.2% | $0.669 |
| Claude Sonnet 4.6 | Codex | 63.3% | $0.552 |
| Claude Sonnet 4.6 | Pi | 65.6% | $0.614 |
| Claude Haiku 4.5 | Claude Code | 41.1% | $0.263 |
| Claude Haiku 4.5 | Codex | 31.1% | $0.214 |
| Claude Haiku 4.5 | Pi | 47.8% | $0.250 |
| GPT-5.6 Sol | Claude Code | 71.1% | $1.355 |
| GPT-5.6 Sol | Codex | 78.9% | $0.761 |
| GPT-5.6 Sol | Pi | 83.3% | $0.421 |
| GPT-5.6 Luna | Claude Code | 70.0% | $0.098 |
| GPT-5.6 Luna | Codex | 72.2% | $0.064 |
| GPT-5.6 Luna | Pi | 76.7% | $0.045 |
| Kimi K3 | Claude Code | 66.7% | $0.521 |
| Kimi K3 | Codex | 70.0% | $0.450 |
| Kimi K3 | Pi | 73.3% | $0.383 |

GPT-5.6 Luna is the lowest-cost model on both benchmarks. Claude Fable 5 has the highest success rate on SWE-bench Lite. Kimi K3, an open-weight model, sits near GPT-5.6 Sol on the SWE-bench Lite cost-success frontier and just below the Terminal-Bench 2.0 frontier. Those ranks belong to this 30-task sample and price list, not to a general leaderboard.

## A four-tool harness stays on the frontier

Pi reaches the published Pareto frontier on both benchmarks with four tools: read, write, edit, and bash. On SWE-bench Lite, Fable 5 averages 15.4 turns per attempt in Pi and 15.3 in Claude Code, yet Claude Code costs about twice as much while success rises by 1.1 percentage points. The authors treat that as higher spending per recorded turn, and they note that turn definitions differ by harness.

A harness tax can start on the first model call. Across all seven models on SWE-bench Lite, Claude Code’s mean initial context is over 10× Pi’s, with longer instructions and larger tool definitions. Total spend still depends on caching, generated tokens, and later calls. The authors say richer harness features may still help other models, workloads, or interactive settings, so harness complexity is an empirical trade-off rather than a default upgrade.

## Models can lead outside their own harness

Providers sometimes optimize a model for their own coding environment. The authors cite OpenAI’s description of GPT-5-Codex as optimized for software engineering in Codex. Across the six Anthropic and OpenAI models and both benchmarks, an alternative harness still posts the highest observed success rate in nine of 12 comparisons. Reconstructing that count from the published tables, a comparison counts as an alternative win only when the provider harness is not among the pairs tied for the highest success rate.

- Claude Opus 4.8 on SWE-bench Lite: Codex at 88.9%, ahead of Claude Code at 86.7%.
- Claude Sonnet 4.6 on SWE-bench Lite: Codex at 68.9%, ahead of Claude Code at 66.7%.
- Claude Haiku 4.5 on SWE-bench Lite: Pi at 60.0%, ahead of Claude Code at 52.2%.
- GPT-5.6 Sol on SWE-bench Lite: Claude Code at 77.8%, ahead of Codex at 73.3%.
- Claude Opus 4.8 on Terminal-Bench 2.0: Codex at 72.2% and Pi at 72.2%, ahead of Claude Code at 68.9%.
- Claude Sonnet 4.6 on Terminal-Bench 2.0: Pi at 65.6%, ahead of Claude Code at 62.2%.
- Claude Haiku 4.5 on Terminal-Bench 2.0: Pi at 47.8%, ahead of Claude Code at 41.1%.
- GPT-5.6 Sol on Terminal-Bench 2.0: Pi at 83.3%, ahead of Codex at 78.9%.
- GPT-5.6 Luna on Terminal-Bench 2.0: Pi at 76.7%, ahead of Codex at 72.2%.

Two of those gaps are the ones the authors highlight. Claude Sonnet 4.6 solves 68.9% of SWE-bench Lite attempts in Codex versus 66.7% in Claude Code, at a similar cost. GPT-5.6 Sol on Terminal-Bench 2.0 reaches 83.3% in Pi versus 78.9% in Codex, at about half the cost ($0.42 versus $0.76). The authors’ line that “your Claude models may not need Claude Code” applies to highest success in this sample.

> **What the nine of 12 count is**
>
> It is a highest-success tally on six Anthropic and OpenAI models over two 30-task samples. It is not a cost ranking, a statistically tested harness effect, or a result for Kimi K3, which has no provider harness in this study.

## How to read HarnessTax beside the aicharts chart

The aicharts coding-agent chart is a checked snapshot of the public [Artificial Analysis coding-agents page](https://artificialanalysis.ai/agents/coding-agents/), retrieved Sep 25, 2026, 2:39 PM UTC. It stores each model, harness, and effort setting with an AA Index score and mean cost per task. HarnessTax is not one of the site’s checked datasets. Its suites are SWE-bench Lite and Terminal-Bench 2.0, not the AA Index mix, so there is no supported conversion between the two scales.

The snapshot stores Claude Code and Codex rows for several of the same model names. It does not store Pi. A shared model or harness name is not the same evaluation.

[Real-SWE](/blog/real-swe-private-enterprise-benchmark) scores each model in its native harness on private production tasks. HarnessTax does the opposite measurement: it moves the same model across three harnesses on public suites. [Public-suite holdouts](/blog/coding-agent-score-holdouts) still matter here. The authors say these two open-source benchmarks may have appeared in training, and they treat that as a limit on generalization.

## Limits

- Every rate and cost belongs to 30 tasks per benchmark, three attempts, a 100-turn cap, high-effort native settings, and the September 1, 2026 direct-API price list on the page captured September 16, 2026 UTC.
- SWE-bench Lite and Terminal-Bench 2.0 are public suites. The authors say models may have encountered them during training, and they expect results to differ on other benchmarks and on real development workflows.
- The average harness effect on success is a reported bound (±2% and about ±5%), not a proof that harness choice never changes resolve rate.
- Cost is standardized token cost per attempt, not a subscription invoice, a cache-adjusted bill, or latency.
- Turn counts are not comparable across harnesses. The first-call context comparison is a starting-tax observation, not a full cost decomposition.
- The nine of 12 alternative-harness tally is a highest-success count on six models. Several of those gaps are small, and the published intervals overlap.
- aicharts snapshot rows that share a model or harness name come from a different suite, retrieval date, and effort setting. They must not be subtracted from or averaged with HarnessTax rates.

## Compare current coding-agent configurations

The coding-agent chart stores each model with its harness and effort setting. The calculator prices a different question: one subscription seat’s token volume on API and GPU paths.

- [Coding-agent chart](https://aicharts.io/coding)
- [Subscription vs API vs GPUs](https://aicharts.io/calculator)

## Sources

- [HarnessTax: How Much Does the Harness Matter for Coding Agents?](https://harnesstax.github.io/). UC Berkeley and Arena, 2026. The page captured September 16, 2026 UTC reports the 21-pair evaluation, the three findings, the printed SWE-bench Lite and Terminal-Bench 2.0 tables, and the named method bounds.
- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [Real-SWE’s task results reorder its aggregate rankings](https://aicharts.io/blog/real-swe-private-enterprise-benchmark)
- [Why a coding-agent high score still needs a holdout](https://aicharts.io/blog/coding-agent-score-holdouts)
- [Open models closed SemiAnalysis composites, not this table](https://aicharts.io/blog/open-models-coding-agent-benchmarks)
- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
