# Introducing aicharts

aicharts plots published AI benchmark scores against cost and tokens per task, and a local collector measures your own agents' token use.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

Status: the benchmark charts and notes are free and live at aicharts.io. The usage collector is in development.

*Video: Introducing aicharts. A 42-second film with captions and no narration. After the title card it pans an illustrated aicharts page: the score and cost chart with the line through the models nothing cheaper beats, the coding-agent chart with one setup's cost, time and tokens, and the usage dashboard beside the collector commands, ending on what stays on your machine, the snapshot counts and what aicharts does not do.*

## See which AI model wins at each price

aicharts puts published AI benchmark scores and the cost of a task on one chart, so you can see which model gives the most for your budget. Every point names its source and the day it was checked.

*The aicharts homepage chart, in an illustration: models plotted by benchmark score against cost per task.*

[More on this](https://aicharts.io/)

## Every model on one score and cost chart

The homepage chart plots 97 model settings by Artificial Analysis Intelligence Index v4.3.2 score against cost per task. The line joins the models nothing cheaper beats, so the best pick at each price stands out.

*The models chart, in an illustration, with the best-value line drawn through the cheapest models at each score.*

[More on this](https://aicharts.io/)

## Coding agents, compared as the setups you run

The coding chart compares 20 coding-agent setups. Each point is a model, the agent app running it, and an effort setting. Hover one to see its scores, cost per task, time, and tokens.

*The coding chart, in an illustration: one setup is hovered, showing its model, agent, effort, score, cost and time.*

[More on this](https://aicharts.io/coding)

## A library of benchmarks, each on its own scale

The benchmarks library covers 62 tests across reasoning, research, memory, images, video and audio. Each one is labelled as a chart, a guide to the source, or an early test, and it keeps its own scale.

*The benchmarks library, in an illustration: entries grouped by topic, each tagged charted, source guide or emerging.*

[More on this](https://aicharts.io/benchmarks)

## Count the tokens your own agents use

The aicharts collector reads the usage files your coding agents already keep, from 55 supported sources, and adds up tokens, cost and speed per model and day. Prompts and transcripts stay on your machine.

*The usage dashboard, in an illustration with made-up numbers: tokens per day, stacked by agent, with totals.*

[More on this](https://aicharts.io/usage)

## Numbers leave your machine, words never do

A local report is a file you open in your browser tab. On a Mac you can also sync daily totals to your dashboard: token counts, cost and time per agent and model. Prompts, transcripts, file paths and keys stay on your machine.

*A terminal, in an illustration: the collector writes a local report, then an enrolled Mac syncs daily number totals.*

[More on this](https://aicharts.io/usage)

## For picking a model on cost, not for one overall rank

aicharts is for choosing a model or coding agent by weighing score against cost, time or tokens. If you want one overall ranking of every model, look elsewhere: aicharts builds no score of its own, and it cannot test your codebase.

*The models chart switched to output tokens per task, in an illustration, so wordier models sit further right.*

[More on this](https://aicharts.io/blog/aa-index-cost-coding-agents)

## Every published result, with its setup and date

The goal is a catalog where any benchmark result you might use to pick a model shows its setup, version, cost and date. Tests that have only a source guide today are meant to become charts once their data can be checked.

*One data page entry, in an illustration: the question, what it measures, source, version, valid comparisons, limits.*

[More on this](https://aicharts.io/data)

## The scores come from their owners, not from aicharts

Scores, costs and token counts come from the benchmark owners and trackers aicharts cites; it runs no tests itself. Costs keep the source's unit, per task or per full run, so compare two only when the unit matches.

*A chart's source details, in an illustration: who published the scores, the day they were checked, and the cost unit.*

[More on this](https://aicharts.io/data)

## The charts are free and live; the collector is early

The charts and notes are free at aicharts.io. Usage collector status: In development. Version 0.2.0 for Linux is on GitHub Releases; on a Mac you build it from source.

*The collector's terminal status view, in an illustration: collecting, last pass and last sync, and its outputs.*

[More on this](https://aicharts.io/usage)

## Go deeper

- [Highest AA Index and lowest cost pick different coding agents](/blog/aa-index-cost-coding-agents): the cost frontier worked through on one dated coding-agent snapshot.
- [Why a coding-agent high score still needs a holdout](/blog/coding-agent-score-holdouts): why a public score cannot tell you how a model does on your code.
- [HarnessTax finds cost gaps at similar success rates](/blog/harnesstax-coding-agent-harness): the same models in different agent apps, and the cost gap between them.
- [What Terminal-Bench-Science’s 30% result measures](/blog/terminal-bench-science): one science benchmark's top result read against its cost and tokens.
- [The data page](/data): every entry's source, version and limits. The homepage uses Intelligence Index v4.3.2; the earlier v4.1.1 results stay a separate dataset, and the owners' Terminal-Bench 4.0 results stay apart from Artificial Analysis's own runs.

## Current comparison: coding agents

The interactive chart shows the current source snapshot across benchmark performance, cost, speed, and token use.

[Explore chart](https://aicharts.io/)

## Sources

- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.
- [LLM Leaderboard](https://artificialanalysis.ai/models). Artificial Analysis, 2026. The public models leaderboard is the source of the aicharts Intelligence Index snapshot. Scores, per-task costs, and output tokens are Artificial Analysis measurements under Intelligence Index v4.3.2.
- [Terminal-Bench](https://github.com/harbor-framework/terminal-bench). Harbor Framework, 2026. The benchmark owners’ repository publishes Terminal-Bench and its versioned task releases. The version-pinned Terminal-Bench 4.0 cohort in the aicharts benchmarks library comes from the owners, separately from Artificial Analysis’s own Terminal-Bench 4 runs.

## Related analysis

- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
- [Why a coding-agent high score still needs a holdout](https://aicharts.io/blog/coding-agent-score-holdouts)
- [HarnessTax finds cost gaps at similar success rates](https://aicharts.io/blog/harnesstax-coding-agent-harness)
