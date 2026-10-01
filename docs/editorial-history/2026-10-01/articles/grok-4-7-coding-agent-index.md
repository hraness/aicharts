# Grok 4.7 reaches 56 on AA Index inside Grok Build

In the snapshots shown below, Grok Build · Grok 4.7 (xhigh) scores 56 on the coding-agent AA Index and Grok 4.7 (xhigh) scores 46 on the Intelligence Index. Different harnesses, task sets, and costs sit behind the two numbers, and cheaper configurations score higher on both charts.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

xAI, which its own launch page and Artificial Analysis now call SpaceXAI, [announced Grok 4.7](https://x.ai/news/grok-4-7) on September 21, 2026 as “our most capable model for coding and knowledge work,” priced at $2 per million input tokens and $6 per million output tokens, and available the same day in Cursor and Grok Build, its own coding agent. Artificial Analysis published its independent measurements the same day, and aicharts now stores Grok 4.7 in two checked snapshots: the coding-agent chart and the Intelligence Index chart.

## Two charts, two measurements

The [coding-agent chart](/coding) is a checked snapshot of the public [Artificial Analysis coding-agents comparison](https://artificialanalysis.ai/agents/coding-agents/). Each row is one configuration: a model, the agent harness that ran it, and an effort setting, scored on DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA. AA Index is the composite of those three, and cost is the mean API cost of one task in that harness. Grok 4.7’s row is Grok Build · Grok 4.7 at the xhigh setting, with Grok Build being xAI’s first-party coding agent.

The [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/models) measures a model behind an API under one standardized harness across 10 evaluations, weighted 30% agents, 20% coding, 20% scientific reasoning, and 30% general capability, at version 4.3.2. Its Grok 4.7 row is Grok 4.7 (xhigh), the effort Artificial Analysis chose for its headline evaluation. Its launch note draws the boundary itself: “They are separate from the Intelligence Index results, which standardize the evaluation harness used across models.”

*Grok 4.7 in the two aicharts snapshots. Each score belongs to its own chart, task set, and cost definition.*
| Chart | Configuration | Score | Cost per task | Snapshot retrieved |
| --- | --- | --- | --- | --- |
| Coding agents (AA Index) | Grok Build · Grok 4.7 (xhigh) | 56.3 | $8.82 | Sep 25, 2026, 2:39 PM UTC |
| Intelligence Index | Grok 4.7 (xhigh) | 46.4 | $3.74 | Sep 23, 2026, 1:38 PM UTC |

## Where the coding-agent row lands

In the coding-agent snapshot retrieved Sep 25, 2026, 2:39 PM UTC, Grok Build · Grok 4.7 (xhigh) scores 56.3 on AA Index at a mean API cost of $8.82 per task. That is eighth of the 20 configurations that carry an index. Seven configurations score higher: Claude Code · Opus 5.5 (max) at 66.0, Claude Code · Fable 5.1 (with fallback) (max) at 62.2, Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium (default) at 61.7, Codex · GPT-6 Astra (max) at 61.6, Claude Code · Opus 5 (max) at 59.7, Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium (default) at 58.9, and Codex · GPT-6 Sol (max) at 56.7. The leader, Claude Code · Opus 5.5 (max), is 9.7 points above it at $13.04 per task.

It is not on the chart’s cost frontier. Four configurations cost the same or less per task and score at least as high, so the chart draws its frontier past the Grok 4.7 row. The table lists them cheapest first.

*Configurations that cost no more than Grok Build · Grok 4.7 (xhigh) and score at least as high on AA Index, in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Configuration | Setting | AA Index | Cost per task |
| --- | --- | --- | --- |
| Codex · GPT-6 Sol | max | 56.7 | $2.99 |
| Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium | default | 58.9 | $4.54 |
| Codex · GPT-6 Astra | max | 61.6 | $7.47 |
| Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium | default | 61.7 | $7.90 |

Artificial Analysis’s [launch note](https://artificialanalysis.ai/articles/benchmarking-grok-4-7) of September 21, 2026 placed Grok Build with Grok 4.7 “4th, behind only Claude Fable 5.1, GPT-6 Astra, and Claude Opus 5” among models run in their own harnesses, and said it had overtaken GPT-5.6 Sol. The snapshot’s update log records Claude Code · Opus 5.5 (max) added on September 25, 2026 and Codex · GPT-6 Sol (max) added on September 23, 2026, after that note. Rankings on this chart move whenever Artificial Analysis publishes a new configuration, and the chart counts every harness, including multi-model pairings.

## The index hides a split between its components

AA Index averages three component benchmarks, and the average hides how differently Grok 4.7 does on them. On DeepSWE v1.1 it scores 72.6, second of 20; on Terminal-Bench 4 it scores 33.3, 10th of 20; and on SWE-Atlas-QnA it scores 62.9, fifth of 20 configurations that carry each score.

*Grok Build · Grok 4.7 (xhigh) on each AA Index component in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC. Rank counts every configuration that carries the component.*
| Component | Grok 4.7 score | Rank | Leader |
| --- | --- | --- | --- |
| DeepSWE v1.1 | 72.6 | 2 of 20 | Muse Code · Muse Spark 1.3 (xhigh) at 73.2 |
| Terminal-Bench 4 | 33.3 | 10 of 20 | Claude Code · Opus 5.5 (max) at 63.1 |
| SWE-Atlas-QnA | 62.9 | 5 of 20 | Claude Code · Opus 5.5 (max) at 66.4 |

Two configurations with a lower AA Index score higher on Terminal-Bench 4: Codex · GPT-5.6 Sol (max) at 37.4 and Opencode · GLM-5.3 (default) at 39.9. A reader who cares about terminal work would order these rows differently from the composite.

Artificial Analysis’s launch note reports the same shape for the generation step: “DeepSWE v1.1 rises from 65% to 73%, Terminal-Bench 4.0 from 18% to 33%, and SWE-Atlas-QnA from 58% to 63%.” Terminal-Bench 4 moved the most in points and remains the lowest of the three.

## From Grok 4.6 to Grok 4.7 in the same harness

The snapshot stores the previous generation in the same harness at the same setting: Grok Build · Grok 4.6 (xhigh) at 47.0 for $3.57 per task. Grok 4.7 adds 9.3 index points at 2.5x the mean cost per task and 2.6x the total tokens per task.

*Grok Build · Grok 4.6 and Grok Build · Grok 4.7 at the xhigh setting in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Measure | Grok 4.6 | Grok 4.7 | Change |
| --- | --- | --- | --- |
| AA Index | 47.0 | 56.3 | +9.3 points |
| DeepSWE v1.1 | 64.9 | 72.6 | +7.7 points |
| Terminal-Bench 4 | 17.7 | 33.3 | +15.7 points |
| SWE-Atlas-QnA | 58.3 | 62.9 | +4.6 points |
| Mean API cost per task | $3.57 | $8.82 | 2.5x |
| Total tokens per task | 5.5 million | 14.3 million | 2.6x |
| Mean active time per task | 19 minutes | 39 minutes | 2.0x |

xAI’s launch page says the model is “Served at the same price and speed as Grok 4.6,” and Artificial Analysis records the same $2.00 and $6.00 per million token prices for both generations. Task cost depends on token use and the mix of input, output, and cached tokens.

## Where the Intelligence Index row lands

In the Intelligence Index snapshot retrieved Sep 23, 2026, 1:38 PM UTC, Grok 4.7 (xhigh) scores 46.4 at $3.74 per task and used 80,561 output tokens per task, under index version 4.3.2. That is 16th of the 97 comparable configurations, and 11.2 points below the leader, Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) at 57.6 for $5.98.

It is not on the cost frontier: 11 configurations score at least as high at the same or lower cost per task. The cheapest configuration that scores higher, GPT-6 Sol (max), scores 47.5 for $1.06, 0.3x the cost.

Four other configurations score within one index point of Grok 4.7 (xhigh). The table lists them cheapest first, with each cost as a multiple of its $3.74.

*Configurations within one Intelligence Index point of Grok 4.7 (xhigh) in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC*
| Configuration | Intelligence Index | Cost per task | Multiple of Grok 4.7’s cost | Output tokens per task |
| --- | --- | --- | --- | --- |
| MiMo-V2.6-Pro | 46.3 | $0.133 | 0.04x | 64,276 |
| GPT-6 Astra (low) | 45.8 | $0.818 | 0.2x | 4,433 |
| Claude Fable 5.1 (Adaptive Reasoning, Low Effort, Default Fallback) | 46.8 | $2.37 | 0.6x | 21,562 |
| Grok 4.7 (high) | 46.3 | $2.73 | 0.7x | 65,901 |

The snapshot also stores Grok 4.7 (high) at 46.3 for $2.73 per task, so the xhigh setting buys +0.1 points for 1.4x the cost. Artificial Analysis evaluated the model at xhigh for its headline score and notes that the gains “come with higher token usage”: about 81k output tokens per Intelligence Index task against 36k for Grok 4.6 (high), and about 7.1 minutes per task.

The [Artificial Analysis model page](https://artificialanalysis.ai/models/grok-4-7), captured September 23, 2026 UTC, lists the model as proprietary, released September 21, 2026, with an index score of 46, a 500k token context window, an output speed of 39.3 tokens per second on xAI’s API, and 240M output tokens generated to run the whole index, which the page calls very verbose for its class. The launch note puts the generation step at +2 points over Grok 4.6, led by agentic knowledge-work tasks, with the other index tasks broadly matching Grok 4.6 (high).

## Two costs that are not one unit

The two snapshots print two costs for the same model at the same effort: $8.82 per task on the coding-agent chart and $3.74 per task on the Intelligence Index. Both are evaluation averages at list prices, and Artificial Analysis records the same list prices behind both, $2.00 per million input tokens and $6.00 per million output tokens with a 75% cache discount. The difference is the task.

The coding-agent figure is the mean API cost of one task in Grok Build across the three coding benchmarks, including every tool call and repeated context the harness sends: 14.3 million total tokens per task in this snapshot. The Intelligence Index figure is a weighted average across 10 evaluations under a standardized harness, with 80,561 output tokens per task. Neither is a subscription price, a Cursor plan, or an invoice for a workload.

> **How to compare costs**
>
> Compare $8.82 with other rows on the coding-agent chart and $3.74 with other rows on the Intelligence Index chart. Do not compare the two with each other, and do not read either as the price of running Grok 4.7 on your own tasks.

## What xAI’s own table adds

xAI’s launch page prints a vendor-run table for Grok 4.7 at xhigh against Grok 4.6, GPT-5.6 Sol, and Claude Fable 5.1 on CursorBench 4.0, EEBench, the Harvey Legal Agent Benchmark, and HealthBench Professional, none of which appears on an aicharts chart, plus its own runs of DeepSWE v1.1 (71.0%, marked as high effort) and Terminal-Bench 4.0 (37.6%). Those figures come from xAI’s evaluation setup, not from Grok Build under Artificial Analysis’s protocol, and they do not match the Grok Build row in the snapshot. Read them as the vendor’s description of its model and read the charts for independent measurements of one named configuration.

## Limits

- The chart scores and task costs are Artificial Analysis measurements of the named configuration on the retrieval date, under DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA for the coding-agent chart and Intelligence Index version 4.3.2 for the capability chart. Neither establishes results on other tasks, repositories, or harnesses.
- Ranks, frontier positions, dominators, neighbors, and generation multiples are aicharts derivations from the snapshots named in each caption. They change when Artificial Analysis adds, removes, or rescores a configuration, and the checked snapshots advance daily.
- The coding-agent row measures Grok 4.7 inside Grok Build. The same model in another harness, including Cursor, is a different configuration that this snapshot does not store.
- The Grok 4.6 comparison holds the harness and setting fixed, but Artificial Analysis may have run the two generations weeks apart under evolving benchmark versions and prices; the snapshot records outcomes, not run dates.
- xAI’s table, price statements, and capability claims belong to xAI. aicharts did not run Grok 4.7 and did not verify the vendor figures.

## Compare Grok 4.7 on both charts

The coding-agent chart plots every model, harness, and setting configuration in the current snapshot with its cost frontier. The capability and cost chart plots the comparable Intelligence Index cohort. The model page collects Grok 4.7’s rows from both.

- [Coding-agent chart](https://aicharts.io/coding)
- [Capability and cost chart](https://aicharts.io/#intelligence-index)
- [Grok 4.7 model page](https://aicharts.io/models/spacexai/grok-4.7/xhigh)

## Sources

- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.
- [LLM Leaderboard](https://artificialanalysis.ai/models). Artificial Analysis, 2026. The public models leaderboard is the source of the aicharts Intelligence Index snapshot. Scores, per-task costs, and output tokens are Artificial Analysis measurements under Intelligence Index v4.3.2.
- [Benchmarking Grok 4.7](https://artificialanalysis.ai/articles/benchmarking-grok-4-7). Artificial Analysis, 2026. The September 21, 2026 launch note reports the 47 to 56 Coding Agent Index step for Grok Build, the native-harness rank claim, the three component gains, the 81k output tokens per Intelligence Index task, the +2 point Intelligence Index gain, and the statement that Grok Build results are separate from the standardized Intelligence Index harness.
- [Grok 4.7 (xhigh): Intelligence, Performance & Price Analysis](https://artificialanalysis.ai/models/grok-4-7). Artificial Analysis, 2026. The model page captured September 23, 2026 UTC reports the 46 index score, the proprietary label, the September 21, 2026 release date, the $2.00 and $6.00 per million token prices with a 75% cache discount, the $3.74 cost per index task, the 39.3 tokens per second output speed, the 240M output tokens across the index, and the 500k token context window.
- [Introducing Grok 4.7](https://x.ai/news/grok-4-7). SpaceXAI, 2026. The September 21, 2026 launch page reports xAI’s description of the model, the $2 and $6 per million token prices, the same-price-as-Grok-4.6 statement, the Cursor and Grok Build availability, and a vendor-run benchmark table that this site does not chart.

## Related analysis

- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
- [MiMo-V2.6-Pro pairs a 46.3 score with $0.133 per task](https://aicharts.io/blog/mimo-v2-6-pro-cost-frontier)
