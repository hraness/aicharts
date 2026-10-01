# GPT-6 Sol scores 56.7 on the coding-agent chart at $2.99 a task

Codex · GPT-6 Sol (max) scores 56.7 on the coding-agent AA Index at $2.99 per task, seventh of 20 configurations, and GPT-6 Sol (max) scores 47.5 on the Intelligence Index at $1.06 per task. Each row sits on its own chart’s cost frontier.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

OpenAI [released GPT-6 Sol](https://openai.com/index/introducing-gpt-6-sol-and-luna/) on September 22, 2026 in ChatGPT Work and Codex, with API prices half those of GPT-5.6 Sol. Artificial Analysis measured it the same day. In the coding-agent snapshot retrieved Sep 25, 2026, 2:39 PM UTC, Codex · GPT-6 Sol (max) scores 56.7 on AA Index at a mean API cost of $2.99 per task, seventh of 20 configurations, and no other configuration scores at least as high at the same or lower cost, which puts the row on the chart’s cost frontier. In the Intelligence Index snapshot retrieved Sep 23, 2026, 1:38 PM UTC, GPT-6 Sol (max) scores 47.5 at $1.06 per task, 14th of 97 configurations with a measured cost per task, and on that chart’s cost frontier by the same test.

## The two charts

The [coding-agent chart](/coding) is a daily snapshot of the public [Artificial Analysis coding-agents comparison](https://artificialanalysis.ai/agents/coding-agents/). A row on it is a model running inside a named agent harness at one effort setting, and its AA Index averages three benchmarks: DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA. Its cost is the mean API bill for one task in that harness. GPT-6 Sol appears once, inside Codex, OpenAI’s coding agent, at the max setting.

The [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/models) runs the model itself, through its API, under one harness that is the same for every model, across 10 evaluations weighted 30% agents, 20% coding, 20% scientific reasoning, and 30% general capability, at version 4.3.2. GPT-6 Sol (max) is its headline row, at the same effort setting as the coding-agent row, and each lower effort level of the model is a row of its own.

*GPT-6 Sol at max effort in the two aicharts snapshots, each scored on its own task set with its own cost definition*
| Chart | Configuration | Score | Cost per task | Snapshot retrieved |
| --- | --- | --- | --- | --- |
| Coding agents (AA Index) | Codex · GPT-6 Sol (max) | 56.7 | $2.99 | Sep 25, 2026, 2:39 PM UTC |
| Intelligence Index | GPT-6 Sol (max) | 47.5 | $1.06 | Sep 23, 2026, 1:38 PM UTC |

## On the coding-agent chart, seventh of 20 configurations

The 56.7 places Codex · GPT-6 Sol (max) seventh of the 20 configurations that carry an index in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC. Six configurations score higher: Claude Code · Opus 5.5 (max) at 66.0, Claude Code · Fable 5.1 (with fallback) (max) at 62.2, Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium (default) at 61.7, Codex · GPT-6 Astra (max) at 61.6, Claude Code · Opus 5 (max) at 59.7, and Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium (default) at 58.9. The leader, Claude Code · Opus 5.5 (max), is 9.3 points above it at $13.04 per task.

The row is on the chart’s cost frontier: no other configuration scores at least as high at the same or lower cost per task. The cheapest configuration that scores higher, Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium (default), scores 58.9 at $4.54 per task, 1.5x the cost.

One other configuration scores within one AA Index point of it: Grok Build · Grok 4.7 (xhigh) at 56.3 for $8.82 per task, 0.4 points lower at 2.9x the cost.

Artificial Analysis’s [launch note](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier) of September 22, 2026 reports the same row at 57 and says it “sits on the Pareto frontier of Coding Agent Index vs Cost per Task.” The snapshot agrees. Rankings on this chart move whenever Artificial Analysis publishes a new configuration, and the chart counts every harness, including configurations such as Devin Fusion CLI that pair two models in one harness.

## From GPT-5.6 Sol to GPT-6 Sol in Codex

The snapshot stores the previous generation in the same harness at the same setting: Codex · GPT-5.6 Sol (max) at 54.6 for $6.35 per task. GPT-6 Sol adds 2.1 points at 0.5x the mean cost per task and 1.0x the total tokens per task. Terminal-Bench 4 rose 6.1 points and SWE-Atlas-QnA rose 3.5 points, while DeepSWE v1.1 fell 3.2 points.

*Codex · GPT-5.6 Sol and Codex · GPT-6 Sol at the max setting in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Measure | GPT-5.6 Sol | GPT-6 Sol | Change |
| --- | --- | --- | --- |
| AA Index | 54.6 | 56.7 | +2.1 points |
| DeepSWE v1.1 | 72.3 | 69.0 | −3.2 points |
| Terminal-Bench 4 | 37.4 | 43.4 | +6.1 points |
| SWE-Atlas-QnA | 54.0 | 57.5 | +3.5 points |
| Mean API cost per task | $6.35 | $2.99 | 0.5x |
| Total tokens per task | 10.2 million | 9.8 million | 1.0x |
| Mean harness time per task | 21 minutes | 22 minutes | 1.1x |

OpenAI’s [launch page](https://openai.com/index/introducing-gpt-6-sol-and-luna/) prices GPT-6 Sol at $2 per million input tokens and $10 per million output tokens, against $4 and $20 for GPT-5.6 Sol, and describes the change as “reducing API prices for Sol and Luna by 50% compared with their GPT‑5.6 promotional pricing.” Total tokens per task stayed within a tenth of the earlier row while the listed input and output rates halved. The cost change also depends on the input/output mix and cache use. Artificial Analysis’s launch note reports the same step: “up 2 points from GPT-5.6 Sol (max), with gains in Terminal-Bench 4.0 (43% vs 37%) and SWE-Atlas-QnA (58% vs 54%),” and “At $2.99 per task it costs ~50% less than GPT-5.6 Sol (max).”

## Inside the AA Index

AA Index averages three component benchmarks, and GPT-6 Sol does not sit in the same place on each. On DeepSWE v1.1 it scores 69.0, fifth of 20; on Terminal-Bench 4 it scores 43.4, seventh of 20; and on SWE-Atlas-QnA it scores 57.5, 14th of 20 configurations that carry each score. Its best and worst component ranks are nine places apart.

*Codex · GPT-6 Sol (max) on each AA Index component in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC, ranked among every configuration that carries the component*
| Component | GPT-6 Sol score | Rank | Leader |
| --- | --- | --- | --- |
| DeepSWE v1.1 | 69.0 | 5 of 20 | Muse Code · Muse Spark 1.3 (xhigh) at 73.2 |
| Terminal-Bench 4 | 43.4 | 7 of 20 | Claude Code · Opus 5.5 (max) at 63.1 |
| SWE-Atlas-QnA | 57.5 | 14 of 20 | Claude Code · Opus 5.5 (max) at 66.4 |

No configuration with a lower AA Index scores higher on Terminal-Bench 4, so on this snapshot the composite and the terminal component order GPT-6 Sol the same way against the rows below it.

## On the Intelligence Index, 14th of 97 comparable configurations

GPT-6 Sol (max) scores 47.5 on the Intelligence Index at $1.06 per task in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC, with 31,238 output tokens per task under index version 4.3.2. That is 14th of the 97 comparable configurations, meaning the rows with a measured cost per task, and 10.1 points below the leader, Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) at 57.6 for $5.98.

The row is on this chart’s cost frontier as well, by the same test: no other comparable configuration scores at least as high at the same or lower cost per task. The cheapest configuration that scores higher, Claude Opus 5.5 (Adaptive Reasoning, Medium Effort, Default Fallback), scores 51.2 for $1.34, 1.3x the cost.

Two other configurations score within one index point of GPT-6 Sol (max). The table lists them cheapest first, with each cost as a multiple of its $1.06.

*Configurations within one Intelligence Index point of GPT-6 Sol (max) in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC*
| Configuration | Intelligence Index | Cost per task | Multiple of GPT-6 Sol’s cost | Output tokens per task |
| --- | --- | --- | --- | --- |
| Muse Spark 1.3 (max) | 48.1 | $1.60 | 1.5x | 60,200 |
| Claude Fable 5.1 (Adaptive Reasoning, Low Effort, Default Fallback) | 46.8 | $2.37 | 2.2x | 21,562 |

The snapshot stores five comparable GPT-6 Sol rows with an effort level, one per level. From GPT-6 Sol (low) to GPT-6 Sol (max), the score moves from 33.9 to 47.5 index points and the cost per task from $0.132 to $1.06. The table lists the levels cheapest first and states what each step buys over the level above it. The snapshot also stores GPT-6 Sol (Non-reasoning) at 28.1 for $0.331 per task, a different mode rather than an effort level, so the table leaves it out.

*Comparable GPT-6 Sol effort levels in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC, cheapest first*
| Configuration | Intelligence Index | Cost per task | Output tokens per task | Points over the cheaper level | Cost multiple of the cheaper level |
| --- | --- | --- | --- | --- | --- |
| GPT-6 Sol (low) | 33.9 | $0.132 | 3,358 | - | - |
| GPT-6 Sol (medium) | 39.8 | $0.248 | 6,478 | +5.9 | 1.9x |
| GPT-6 Sol (high) | 42.8 | $0.375 | 10,232 | +3.0 | 1.5x |
| GPT-6 Sol (xhigh) | 44.1 | $0.532 | 16,013 | +1.3 | 1.4x |
| GPT-6 Sol (max) | 47.5 | $1.06 | 31,238 | +3.4 | 2.0x |

The [Artificial Analysis model page](https://artificialanalysis.ai/models/gpt-6-sol), captured September 24, 2026 UTC, lists the model as proprietary, released September 22, 2026, with an index score of 48, an 872k token context window, and 77M output tokens generated to run the whole index.

The summary line under the launch note’s title puts the generation step this way: “Intelligence Index and Coding Agent Index scores remain level with GPT-5.6, with progress in some evaluations and regressions in others.” The note reports that “GPT-6 Sol (max) costs $1.06 per task to run the Artificial Analysis Intelligence Index, ~50% less than GPT-5.6 Sol (max) at $1.99,” and adds: “This is driven by the price cut, as both models use slightly more output tokens per task” (“31k vs 29k for Sol”). Inside the index it records a regression on GDPval-AA v2.1, Artificial Analysis’s benchmark adapted from OpenAI’s dataset of economically valuable tasks and scored on an Elo rating scale, where “Sol drops ~100 Elo points,” and a change in answering behavior on AA-Omniscience, its knowledge and hallucination benchmark: “GPT-6 Sol (max) cuts its hallucination rate from 92% to 60%” because “it attempts 83% of questions vs 99% for GPT-5.6 Sol (max).” Artificial Analysis’s note is the only source here for that step; the Intelligence Index snapshot stores no GPT-5.6 Sol row.

## Why $2.99 and $1.06 are not one unit

The two snapshots print two costs for the same model at the same effort setting: $2.99 per task on the coding-agent chart and $1.06 per task on the Intelligence Index. Both are evaluation averages at list prices, and Artificial Analysis records the same prices behind both, $2.00 per million input tokens and $10.00 per million output tokens with a 90% cache discount. What differs is the task each average covers.

The coding-agent figure is the mean API cost of one task in Codex across the three coding benchmarks, including every tool call and repeated context the harness sends: 9.8 million total tokens per task in this snapshot. The Intelligence Index figure is a weighted average across 10 evaluations under a standardized harness, with 31,238 output tokens per task.

> **Which rows each cost compares with**
>
> $2.99 compares with the other cost-per-task figures on the coding-agent chart, and $1.06 with the other figures on the Intelligence Index chart. A workload of your own has its own token mix and its own cost.

## OpenAI’s own figures

OpenAI’s launch page reports its own run of DeepSWE v1.1 at 68.8% for GPT-6 Sol at max effort, plus vendor-run results on FrontierCode 1.1 Main, AutomationBench 1.0.6, Agents’ Last Exam V1, and OSWorld 2.0, none of which appears on an aicharts chart. OpenAI ran those evaluations in its own environment or through its API and says the competitor figures in its tables come from public reports. The 68.8% and the 69.0 that Artificial Analysis measured in Codex come from separate runs under separate protocols.

## Limits

- The scores and costs in the tables and placement sentences above are Artificial Analysis measurements of Codex · GPT-6 Sol (max) and GPT-6 Sol (max) on the retrieval dates, under DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA on the coding-agent chart and Intelligence Index version 4.3.2 on the capability chart. They say nothing about other tasks, repositories, or harnesses.
- The ranks, frontier positions, neighbor tables, component ranks, effort ladder, and GPT-5.6 Sol multiples are computed from those snapshots by aicharts. A new, removed, or rescored configuration moves them, and both snapshots update daily.
- GPT-6 Sol in Cursor, in another harness, or at a lower Codex effort setting is a configuration the coding-agent snapshot does not store, so this note says nothing about it.
- The GPT-5.6 Sol rows share the harness and setting with the GPT-6 Sol rows, but the snapshots record scores, not run dates; the two generations may have been measured weeks apart under different benchmark versions.
- The 68.8% DeepSWE v1.1 figure, the prices, and the availability statement are OpenAI’s. aicharts did not run GPT-6 Sol.

## See where GPT-6 Sol sits today

Both charts redraw from each day’s snapshot, so the rank and frontier position above can move. The model page lists every GPT-6 Sol row the site holds.

- [Coding-agent chart](https://aicharts.io/coding)
- [Capability and cost chart](https://aicharts.io/#intelligence-index)
- [GPT-6 Sol model page](https://aicharts.io/models/openai/gpt-6-sol/max)

## Sources

- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.
- [LLM Leaderboard](https://artificialanalysis.ai/models). Artificial Analysis, 2026. The public models leaderboard is the source of the aicharts Intelligence Index snapshot. Scores, per-task costs, and output tokens are Artificial Analysis measurements under Intelligence Index v4.3.2.
- [GPT-6 Sol and Luna push the cost efficiency frontier](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier). Artificial Analysis, 2026. Cited for the September 22, 2026 launch note’s summary line, the 57 Coding Agent Index score for GPT-6 Sol (max) in Codex and its two-point step over GPT-5.6 Sol (max), the Terminal-Bench 4.0 and SWE-Atlas-QnA component gains, the Pareto-frontier and cost statements, the $1.06 against $1.99 Intelligence Index cost per task, the 31k against 29k output tokens per task, the GDPval-AA v2.1 regression, and the AA-Omniscience hallucination and attempt rates.
- [GPT-6 Sol (max) - Intelligence, Performance & Price Analysis](https://artificialanalysis.ai/models/gpt-6-sol). Artificial Analysis, 2026. Cited, from the page captured September 24, 2026 UTC, for the 48 index score, the proprietary label, the September 22, 2026 release date, the $2.00 and $10.00 per million token prices with a 90% cache discount, the $1.06 cost per index task, the 77M output tokens across the index, and the 872k token context window.
- [Introducing GPT-6 Sol and Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/). OpenAI, 2026. Cited for the September 22, 2026 release, the ChatGPT Work and Codex availability, the $4 to $2 and $20 to $10 per million token price change and OpenAI’s description of it, and the vendor-run DeepSWE v1.1 result and other vendor benchmarks that this site does not chart.

## Related analysis

- [Grok 4.7 reaches 56 on AA Index inside Grok Build](https://aicharts.io/blog/grok-4-7-coding-agent-index)
- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
