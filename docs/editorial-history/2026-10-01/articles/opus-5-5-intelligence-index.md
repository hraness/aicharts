# Claude Opus 5.5 leads the Intelligence Index at 57.6 for $5.98

Claude Opus 5.5 at max effort scores 57.6 on the Intelligence Index at $5.98 per task, first of 97 configurations. The four highest points on the cost frontier are all its effort levels.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

Anthropic [released Claude Opus 5.5](https://www.anthropic.com/news/claude-opus-5-5) on September 22, 2026. In the Intelligence Index snapshot retrieved Sep 23, 2026, 1:38 PM UTC, Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) scores 57.6 at $5.98 per task, first of the 97 comparable configurations, meaning the rows with a measured cost per task, and on the chart’s cost frontier. The four lower effort levels of the same model score 56.0, 53.6, 51.2, and 42.3. Walking the cost frontier down from the top, the first four points are all Claude Opus 5.5 rows. The coding-agent chart stores one configuration running Claude Opus 5.5, scored on three coding benchmarks inside a harness rather than on the Intelligence Index.

## One configuration, 10 evaluations

The [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/models) runs a model through its API under one harness that is the same for every model, across 10 evaluations weighted 30% agents, 20% coding, 20% scientific reasoning, and 30% general capability, at version 4.3.2. The evaluations are AA-Briefcase v1.1, GDPval-AA v2.1, AutomationBench-AA, Terminal-Bench 4.0, SciCode, Humanity's Last Exam, GDP.pdf, CritPt, AA-Omniscience, and AA-LCR v1.1. Cost per task is the weighted average API bill for one task across those evaluations, split into input-side cost (non-cached input, cache reads, and cache writes) and output-side cost (reasoning and answer tokens).

A row on the chart is one configuration: the model at one effort level with the settings Artificial Analysis names in the row. The Claude Opus 5.5 rows share the phrases Adaptive Reasoning and Default Fallback and differ in effort level. The snapshot records the effort level and does not define the other two phrases, so this note does not interpret them.

## First of 97 comparable configurations

The 57.6 places Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) first of the 97 comparable configurations in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC. No configuration scores higher. The row is on the chart’s cost frontier: no comparable configuration scores at least as high at the same or lower cost per task.

No other configuration scores within one index point of it. The nearest score below is Claude Opus 5.5 (Adaptive Reasoning, Xhigh Effort, Default Fallback) at 56.0, 1.6 points lower for 0.6x the cost per task.

The table lists the five highest-scoring configurations after it, with each cost as a multiple of its $5.98. Two of the five are Claude Opus 5.5 at a lower effort level. The highest-scoring configuration from another model is Claude Fable 5.1 (Adaptive Reasoning, Max Effort, Default Fallback) at 53.4, 4.3 points below at 1.3x the cost per task.

*The five highest-scoring comparable configurations after Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC*
| Configuration | Intelligence Index | Cost per task | Points below Claude Opus 5.5 (max) | Multiple of its cost |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 (Adaptive Reasoning, Xhigh Effort, Default Fallback) | 56.0 | $3.46 | 1.6 points | 0.6x |
| Claude Opus 5.5 (Adaptive Reasoning, High Effort, Default Fallback) | 53.6 | $1.82 | 4.0 points | 0.3x |
| Claude Fable 5.1 (Adaptive Reasoning, Max Effort, Default Fallback) | 53.4 | $7.63 | 4.3 points | 1.3x |
| Claude Fable 5.1 (Adaptive Reasoning, Xhigh Effort, Default Fallback) | 53.2 | $5.98 | 4.4 points | 1.0x |
| GPT-6 Astra (max) | 52.7 | $3.26 | 4.9 points | 0.5x |

Walking the cost frontier down from its highest-scoring point, the first four points are Claude Opus 5.5 rows: max, xhigh, high, and medium. The first frontier point from another model is GPT-6 Sol (max) at 47.5 for $1.06 per task, so every frontier point that costs more than $1.06 per task is a Claude Opus 5.5 row.

## Five effort levels of one model

The snapshot stores five comparable Claude Opus 5.5 rows with an effort level, one per level, and no row without one. From low to max, the score moves from 42.3 to 57.6 index points and the cost per task from $0.551 to $5.98. The table lists the levels cheapest first and states what each step buys over the level below it.

*Comparable Claude Opus 5.5 effort levels in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC, cheapest first*
| Effort level | Intelligence Index | Cost per task | Output tokens per task | Reasoning share of output tokens | Points over the level below | Cost multiple of the level below |
| --- | --- | --- | --- | --- | --- | --- |
| low | 42.3 | $0.551 | 10,151 | 33% | - | - |
| medium | 51.2 | $1.34 | 25,745 | 45% | +8.9 | 2.4x |
| high | 53.6 | $1.82 | 35,584 | 51% | +2.3 | 1.4x |
| xhigh | 56.0 | $3.46 | 65,667 | 61% | +2.4 | 1.9x |
| max | 57.6 | $5.98 | 119,166 | 70% | +1.6 | 1.7x |

