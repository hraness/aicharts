# Open models closed SemiAnalysis composites, not this table

SemiAnalysis’s faster catch-up describes era composites. Closed configurations still lead AA Index in this coding-agent snapshot.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

[SemiAnalysis asks whether open models are catching up](https://newsletter.semianalysis.com/p/are-open-models-catching-up), in an essay published August 21, 2026 by Evan Cloutier, Max Kan, Jordan Nanos, and Dylan Patel. Their answer is about era-specific composites: catch-up time has halved with each generation, down to 4.8 to 6 months in the agentic era. This note keeps that claim in its own measurement, then asks a different question of the [current coding-agent leaders table](/).

The Artificial Analysis snapshot stored by aicharts names a model, an agent harness, an effort setting, and a mean API cost for every row. It does not publish an open-versus-closed field. The comparison below uses an explicit provider allowlist, copies scores from the checked snapshot, and quotes only SemiAnalysis figures that appear in the essay text. The two sources can agree that open models have become more useful without agreeing that they have closed the coding-agent table.

## SemiAnalysis measures era composites

SemiAnalysis refuses a single historical scoreboard. Early-scaling exams saturate, reasoning exams replace them, and agentic work then needs terminal, browsing, and software-engineering tasks. Their Era 3 suite is Terminal-Bench 2.1, BrowseComp-Plus, τ³-banking, and DeepSWE. They ran most scores on Prime Intellect's evaluation stack and used additional runs from Artificial Analysis and Datacurve.

On that design they report a cycle. A closed lab jumps first. Other labs reverse-engineer the advance, including through distillation, and close the gap. In the early-scaling era their composite is 75.7 for GPT-3.5 Turbo and 39.9 for Llama-2-70B. Llama-3.1-405B later reaches 86. GPT-4o and DeepSeek V3 finish the era at 95.5 and 94.1.

The reasoning-era opening gap is 12.1 points, against 35.8 at the start of the previous era. DeepSeek R1-0528 closes that opening gap at 78 after 8.5 months. In the agentic era they report that Kimi K2.6 surpassed Opus 4.5 at 56.3 in 4.8 months, and that GLM-5.2 cleared GPT-5.2 at 72.4 in 6 months.

Those sentences are SemiAnalysis measurements, not aicharts calculations. The essay also limits what the composites prove. The authors still prefer Fable 5 for daily work over Kimi K3, even while saying Kimi K3 may score higher on their curated suite. They treat public benchmarks as hill-climbable: labs can train reinforcement-learning environments that mimic the evals.

## What the coding-agent snapshot records

aicharts retrieved the checked snapshot on Sep 25, 2026, 2:39 PM UTC. The dataset contains 20 model-agent configurations across 19 models, 8 agent harnesses, and 10 providers. AA Index is the snapshot's overall 0–100 score across code changes, terminal work, and repository understanding. DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA also have separate columns. The [dataset page](/data) lists every configuration and the highest stored score for each metric.

This is a closer relative of SemiAnalysis's agentic era than of their earlier exams, but it is not the same composite. The snapshot omits BrowseComp-Plus and τ³-banking, adds SWE-Atlas-QnA, and reports the three component scores alongside their AA Index composite. Every row also carries a harness and setting. A model name without those fields is an incomplete citation here.

## Closed configurations still lead on AA Index

The highest AA Index in this snapshot is 66.0 for Opus 5.5 on Claude Code at the max setting, with a mean API cost of $13.04 per task. The next stored scores belong to other closed-lab configurations. That is an observation of this table, not a claim that the same systems lead on SemiAnalysis's suite.

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

Open the [comparison chart](/) to change axes or pin a model. The leaders table on that page is the same checked snapshot, not a live scrape of the upstream page.

## Highest open-weight configurations in this snapshot

aicharts classifies a configuration as open-weight only when its provider is Alibaba Cloud, DeepSeek, Moonshot AI, and Z.ai. Those families are the ones SemiAnalysis treats as open in the essay (DeepSeek, Kimi, Qwen, and GLM). The snapshot does not state a license, so this allowlist is an analysis choice. Cognition and Meta are left unclassified because the snapshot does not state a license and the SemiAnalysis essay does not name those families as open. Cursor, xAI, Google, OpenAI, and Anthropic stay closed.

Under that rule, the highest open-weight AA Index is 53.6 for GLM-5.3 on Opencode at the default setting, with a mean API cost of $4.24 per task. That is 12.4 AA Index points behind Opus 5.5 on Claude Code. The gap is aicharts subtraction of two stored scores. It is not a SemiAnalysis composite.

*Highest open-weight AA Index configurations in the Artificial Analysis snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Model | Agent | Provider | Setting | AA Index | Cost |
| --- | --- | --- | --- | --- | --- |
| GLM-5.3 | Opencode | Z.ai | default | 53.6 | $4.24 |
| Kimi K3 | Kimi Code CLI | Moonshot AI | default | 51.9 | $5.05 |
| Qwen3.8 Max | Claude Code | Alibaba Cloud | default | 43.3 | $3.48 |
| DeepSeek V4 Pro 0813 | Codex | DeepSeek | max | 43.1 | $0.238 |
| DeepSeek V4 Flash 0731 | Codex | DeepSeek | max | 38.7 | $0.085 |

5 open-weight configurations are shown, from 5 classified open-weight rows in the snapshot. Several of those rows use Claude Code or Codex rather than a first-party harness. The snapshot therefore mixes model weights with another lab's agent product. That is one reason a model-only catch-up story and this table can diverge.

## The same named models sit in different places

The SemiAnalysis essay quotes agentic-era catch-up scores for named models that are not present in this snapshot. No side-by-side row is possible until those names reappear in a validated refresh.

SemiAnalysis also writes that Kimi K3 may outscore Fable 5 on their composite while they still prefer Fable for daily work. This snapshot does not contain a SemiAnalysis composite for either name, so no Kimi K3-versus-Fable 5 number is quoted from that suite. The available AA Index configurations can be read on the [full configuration table](/data).

## Cost changes which gap you see

AA Index leaders in this snapshot are expensive relative to the cheapest rows. The [AA Index versus cost note](/blog/aa-index-cost-coding-agents) keeps a configuration on the frontier when no other row scores at least as high at no greater cost, with a strict improvement on at least one measure. That derived view is aicharts analysis of the stored pairs.

At least one classified open-weight configuration is on that frontier: DeepSeek V4 Flash 0731 on Codex at the max setting, with AA Index 38.7 and mean API cost $0.085 per task. 2 open-weight frontier points appear in this snapshot. Open-weight rows are more visible when the question is inexpensive score than when the question is the highest AA Index.

> **Two questions, two answers**
>
> Use SemiAnalysis for the historical catch-up cycle on their era composites. Use this snapshot when you need a named coding-agent configuration, a harness, and a task-level cost. Do not treat one as a reprint of the other.

The useful sentence is narrower than the essay title. Open-weight coding agents in this snapshot are close enough to matter on cost and close enough to appear in the middle of the AA Index list. They are not the current AA Index leaders. SemiAnalysis's faster catch-up time describes their composites, not this table.

## Limits of this comparison

- SemiAnalysis defines and operates its era composites. aicharts does not rerun that suite or recover unpublished chart points from images.
- Artificial Analysis defines the coding-agent scores and costs. aicharts is an independent visualization and is not affiliated with Artificial Analysis, SemiAnalysis, or the listed providers.
- The open-weight set is an explicit provider allowlist, not a field in the snapshot. A license change, a new provider, or a different definition of open would change the grouped rows.
- Scores belong to the named model, harness, setting, task set, and evaluation version on the retrieval date. They do not establish results for every repository or production workflow.
- This is a checked snapshot, not a live mirror. Cite the retrieval timestamp when quoting a value.

## Current comparison: coding agents

The interactive chart shows the current source snapshot across benchmark performance, cost, speed, and token use.

[Explore chart](https://aicharts.io/)

## Sources

- [Are Open Models Catching Up?](https://newsletter.semianalysis.com/p/are-open-models-catching-up). SemiAnalysis, 2026. The August 21, 2026 essay reports era-specific open-versus-closed composites, catch-up intervals, and the limits of public-benchmark scores.
- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
