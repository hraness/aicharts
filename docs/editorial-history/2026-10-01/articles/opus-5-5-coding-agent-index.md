# Opus 5.5 tops the coding-agent chart at 66.0 and $13.04 a task

Claude Code · Opus 5.5 (max) scores 66.0 on AA Index at $13.04 per task, first of 20 configurations and the costliest row. The next frontier point down gives up 3.8 points for 95% of the cost.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

In the aicharts coding-agent snapshot retrieved Sep 25, 2026, 2:39 PM UTC, Claude Code · Opus 5.5 (max) scores 66.0 on AA Index at a mean API cost of $13.04 per task, first of the 20 configurations that carry an index and the highest cost per task on the chart. The nearest cost-frontier configuration below it, Claude Code · Fable 5.1 (with fallback) (max), gives up 3.8 points for 95% of the cost. Anthropic [released Claude Opus 5.5](https://www.anthropic.com/news/claude-opus-5-5) on September 22, 2026, and Artificial Analysis added the Claude Code row to its coding-agents comparison afterwards. The snapshot’s update log records the row on September 25, 2026.

## One model inside one harness, scored on three benchmarks

The [coding-agent chart](/coding) is a daily snapshot of the public [Artificial Analysis coding-agents comparison](https://artificialanalysis.ai/agents/coding-agents/). Each row is one configuration: a model, the agent harness that ran it, and an effort setting. Artificial Analysis runs the harness on tasks from three coding benchmarks, DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA, and AA Index is the mean of the three scores. The cost is the mean API bill for one task in that harness at list prices, including every tool call and every repeated read of the repository the harness sends.

Claude Opus 5.5’s row is the model inside Claude Code, Anthropic’s own coding agent, at the max setting. One task in that configuration used 15.6 million tokens and took 64 minutes of harness time on average. The same model in another harness, or at another setting, would be another row; the snapshot stores one configuration running Claude Opus 5.5.

## First of 20 configurations, at the chart’s highest cost

The 66.0 places Claude Code · Opus 5.5 (max) first of the 20 configurations that carry an AA Index in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC. No configuration scores higher. Its $13.04 per task is also the highest cost of the 20 configurations that carry a cost, so the row sits at the top right of the chart as both the highest-scoring configuration and the most expensive to run one task through.

The nearest score below it is Claude Code · Fable 5.1 (with fallback) (max) at 62.2, 3.8 points lower for 95% of the Opus 5.5 row’s cost. The table lists the four highest-scoring configurations after it, with each cost as a share of its $13.04.

*The four highest-scoring configurations after Claude Code · Opus 5.5 (max) in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Configuration | Setting | AA Index | Cost per task | Points below Opus 5.5 | Share of Opus 5.5’s cost |
| --- | --- | --- | --- | --- | --- |
| Claude Code · Fable 5.1 (with fallback) | max | 62.2 | $12.39 | 3.8 points | 95% |
| Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium | default | 61.7 | $7.90 | 4.3 points | 61% |
| Codex · GPT-6 Astra | max | 61.6 | $7.47 | 4.3 points | 57% |
| Claude Code · Opus 5 | max | 59.7 | $10.79 | 6.3 points | 83% |

## What stepping down the cost frontier gives up

The chart’s cost frontier contains configurations for which no other row costs no more and scores at least as high, with a strict improvement in either measure. Claude Code · Opus 5.5 (max) is on it, at the frontier’s highest score. When configurations tie for that score, a cheaper tied row dominates a more expensive one. The question the frontier answers is what a reader gives up by stepping down from the top score to a cheaper row that nothing dominates.

The first step down is Claude Code · Fable 5.1 (with fallback) (max): 3.8 points lower for 95% of the $13.04. The first vertex at half the cost or less is Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium (default), which gives up 7.1 points for 35% of the cost. The frontier ends at Codex · DeepSeek V4 Flash 0731 (max): 27.2 points lower for 0.7% of the cost.

*Cost-frontier configurations below Claude Code · Opus 5.5 (max) in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC, highest AA Index first*
| Configuration | Setting | AA Index | Cost per task | Points below Opus 5.5 | Share of Opus 5.5’s cost |
| --- | --- | --- | --- | --- | --- |
| Claude Code · Fable 5.1 (with fallback) | max | 62.2 | $12.39 | 3.8 points | 95% |
| Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium | default | 61.7 | $7.90 | 4.3 points | 61% |
| Codex · GPT-6 Astra | max | 61.6 | $7.47 | 4.3 points | 57% |
| Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium | default | 58.9 | $4.54 | 7.1 points | 35% |
| Codex · GPT-6 Sol | max | 56.7 | $2.99 | 9.3 points | 23% |
| Codex · GPT-5.6 Luna | max | 43.2 | $0.438 | 22.8 points | 3.4% |
| Codex · DeepSeek V4 Pro 0813 | max | 43.1 | $0.238 | 22.9 points | 1.8% |
| Codex · GPT-6 Luna | max | 41.1 | $0.176 | 24.9 points | 1.3% |
| Codex · DeepSeek V4 Flash 0731 | max | 38.7 | $0.085 | 27.2 points | 0.7% |

## Terminal-Bench 4 and SWE-Atlas-QnA carry the lead

AA Index is the mean of three component benchmarks, and the Opus 5.5 row does not lead all three. On DeepSWE v1.1 it scores 68.4, sixth of 20; on Terminal-Bench 4 it scores 63.1, first of 20; and on SWE-Atlas-QnA it scores 66.4, first of 20 configurations that carry each score.

It leads Terminal-Bench 4 by 5.6 points over Claude Code · Fable 5.1 (with fallback) (max) and SWE-Atlas-QnA by 0.3 points over Kimi Code CLI · Kimi K3 (default). Muse Code · Muse Spark 1.3 (xhigh) scores 4.7 points higher on DeepSWE v1.1. The composite lead is a Terminal-Bench 4 and SWE-Atlas-QnA lead that the DeepSWE v1.1 gap does not cancel.

*Claude Code · Opus 5.5 (max) on each AA Index component in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC, against the best other configuration that carries the component*
| Component | Opus 5.5 score | Rank | Best other configuration | Gap |
| --- | --- | --- | --- | --- |
| DeepSWE v1.1 | 68.4 | 6 of 20 | Muse Code · Muse Spark 1.3 (xhigh) at 73.2 | −4.7 points |
| Terminal-Bench 4 | 63.1 | 1 of 20 | Claude Code · Fable 5.1 (with fallback) (max) at 57.6 | +5.6 points |
| SWE-Atlas-QnA | 66.4 | 1 of 20 | Kimi Code CLI · Kimi K3 (default) at 66.1 | +0.3 points |

Every configuration with a lower AA Index also scores lower on Terminal-Bench 4, so a reader who cares only about terminal work orders the top of this chart the same way the composite does.

## Opus 5 to Opus 5.5 at the same setting

The snapshot stores the previous Opus generation in the same harness at the same setting: Claude Code · Opus 5 (max) at 59.7 for $10.79 per task. Opus 5.5 adds 6.3 points at 1.2x the mean cost per task, 1.4x the total tokens per task, and 1.5x the mean time per task.

*Claude Code · Opus 5 and Claude Code · Opus 5.5 at the max setting in the snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Measure | Opus 5 | Opus 5.5 | Change |
| --- | --- | --- | --- |
| AA Index | 59.7 | 66.0 | +6.3 points |
| DeepSWE v1.1 | 62.5 | 68.4 | +5.9 points |
| Terminal-Bench 4 | 54.5 | 63.1 | +8.6 points |
| SWE-Atlas-QnA | 62.1 | 66.4 | +4.3 points |
| Mean API cost per task | $10.79 | $13.04 | 1.2x |
| Total tokens per task | 11.4 million | 15.6 million | 1.4x |
| Mean time per task | 42 minutes | 64 minutes | 1.5x |

Anthropic’s [announcement](https://www.anthropic.com/news/claude-opus-5-5) prices Claude Opus 5.5 at $4 per million input tokens and $20 per million output tokens, against $5 and $25 for Opus 5, and opens with the claim that “It performs at the level of Claude Fable 5.1 on most work and costs 40% less to run than Opus 5.” In this Claude Code comparison, mean task cost rose to 1.2x as much and total tokens to 1.4x as many. Task cost depends on token volume, the input/output mix, and caching as well as listed rates. Anthropic’s 40% figure is its running-cost claim; the quoted input and output prices alone fell by 20%. The separate workloads do not isolate why the measured task costs differ.

## The Intelligence Index row is a different measurement

The [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/models) runs the model through its API under one harness that is the same for every model, across 10 evaluations at version 4.3.2, and its cost per task is the average bill for one of those evaluation tasks. In the snapshot retrieved Sep 23, 2026, 1:38 PM UTC, Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) scores 57.6 at $5.98 per task, first of 97 configurations with a measured cost. The [Intelligence Index note](/blog/opus-5-5-intelligence-index) walks that chart’s frontier and the model’s effort levels.

*Claude Opus 5.5 at max effort in the two aicharts snapshots, each on its own task set with its own cost definition*
| Chart | Configuration | Score | Cost per task | Snapshot retrieved |
| --- | --- | --- | --- | --- |
| Coding agents (AA Index) | Claude Code · Opus 5.5 (max) | 66.0 | $13.04 | Sep 25, 2026, 2:39 PM UTC |
| Intelligence Index | Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) | 57.6 | $5.98 | Sep 23, 2026, 1:38 PM UTC |

The 66.0 is a mean of three coding benchmarks run inside Claude Code, and the 57.6 is a weighted average of 10 evaluations run through the API. The $13.04 includes every tool call and every repeated read of the repository that the harness sends, 15.6 million tokens per task in this snapshot; the $5.98 is the average bill for one evaluation task under Artificial Analysis’s standardized harness, with 119,166 output tokens per task. Artificial Analysis’s [model page](https://artificialanalysis.ai/models/claude-opus-5-5), captured September 25, 2026 UTC, lists the same list prices behind both figures, $4.00 per million input tokens and $20.00 per million output tokens with a 95% cache discount.

> **Two charts, two units**
>
> Compare 66.0 and $13.04 with the other rows on the coding-agent chart, and 57.6 and $5.98 with the other rows on the Intelligence Index chart. Adding, averaging, or ranking the two scores together produces a number neither chart measures.

## Anthropic’s own Terminal-Bench figure

Anthropic’s announcement reports its own Terminal-Bench 4.0 run at 66.4% at xhigh effort, alongside FrontierCode v1.1 (Main), CursorBench 4.0, GDPval-AA v2.1, AutomationBench, Humanity’s Last Exam, Terminal-Bench-Science 0.1, OSWorld 2.0, and Chartography, none of which appears on an aicharts chart. The 63.1 that Artificial Analysis measured for Claude Code · Opus 5.5 (max) comes from a different run, a different effort setting, and Artificial Analysis’s protocol inside Claude Code, so the two figures describe two evaluations of the model rather than one result reported twice. Anthropic also writes that “at these levels of capability we’ve found that benchmark margins have become a less reliable guide to real-world differences.”

## Limits

- The chart scores, task costs, token counts, and durations are Artificial Analysis measurements of the named configuration on the retrieval date, under DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA for the coding-agent chart and Intelligence Index version 4.3.2 for the capability chart. None of them establishes a result on other repositories, tasks, or harnesses.
- The rank, cost rank, frontier steps, component gaps, and Opus 5 multiples are aicharts derivations from the snapshots named in each caption. A configuration added, removed, or rescored by Artificial Analysis moves them, and the coding-agent snapshot advances daily.
- Claude Opus 5.5 in Cursor, Devin, or any harness other than Claude Code, or at a setting other than max, is a configuration this snapshot does not store, so this note says nothing about it.
- The Opus 5 comparison holds the harness and setting fixed, but the snapshot records outcomes, not run dates or benchmark versions at run time; Artificial Analysis may have measured the two generations weeks apart.
- The prices, the cost claim against Opus 5, and the vendor-run benchmark figures belong to Anthropic. aicharts did not run Claude Opus 5.5.

## See where the row sits today

The coding-agent chart redraws from each day’s snapshot, so the rank, cost rank, and frontier steps above can move. The model page lists every Claude Opus 5.5 row the site holds, and the data page serves the snapshot itself.

- [Coding-agent chart](https://aicharts.io/coding)
- [Claude Opus 5.5 model page](https://aicharts.io/models/anthropic/claude-opus-5.5/max)
- [Snapshot data](https://aicharts.io/data)

## Sources

- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.
- [Introducing Claude Opus 5.5](https://www.anthropic.com/news/claude-opus-5-5). Anthropic, 2026. Cited for the September 22, 2026 release, the $4 and $20 per million token prices against $5 and $25 for Opus 5, the $0.20 cache-read price, the 40% cost claim against Opus 5, medium as the default effort level, the max-effort setting behind Anthropic’s benchmark table, the statement that thinking can no longer be switched off, the safeguard fallback sentence, and the vendor-run benchmark table that this site does not chart.
- [LLM Leaderboard](https://artificialanalysis.ai/models). Artificial Analysis, 2026. The public models leaderboard is the source of the aicharts Intelligence Index snapshot. Scores, per-task costs, and output tokens are Artificial Analysis measurements under Intelligence Index v4.3.2.
- [Claude Opus 5.5 (max with fallback) - Intelligence, Performance & Price Analysis](https://artificialanalysis.ai/models/claude-opus-5-5). Artificial Analysis, 2026. Cited, from the page captured September 25, 2026 UTC, for the 58 index score, the proprietary label, the September 22, 2026 release date, the $4.00 and $20.00 per million token prices with a 95% cache discount based on Anthropic’s API, the $5.98 cost per index task, the 260M output tokens across the index, the 1M token context window, and its summary and verbosity sentences.

## Related analysis

- [Claude Opus 5.5 leads the Intelligence Index at 57.6 for $5.98](https://aicharts.io/blog/opus-5-5-intelligence-index)
- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