The largest step is from low to medium: +8.9 points at 2.4x the cost per task. The last step, from xhigh to max, adds 1.6 points at 1.7x the cost per task. At max, the model writes 119,166 output tokens per task and 70% of them are reasoning tokens; the share runs from 33% to 70% across the five levels.

Anthropic’s [announcement](https://www.anthropic.com/news/claude-opus-5-5) names medium as the default effort level. In the snapshot the medium row scores 51.2 for $1.34 per task, 6.4 points below max at 0.2x its cost. The snapshot dates the max row September 22, 2026 and the low, medium, high, and xhigh rows September 17, 2026. The snapshot stores no Opus 5.5 row without an effort level, and Anthropic’s announcement states that the model is no longer offered with thinking switched off.

## Where the $5.98 goes

Of the $5.98 per task at max, $3.60 is input-side cost and $2.38 is output. Largest component first, the five parts are cache reads at $2.42, reasoning tokens at $1.68, cache writes at $1.07, answer tokens at $0.705, and non-cached input at $0.103. Cache reads are 41% of the total. Input-side cost is 60% of the total at max and stays between 60% and 63% across the five levels, while the reasoning share of output tokens moves from 33% to 70%.

*Cost per task by component for each comparable Claude Opus 5.5 effort level in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC, cheapest first*
| Effort level | Input cost | Of which cache reads | Output cost | Of which reasoning tokens | Input share of total |
| --- | --- | --- | --- | --- | --- |
| low | $0.348 | $0.120 | $0.203 | $0.068 | 63% |
| medium | $0.821 | $0.410 | $0.515 | $0.234 | 61% |
| high | $1.11 | $0.604 | $0.712 | $0.365 | 61% |
| xhigh | $2.15 | $1.37 | $1.31 | $0.806 | 62% |
| max | $3.60 | $2.42 | $2.38 | $1.68 | 60% |

Artificial Analysis’s [model page](https://artificialanalysis.ai/models/claude-opus-5-5), captured September 25, 2026 UTC, lists the prices behind these figures as $4.00 per million input tokens and $20.00 per million output tokens with a 95% cache discount, based on Anthropic’s API, and rounds the row to an index score of 58 at $5.98 per task. It records 260M output tokens to run the whole index, which it calls “very verbose in comparison to the median of 88M,” lists the model as proprietary with a 1M token context window, released September 22, 2026, and sums the row up as “amongst the leading models in intelligence, but somewhat expensive when comparing to other models of similar price.”

## Anthropic’s prices and claims

Anthropic’s [announcement](https://www.anthropic.com/news/claude-opus-5-5) of September 22, 2026 opens with the claim that “It performs at the level of Claude Fable 5.1 on most work and costs 40% less to run than Opus 5.” It prices the model at $4 per million input tokens and $20 per million output tokens, against $5 and $25 for Opus 5, and says that “Cache reads (which make up the majority of agentic and coding work costs) are $0.20 per million tokens, 60% less than Opus 5.” In the snapshot’s max row, cache reads are $2.42 of the $5.98 per task. Developers reach the model on the Claude Platform as *claude-opus-5-5*.

The announcement reports Anthropic’s own runs: Terminal-Bench 4.0 at 66.4% at xhigh effort, plus FrontierCode v1.1 (Main), CursorBench 4.0, GDPval-AA v2.1, AutomationBench, Humanity’s Last Exam, Terminal-Bench-Science 0.1, OSWorld 2.0, and Chartography. None of those figures appears on an aicharts chart. Anthropic states that “Unless otherwise noted, all Claude Opus 5.5 results use adaptive thinking at max effort,” and adds that “at these levels of capability we’ve found that benchmark margins have become a less reliable guide to real-world differences.” Terminal-Bench 4.0 and GDPval-AA v2.1 are also two of the 10 evaluations inside the Intelligence Index, where Artificial Analysis runs them under its own harness; the snapshot stores the composite score, not the per-evaluation results, so the 66.4% cannot be checked against it here.

Anthropic also writes that “Opus 5.5 is the first Opus model to launch with a similar class of safeguards to Fable 5.1 on cybersecurity, biology, and distillation, all of which fall back to another model transparently.” The snapshot names each Opus 5.5 row with the phrase Default Fallback and records nothing else about that setting, and the model page does not define it, so whether the two describe the same behavior is not something either source states.

## Claude Code · Opus 5 is a different model on a different chart

The [coding-agent chart](/coding) is a daily snapshot of the public [Artificial Analysis coding-agents comparison](https://artificialanalysis.ai/agents/coding-agents/). A row on it is a model running inside a named agent harness at one effort setting, and its AA Index averages three coding benchmarks: DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA. Its cost is the mean API bill for one task in that harness, including every tool call and repeated context the harness sends.

The coding-agent snapshot retrieved Sep 25, 2026, 2:39 PM UTC stores one configuration that runs Claude Opus 5.5: Claude Code · Opus 5.5 (max) at 66.0 on AA Index for $13.04 per task. It also stores the previous generation, Claude Code · Opus 5 (max), at 59.7 for $10.79 per task.

*The Intelligence Index row and a previous-generation coding-agent row, each scored on its own task set with its own cost definition*
| Chart | Configuration | Model generation | Score | Cost per task | Snapshot retrieved |
| --- | --- | --- | --- | --- | --- |
| Intelligence Index | Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) | Claude Opus 5.5 | 57.6 | $5.98 | Sep 23, 2026, 1:38 PM UTC |
| Coding agents (AA Index) | Claude Code · Opus 5 (max) | Claude Opus 5 | 59.7 | $10.79 | Sep 25, 2026, 2:39 PM UTC |

> **Two models, two scales**
>
> The coding row’s 59.7 is an average of three coding benchmarks for Opus 5 inside Claude Code, and the Index row’s 57.6 is a weighted average of 10 evaluations for Claude Opus 5.5 through its API. Neither number ranks the other, and $10.79 and $5.98 are costs of different tasks.

The Intelligence Index snapshot retrieved Sep 23, 2026, 1:38 PM UTC stores no Claude Opus 5 row, so the step from Opus 5 to Opus 5.5 that Anthropic describes cannot be measured on the Index from this snapshot.

## Limits

- The chart scores, costs, and token counts are Artificial Analysis measurements of the Claude Opus 5.5 rows on the retrieval date under Intelligence Index version 4.3.2, and of Claude Code · Opus 5.5 (max) and Claude Code · Opus 5 (max) under DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA. They say nothing about other tasks, prompts, or harnesses.
- The rank, frontier walk, nearest-score table, effort ladder, and cost shares are computed from those snapshots by aicharts. A new, removed, or rescored configuration moves them, and both snapshots update on a schedule.
- The Claude Opus 5.5 coding-agent scores above are the Claude Code · Opus 5.5 (max) row in the snapshot. They say nothing about Claude Opus 5.5 inside a harness the snapshot does not store.
- The Adaptive Reasoning and Default Fallback settings in the row names are recorded by Artificial Analysis and not defined in the snapshot; the per-evaluation scores behind the composite are not stored either.
- The prices, the 40% cost claim against Opus 5, and the benchmark table are Anthropic’s. aicharts did not run Claude Opus 5.5.

## See where Claude Opus 5.5 sits today

The chart redraws from each snapshot, so the rank, frontier run, and effort ladder above can move. The model page lists every Claude Opus 5.5 row the site holds.

- [Capability and cost chart](https://aicharts.io/#intelligence-index)
- [Claude Opus 5.5 model page](https://aicharts.io/models/anthropic/claude-opus-5.5/max)
- [Coding-agent chart](https://aicharts.io/coding)

## Sources

- [LLM Leaderboard](https://artificialanalysis.ai/models). Artificial Analysis, 2026. The public models leaderboard is the source of the aicharts Intelligence Index snapshot. Scores, per-task costs, and output tokens are Artificial Analysis measurements under Intelligence Index v4.3.2.
- [Claude Opus 5.5 (max with fallback) - Intelligence, Performance & Price Analysis](https://artificialanalysis.ai/models/claude-opus-5-5). Artificial Analysis, 2026. Cited, from the page captured September 25, 2026 UTC, for the 58 index score, the proprietary label, the September 22, 2026 release date, the $4.00 and $20.00 per million token prices with a 95% cache discount based on Anthropic’s API, the $5.98 cost per index task, the 260M output tokens across the index, the 1M token context window, and its summary and verbosity sentences.
- [Introducing Claude Opus 5.5](https://www.anthropic.com/news/claude-opus-5-5). Anthropic, 2026. Cited for the September 22, 2026 release, the $4 and $20 per million token prices against $5 and $25 for Opus 5, the $0.20 cache-read price, the 40% cost claim against Opus 5, medium as the default effort level, the max-effort setting behind Anthropic’s benchmark table, the statement that thinking can no longer be switched off, the safeguard fallback sentence, and the vendor-run benchmark table that this site does not chart.
- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [Opus 5.5 tops the coding-agent chart at 66.0 and $13.04 a task](https://aicharts.io/blog/opus-5-5-coding-agent-index)
- [GPT-6 Sol scores 56.7 on the coding-agent chart at $2.99 a task](https://aicharts.io/blog/gpt-6-sol-coding-agent-index)
- [MiMo-V2.6-Pro pairs a 46.3 score with $0.133 per task](https://aicharts.io/blog/mimo-v2-6-pro-cost-frontier)
