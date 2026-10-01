# What Terminal-Bench-Science’s 30% result measures

Scientists accepted 70 of 920 proposed workflows. The leading configuration resolved 30 percent; cost and token frontiers show why that rate is incomplete.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

[Terminal-Bench-Science 0.1](https://www.terminal-bench-science.ai/announcement) is a Stanford-led evaluation of AI agents on scientific research workflows. Steven Dillmann, writing for the benchmark team, reports that 920 proposed workflows became 70 accepted tasks after domain, implementation, and difficulty review. The team’s stated principle is: “Scientists, not model developers or data vendors, set the bar for scientific capability in AI.”

## What the 30% result covers

“Of 920 proposals, 464 were approved for implementation and 386 pull requests were opened, but only 70 tasks made it into Terminal-Bench-Science 0.1.” Each configuration ran three independent trials per task across all 70 tasks. The accepted set spans scientific data analysis, statistical inference, simulation, optimization, theorem proving, image reconstruction, signal processing, inverse problems, sensor calibration, model fitting, classification, and scientific machine learning. The leaderboard records the model together with its agent harness, because the harness is part of the evaluated configuration.

*Terminal-Bench-Science 0.1 resolution rates from the announcement*
| Model | Agent harness | Resolution |
| --- | --- | --- |
| Claude Opus 5 | Claude Code | 30.0% |
| GPT-5.6 Sol | Codex | 22.4% |
| Claude Fable 5 | Claude Code | 21.4% |
| Claude Opus 4.8 | Claude Code | 10.5% |
| GPT-5.6 Terra | Codex | 8.6% |
| GLM 5.3 | Claude Code | 8.1% |
| Kimi K3 | Claude Code | 7.1% |
| Grok 4.6 | Grok Build | 7.1% |
| GPT-5.6 Luna | Codex | 3.3% |

“The strongest model evaluated, Claude Opus 5, achieves a 30% resolution rate on Terminal-Bench-Science 0.1.” The suite is calibrated to sit more than 10 percentage points below Terminal-Bench 3.0 for every model evaluated on both. Because reviewers excluded workflows that frontier systems already solved at high rates, 30% describes performance on a deliberately difficult accepted set. It should not be read as a success rate for arbitrary laboratory work or as evidence that one model can replace a scientist.

## Cost and tokens change the comparison

“GPT-5.6 Sol matches Claude Fable 5's performance at less than a third of the cost ($4.2k vs $14.2k).” Claude Opus 5 reaches the highest resolution at $7.0k. On tokens, Claude Fable 5 matches GPT-5.6 Sol’s performance while using about a quarter fewer tokens (6.4B versus 8.4B). Only Kimi K3 and Claude Opus 5 appear on both the cost-resolution and token-resolution Pareto frontiers.

*Cost and token facts Terminal-Bench-Science 0.1 reports beside resolution*
| Comparison | Reported result | What it changes |
| --- | --- | --- |
| GPT-5.6 Sol versus Claude Fable 5 | $4.2k versus $14.2k | Similar resolution at less than a third of the evaluation cost |
| Claude Opus 5 evaluation cost | $7.0k | Highest resolution at a higher total evaluation cost |
| Claude Fable 5 versus GPT-5.6 Sol tokens | 6.4B versus 8.4B | Similar resolution at about a quarter fewer tokens |
| Both Pareto frontiers | Kimi K3 and Claude Opus 5 | The only named systems on both the cost and token fronts |

The highest resolution, lowest evaluation cost, and lowest token use do not select the same configuration. A team choosing an evaluation candidate therefore needs a quality threshold and a budget, rather than a single overall winner.

> **How to use the result**
>
> Use resolution to compare completion on this accepted task set. Use the published cost and token frontiers to find configurations that improve one of those resources without giving up more resolution than your work can tolerate.

## How this score differs from the coding-agent chart

The [aicharts homepage](/) now includes Terminal-Bench-Science 0.1 as the scientific-workflow member of its five-role benchmark portfolio. Its scores remain separate from the interactive Artificial Analysis coding-agent chart, which plots Coding Agent Index v1.5, DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA against API cost, active time, or total token use. Those coding observations come from a checked [Artificial Analysis coding-agents snapshot](https://artificialanalysis.ai/agents/coding-agents/) retrieved Sep 25, 2026, 2:39 PM UTC.

For orientation, the snapshot’s highest stored Terminal-Bench 4 score is 63.1 for Opus 5.5 on Claude Code at the max setting. That value belongs to a software-engineering terminal benchmark; it cannot be compared numerically with the 30% Science resolution rate. The shared lesson is methodological: keep the task set, model, harness, quality measure, cost, and token use attached to every comparison.

## Limits

- Resolution rates, costs, and token totals belong to the named 0.1 release, models, harnesses, and three-trial protocol on the announcement. They can change in a later release.
- Terminal-Bench-Science 0.1 is a homepage benchmark family, not a field in the checked Artificial Analysis coding-agent snapshot. A stored Coding Agent Index Terminal-Bench 4 component is a separate evaluator cohort.
- Reported evaluation costs are totals across all 70 tasks. They are not a production invoice, a subscription price, or a per-query quote.
- The suite is living and versioned; later releases can add, retire, or recalibrate tasks.
- Resolution varies by scientific domain, so the aggregate is not a domain-specific capability claim.

## Inspect the version-pinned scientific benchmark

Open the checked Terminal-Bench-Science 0.1 source, method, and machine-readable snapshot behind the homepage view.

- [Data and method](https://aicharts.io/data#terminal-bench-science)
- [Terminal-Bench-Science JSON](https://aicharts.io/data/terminal-bench-science-0-1.json)

## Sources

- [Terminal-Bench-Science 0.1](https://www.terminal-bench-science.ai/announcement). Terminal-Bench-Science, 2026. Steven Dillmann’s announcement defines Terminal-Bench-Science 0.1, reports the 70-task funnel, named resolution rates, cost and token frontiers, and the living-benchmark roadmap.
- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
