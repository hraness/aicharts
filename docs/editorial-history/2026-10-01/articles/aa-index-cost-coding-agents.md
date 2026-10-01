# Highest AA Index and lowest cost pick different coding agents

The cost frontier shows which configurations offer a higher AA Index only at a higher mean task cost.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

The current aicharts coding-agent comparison is a checked snapshot of the public [Artificial Analysis coding-agents page](https://artificialanalysis.ai/agents/coding-agents/). This note answers one question from that snapshot: which named model, agent harness, and effort settings lead on AA Index, and which of those rows remain undominated once mean API cost per task is included.

aicharts retrieved the snapshot on Sep 25, 2026, 2:39 PM UTC. The dataset contains 20 model-agent configurations across 19 models, 8 agent harnesses, and 10 providers. 20 of those configurations report both an AA Index and a mean API cost. The values below are copied from that snapshot. aicharts does not recalculate Artificial Analysis scores.

## What this snapshot measures

AA Index is the snapshot's overall 0–100 score across code changes, terminal work, and repository understanding. Artificial Analysis also reports DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA as separate metrics. Those component scores are not combined here. This note uses AA Index because it is the composite the source publishes for the same configuration that also carries a task-level cost.

API cost is the mean API cost in US dollars for the evaluated task configuration. It is not a subscription price, a latency guarantee, or a production invoice. Active time and total token use exist in the same records and are left for the [comparison chart](/).

Each row is a specific combination of model, agent harness, and effort setting. A model name without the harness and setting is an incomplete citation. Two rows that share a model and differ only in setting are different observations.

## Highest AA Index configurations

The highest AA Index in this snapshot is 66.0 for Opus 5.5 on Claude Code at the max setting, with a mean API cost of $13.04 per task.

*Highest AA Index configurations in the Artificial Analysis snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Model | Agent | Setting | AA Index | Cost |
| --- | --- | --- | --- | --- |
| Opus 5.5 | Claude Code | max | 66.0 | $13.04 |
| Fable 5.1 (with fallback) | Claude Code | max | 62.2 | $12.39 |
| Claude Fable 5.1 XHigh + SWE-2 Medium | Devin Fusion CLI | default | 61.7 | $7.90 |
| GPT-6 Astra | Codex | max | 61.6 | $7.47 |
| Opus 5 | Claude Code | max | 59.7 | $10.79 |
| GPT-6 Astra XHigh + SWE-2 Medium | Devin Fusion CLI | default | 58.9 | $4.54 |
| GPT-6 Sol | Codex | max | 56.7 | $2.99 |
| Grok 4.7 | Grok Build | xhigh | 56.3 | $8.82 |
| GPT-5.6 Sol | Codex | max | 54.6 | $6.35 |
| Muse Spark 1.3 | Muse Code | max | 54.3 | $3.98 |

These are the highest stored AA Index scores, not a claim that the same systems lead on DeepSWE v1.1, Terminal-Bench 4, or SWE-Atlas-QnA. The [dataset page](/data) lists the highest available score for each of those metrics separately and includes every configuration in the snapshot.

## Cost and AA Index on the frontier

A configuration is on the cost frontier when no other configuration costs no more and scores at least as high, with a strict improvement in either cost or score. Configurations with identical cost and score share a frontier position.

*AA Index versus cost frontier in the Artificial Analysis snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Model | Agent | Setting | AA Index | Cost |
| --- | --- | --- | --- | --- |
| DeepSeek V4 Flash 0731 | Codex | max | 38.7 | $0.085 |
| GPT-6 Luna | Codex | max | 41.1 | $0.176 |
| DeepSeek V4 Pro 0813 | Codex | max | 43.1 | $0.238 |
| GPT-5.6 Luna | Codex | max | 43.2 | $0.438 |
| GPT-6 Sol | Codex | max | 56.7 | $2.99 |
| GPT-6 Astra XHigh + SWE-2 Medium | Devin Fusion CLI | default | 58.9 | $4.54 |
| GPT-6 Astra | Codex | max | 61.6 | $7.47 |
| Claude Fable 5.1 XHigh + SWE-2 Medium | Devin Fusion CLI | default | 61.7 | $7.90 |
| Fable 5.1 (with fallback) | Claude Code | max | 62.2 | $12.39 |
| Opus 5.5 | Claude Code | max | 66.0 | $13.04 |

The frontier in this snapshot has 10 configurations. Moving between distinct frontier points trades a higher mean task cost for a higher AA Index; the size of the score increase varies.

That sequence is aicharts analysis of the stored pairs. Artificial Analysis does not publish a frontier ranking. The frontier can change when the next validated snapshot adds, removes, or reprices a configuration.

## AA Index per dollar is a derived view

Dividing AA Index by mean API cost produces a derived ratio. It is not an Artificial Analysis metric. The ratio favors cheap configurations and can rank a low score above a stronger but more expensive run.

*Highest derived AA Index per dollar in the Artificial Analysis snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Model | Agent | Setting | AA Index | Cost | AA Index / $ |
| --- | --- | --- | --- | --- | --- |
| DeepSeek V4 Flash 0731 | Codex | max | 38.7 | $0.085 | 455.4 |
| GPT-6 Luna | Codex | max | 41.1 | $0.176 | 233.5 |
| DeepSeek V4 Pro 0813 | Codex | max | 43.1 | $0.238 | 180.9 |
| GPT-5.6 Luna | Codex | max | 43.2 | $0.438 | 98.7 |
| GPT-6 Sol | Codex | max | 56.7 | $2.99 | 19.0 |
| Gemini 3.8 Flash | Antigravity SDK | high | 41.9 | $2.47 | 17.0 |
| Muse Spark 1.3 | Muse Code | xhigh | 48.3 | $3.47 | 13.9 |
| Muse Spark 1.3 | Muse Code | max | 54.3 | $3.98 | 13.7 |
| Grok 4.6 | Grok Build | xhigh | 47.0 | $3.57 | 13.2 |
| GPT-6 Astra XHigh + SWE-2 Medium | Devin Fusion CLI | default | 58.9 | $4.54 | 13.0 |

Use the ratio only to find inexpensive configurations that still have a recorded AA Index. A configuration is on the frontier when no other row scores at least as high at no greater cost, with a strict improvement on at least one measure.

> **Derived, not sourced**
>
> AA Index per dollar and the frontier are aicharts views of the checked snapshot. Cite Artificial Analysis for the underlying score and cost, and cite this page only for the derived comparison.

## When to use this snapshot

Use this note when you need a sourced answer to a cost and quality question on the current coding-agent snapshot. Open the [comparison chart](/) to change axes, pin a model, or inspect provider ranges. Open the [dataset page](/data) for provenance, benchmark definitions, and the full configuration table.

## Limits of the comparison

- Artificial Analysis defines and operates the evaluations. aicharts is an independent visualization and is not affiliated with Artificial Analysis or the listed providers.
- Scores and costs belong to the named model, harness, setting, task set, and evaluation version on the retrieval date. They do not establish results for every repository or production workflow.
- Mean task cost is not a price quote. Prompt mix, retry policy, caching, and live API prices can differ from the evaluation.
- AA Index is a composite. A configuration can lead on the index and trail on a component benchmark.
- This is a checked snapshot, not a live mirror. Cite the retrieval timestamp when quoting a value.

## Current comparison: coding agents

The interactive chart shows the current source snapshot across benchmark performance, cost, speed, and token use.

[Explore chart](https://aicharts.io/)

## Sources

- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [MirrorCode scores complete-program reimplementation](https://aicharts.io/blog/mirrorcode-coding-agent-benchmark)
