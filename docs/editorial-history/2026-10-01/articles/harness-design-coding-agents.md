# Context management helps most when the window is tight

Nine researchers held one coding-agent loop fixed and toggled planning, tools, and context management across 176 settings. Each component helped only under named conditions.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

[An Empirical Study of Harness Design for Coding Agents](https://arxiv.org/abs/2609.20804) is a paper posted to arXiv on September 17, 2026 by Run-Ze Fan, Zihao Zhang, Simin Ma, Yebowen Hu, Shouju Wang, Kaiqiang Song, Fei Liu, Hamed Zamani, and Xiaoyang Wang, from UMass Amherst, Emory University, UNC Charlotte, and Zoom Video Communications. It asks which parts of a coding-agent harness change task success and cost, and under what conditions.

A harness is the software around a model that gives it tools, keeps track of the task, and decides what history the model sees. Most harness comparisons swap one complete product for another, so a score difference cannot be traced to a single mechanism. The authors instead build one harness whose execution loop stays fixed and vary three components inside it: planning (a persistent task plan the model updates through a tool), the action space (a set of predefined file, search, and shell tools versus a bare bash tool), and context management (how a growing history is compacted to fit a token window).

## What the 176 settings cover

The study uses four open-weight models: Nemotron-3 at 30B, 120B, and 550B parameters as a within-family capability axis, and Mistral-Medium-3.5-128B from a second family. The authors serve every model locally in BF16 with temperature 0 and a 16,384-token output cap per turn. Cost is priced from OpenRouter rates accessed August 2026, per million input and output tokens: $0.05 and $0.20 for Nemotron-3 30B, $0.08 and $0.45 for 120B, $0.50 and $2.20 for 550B, and $1.50 and $7.50 for Mistral-Medium-3.5-128B. The authors describe the models as probes of capability and interaction style, not as optimization targets.

Two benchmarks supply the tasks. SWE-Bench Verified has 500 human-verified GitHub issues from Python repositories; the agent must produce a patch that passes the issue’s tests. Terminal-Bench 2.1 has 89 end-to-end tasks in a command-line environment. Each setting reports the share of tasks resolved and the mean cost per task. Every task runs once per setting with a 300-step cap. The execution loop and stopping rules stay fixed. The action-space ablation also changes file tracking and automatic diagnostics along with the available tools.

Context management has five tiers. T0 does nothing and ends the run when the window overflows. T1 elides stale tool observations, replacing their bodies with short stubs. T2 adds recall: elided observations go to an external store and a recall_event tool can read them back. T3 summarizes older history with a separate call to the same model and no elision. T4 stages all three: it elides bulky observations once history passes a soft threshold at 60% of the window, and summarizes the oldest middle events once history passes a hard threshold at 85%. The system prompt, the task description, and at least the last two turns always stay verbatim.

The five tiers run under four window budgets of 32k, 64k, 96k, and 128k tokens with planning on and the predefined tools, which gives 20 settings per model and benchmark. Two more settings start from T4 with a 128k window and remove one component each: one disables planning, and one replaces the predefined tools with bash only. That is 22 settings per pair and 176 in total. Within each comparison family the authors test success differences with a two-sided exact McNemar test on task-paired outcomes and control the false discovery rate at 0.05.

## Context management pays off when the window is tight

The authors define the value of context management as the success gap between the managed tiers (T1 through T4) and T0. Averaged over the four models, that gap shrinks steadily as the window grows. Recomputing it from the printed tables gives the same figures the paper reports.

*Mean success of T1 through T4 minus T0 success, averaged over the four models, in percentage points. Reconstructed from the paper’s Tables 3 and 4.*
| Window budget | SWE-Bench Verified | Terminal-Bench 2.1 |
| --- | --- | --- |
| 32k | 35.7 | 9.5 |
| 64k | 15.9 | 7.5 |
| 96k | 5.5 | 4.8 |
| 128k | 2.7 | 2.8 |

The gap tracks overflow. Across the same budgets, the model-averaged share of T0 tasks lost to window overflow falls from 78.7% to 8.7% on SWE-Bench Verified and from 61.0% to 12.1% on Terminal-Bench 2.1, while every managed tier overflows on zero tasks at every budget. The authors read this as context management preventing premature termination when the window binds. At 128k the tiers differ little in median trajectory length or in the share of runs that end without an edit, so the mechanism mostly extends runs rather than changing what the agent does. The paper’s takeaway: “Context management reduces the sensitivity of task success to context-window capacity, enabling effective execution under tighter context budgets.”

## Elide first, summarize later

Success rates are similar across T1 through T4, so the tiers separate on cost. The paper reports that T4 has the lowest mean cost in seven of eight model and benchmark panels. Averaging each tier’s cost over the four budgets in the printed tables, T4 is strictly lowest in seven panels and ties for lowest in the remaining one (Nemotron-3 30B on SWE-Bench Verified, where costs round to a cent or two). T4 also keeps peak context furthest below the nominal window at every budget and calls the summarizer less often than T3. The authors attribute the cost profile to cheap early elision handling many cases before an LLM summarization call is needed.

Recall adds machinery the models rarely use. T1 and T2 differ only in whether elided content can be recovered. Across 32 model, benchmark, and window comparisons, T2 beats T1 in 15, loses in 14, and ties in 3, for an equal-weight mean difference of −0.36 percentage points. Of the 64 T2 and T4 settings, 36 never call recall_event, and the 16 planning and action-space settings record no recall calls at all. Recall use concentrates in Nemotron-3 30B at the 32k window; its heaviest configuration averages 4.326 calls per task and scores 3.37 points below T1. The authors conclude: “Models, especially stronger ones, almost never call recall_event to recover elided observations, so lossless recall yields no accuracy gain over elision alone.”

## Planning helps the weakest model and saves cost for the strongest

The planning ablation compares planning on and off at T4 with a 128k window, with the predefined tools in both settings. For Nemotron-3 30B, planning raises success by 11.6 points on SWE-Bench Verified and 4.5 points on Terminal-Bench 2.1, at higher cost on both. For Nemotron-3 120B there is no consistent success gain; planning raises cost on SWE-Bench Verified and lowers it on Terminal-Bench 2.1. For Nemotron-3 550B and Mistral-Medium-3.5-128B, planning lowers SWE-Bench Verified cost by about 30% and 32% while success falls by 2.0 and 0.4 points.

*Component ablations on SWE-Bench Verified from the T4, 128k, planning-on, predefined-tools baseline: success rate at mean cost per task. † preserves the paper’s significance marker: T4 compares with T0 at the same window size; the ablated settings compare with T4. Each comparison uses a two-sided exact McNemar test with Benjamini–Hochberg q < 0.05 within its comparison family.*
| Model | T4 baseline | Without planning | Bash only |
| --- | --- | --- | --- |
| Nemotron-3 30B | 25.2% at $0.09 | 13.6% at $0.02† | 10.2% at $0.03† |
| Nemotron-3 120B | 44.0% at $0.34 | 46.6% at $0.25 | 42.4% at $0.35 |
| Nemotron-3 550B | 65.8% at $2.33† | 67.8% at $3.31 | 69.4% at $1.11† |
| Mistral-Medium-3.5-128B | 68.6% at $3.14 | 69.0% at $4.65 | 45.4% at $1.72† |

*Component ablations on Terminal-Bench 2.1 from the T4, 128k, planning-on, predefined-tools baseline: success rate at mean cost per task. † preserves the paper’s significance marker: T4 compares with T0 at the same window size; the ablated settings compare with T4. Each comparison uses a two-sided exact McNemar test with Benjamini–Hochberg q < 0.05 within its comparison family.*
| Model | T4 baseline | Without planning | Bash only |
| --- | --- | --- | --- |
| Nemotron-3 30B | 13.5% at $0.14 | 9.0% at $0.08 | 3.4% at $0.02† |
| Nemotron-3 120B | 28.1% at $0.28 | 28.1% at $0.38 | 23.6% at $0.41 |
| Nemotron-3 550B | 44.9% at $2.43† | 46.1% at $2.52 | 50.6% at $1.70 |
| Mistral-Medium-3.5-128B | 37.1% at $2.22 | 39.3% at $3.71 | 43.8% at $2.75 |

The trajectory analysis explains the split. Without planning, Nemotron-3 30B’s median SWE-Bench Verified run drops from 40 to 5 turns, and 68.6% of runs end without editing a file, against 27.8% with planning. Planning keeps the weakest model working long enough to attempt an edit. For the stronger models it does the opposite job: it shortens the median SWE-Bench Verified run from 108 to 74 turns for Nemotron-3 550B and from 68 to 53 for Mistral, and the removed turns are mostly post-edit verification. On Terminal-Bench 2.1 the cost effect depends on which tail planning trims: about 26% lower for Nemotron-3 120B, 3.6% lower for 550B, about 40% lower for Mistral, and 75% higher for 30B, whose runs planning keeps alive.

In the authors’ words, “Planning trades additional computation for accuracy on the weaker model, but primarily reduces cost on the stronger models; its value at intermediate capability remains task-type-dependent.” The estimate covers one planning implementation, a prompt plus an update_plan tool, not planning as a general reasoning strategy.

## Bash-capable models can drop the predefined tools

The action-space ablation compares the predefined tool set (read_file, write_file, edit_file, list_files, glob_files, grep_text, web_fetch, and bash) with bash only, at T4 with a 128k window and planning on. The predefined tools help Nemotron-3 30B most: 15.0 points on SWE-Bench Verified and 10.1 on Terminal-Bench 2.1. Without them the model emits tool calls learned in training that the bash-only harness cannot resolve; 66% of its bash-only Terminal-Bench 2.1 runs end after such a call, and the average run shortens from 71 to 15 turns. For Nemotron-3 120B the gain narrows to 1.6 and 4.5 points.

Nemotron-3 550B crosses over. Bash only raises its success by 3.6 points on SWE-Bench Verified and 5.6 on Terminal-Bench 2.1 while cutting cost by 53% and 30% ($1.11 versus $2.33, and $1.70 versus $2.43). Its bash-only runs issue 32% fewer calls on SWE-Bench Verified and 24% fewer on Terminal-Bench 2.1, consistent with denser shell commands that bundle several operations. Across all four models, bash only also cuts repeated patching of already edited files and shifts file writes toward whole-file create or replace actions.

Mistral-Medium-3.5-128B shows the task boundary. The predefined tools raise its SWE-Bench Verified success by 23.2 points, and 32.8% of its bash-only runs there end without editing a file, against 1.2% with the full set. On Terminal-Bench 2.1, bash only adds 6.7 points, at a higher mean cost in the printed table ($2.75 versus $2.22). With the full set available, Mistral already routes 71.9% of its Terminal-Bench 2.1 workspace actions through bash, against 40.4% on SWE-Bench Verified. Removing competing tools suits the shell-centric suite; the repository suite still rewards predefined read, search, and edit actions.

> **What the action-space comparison is**
>
> It is a bundled interface change. Bash only removes the predefined tools, their interface instructions, the harness’s file-state tracking, read-before-write checks, and automatic post-edit diagnostics together. The authors say the result does not isolate tool count or action granularity from those other properties.

## How to read this beside HarnessTax and the aicharts chart

HarnessTax, covered in the [site’s earlier note](/blog/harnesstax-coding-agent-harness), moved the same frontier model across three complete products (Claude Code, Codex CLI, and Pi) and found that cost moved far more than success. This paper asks a question that design cannot answer: which mechanism inside a harness moves cost or success. Its answer comes from a single research harness and four open-weight models, so its numbers are not a ranking of any product and do not transfer to a named commercial harness without a matched test.

The aicharts coding-agent chart is a checked snapshot of the public [Artificial Analysis coding-agents page](https://artificialanalysis.ai/agents/coding-agents/), retrieved Sep 25, 2026, 2:39 PM UTC. It stores each model with its harness and effort setting. The snapshot stores none of the paper’s four models, so there is no same-name row to place beside these tables.

The benchmark versions also differ. The paper evaluates Terminal-Bench 2.1 with 89 tasks and one run per task. The site’s terminal standard is [Terminal-Bench 4](/data#terminal-bench-4) (version 4.0.0), with 66 tasks and five trials per task, and the Artificial Analysis coding-agent index also uses Terminal-Bench 4. A Terminal-Bench 2.1 success rate and a Terminal-Bench 4 accuracy come from different task sets and cannot share an axis. [SWE-bench Verified](/data#atlas-swe-bench-verified) appears in the site’s benchmark library as a definition and comparison guide with the same 500-task set the paper uses. The site does not chart its scores, and the paper’s rates belong to its own harness and models.

[Public-suite holdouts](/blog/coding-agent-score-holdouts) still apply. Both suites are public. The authors keep web search out of the action space because SWE-Bench tasks come from public GitHub issues whose fixing pull requests are online, and they list prior exposure to tool interfaces among the reasons model size is only an imperfect proxy for capability.

## Limits

- Every figure belongs to one research harness, one planning implementation (a prompt plus an update_plan tool), one threshold policy for context management, and one bundled action-space change. The authors say the results estimate conditional effects of these implementations, not a universally optimal harness.
- Planning and the action space are ablated only at T4 with a 128k window. A full factorial study would be needed to know whether their effects hold under other tiers and budgets.
- Each setting runs once per task, and Terminal-Bench 2.1 has 89 tasks. Many Terminal-Bench 2.1 contrasts do not reach significance; the authors rest those conclusions on consistent direction across models and budgets rather than on individually significant cells.
- The models are three Nemotron-3 sizes and Mistral-Medium-3.5-128B, served locally, with token use priced at OpenRouter list rates. SWE-Bench Verified is Python only. The authors say the crossover points should be validated before transfer to other model families, harness implementations, or task types.
- Cost is the mean token cost per task at the listed prices, not latency, a subscription invoice, or a cache-adjusted bill.
- The reconstructed tables in this note round success rates to one decimal and use the paper’s printed two-decimal costs, so tie and ratio statements carry rounding of up to a cent.
- aicharts rows come from a different evaluator, harness, price basis, and Terminal-Bench version (4.0.0, not 2.1). They must not be subtracted from or averaged with the paper’s rates.

The authors’ closing line states the conclusion the tables support: “Harness design is thus a conditional systems problem in which each component should be selected for the target model, task type, and resource budget rather than adopted as a default.”

## Compare current coding-agent configurations

The coding-agent chart stores each model with its harness and effort setting. The data page defines every charted benchmark, including the Terminal-Bench 4 standard, with its comparison rules and limits.

- [Coding-agent chart](https://aicharts.io/coding)
- [Benchmark definitions and data](https://aicharts.io/data)

## Sources

- [An Empirical Study of Harness Design for Coding Agents](https://arxiv.org/abs/2609.20804). arXiv, 2026. The September 17, 2026 arXiv paper reports the fixed-loop harness, the five context-management tiers, the 176-setting design, the printed SWE-Bench Verified and Terminal-Bench 2.1 tables, the trajectory analysis, and the stated limitations.
- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [HarnessTax finds cost gaps at similar success rates](https://aicharts.io/blog/harnesstax-coding-agent-harness)
- [Why a coding-agent high score still needs a holdout](https://aicharts.io/blog/coding-agent-score-holdouts)
- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
