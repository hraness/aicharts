# What Devin Fusion’s 39% saving measures

Cognition’s 39% is one comparison: an Astra-led Fusion pair against Codex on the Artificial Analysis index, at a lower score. The same post’s other reported savings run from 11% to 46%.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

Cognition, the company behind the Devin coding agent, released Fusion in Devin Desktop and Devin CLI on September 11, 2026. Fusion is a harness that runs two agents at once. A frontier model, the lead, plans the task, hands out work, and reviews the result. A less expensive model, the sidekick, explores the code, makes the changes, and runs the tests. The [announcement](https://cognition.com/blog/local-fusion) calls Fusion “up to 39% more efficient compared to other model harnesses across major coding benchmarks.”

That sentence carries one number and several comparisons. This note identifies which comparison produces the 39%, lists the other savings Cognition reports in the same post and its two earlier Fusion posts, and states what the aicharts coding-agent snapshot can and cannot show about the new harness. Every percentage below is a Cognition-reported measurement unless the text says otherwise.

## Where the 39% comes from

The headline chart in the announcement plots configurations on the Artificial Analysis Coding Agent Index v1.5, the composite score that Artificial Analysis publishes for coding-agent harness and model combinations. The chart shows each configuration’s index score and its mean cost per run relative to the provider’s own harness. Two pairs carry the comparison. Cognition labels OpenAI’s GPT-6 Astra as Astra, and the tables below keep Cognition’s labels.

*Headline comparison on the Artificial Analysis Coding Agent Index v1.5, as reported by Cognition on September 11, 2026*
| Configuration | Index score | Mean cost per run | Cost change |
| --- | --- | --- | --- |
| Codex, Astra (max) | 61.6 | $7.47 | reference |
| Devin Fusion, Astra + SWE-2 | 58.9 | $4.54 | 39% lower |
| Claude Code, Fable 5.1 (max) | 62.2 | $12.36 | reference |
| Devin Fusion, Fable 5.1 + SWE-2 | 61.7 | $7.90 | 36% lower |

The 39% is the Astra pair: Devin Fusion, Astra + SWE-2 at $4.54 per run against Codex, Astra (max) at $7.47. That saving came with an index score 2.7 points lower (58.9 against 61.6). The Fable pair saved 36% ($7.90 against $12.36) and gave up 0.5 points (61.7 against 62.2). “Up to 39%” therefore names the larger of two savings, and the larger saving is also the one with the larger score gap.

The same chart places other single-model configurations lower on the index: Claude Opus 5 (max) on Claude Code at 60, Kimi K3 on Kimi Code CLI at 52, and Qwen3.8 Max on Claude Code and DeepSeek V4 on Codex at 43. Those points show where the two Fusion pairs sit among current harnesses; they are not part of the 39% calculation.

## Same lead, with and without a sidekick

The post also reports a five-benchmark table that holds the lead model constant and adds SWE-2, Cognition’s own model, as the sidekick. Cognition states that it partnered with Artificial Analysis and Vals AI for these evaluations. FrontierCode is Cognition’s own benchmark. Each cell is a score followed by mean cost per task.

*Lead model alone versus Fusion with an SWE-2 sidekick, as reported by Cognition on September 11, 2026*
| Benchmark | Fable 5.1 | Fusion (Fable 5.1 + SWE-2) | Astra | Fusion (Astra + SWE-2) |
| --- | --- | --- | --- | --- |
| DeepSWE 1.1 | 64.3 at $14.63 | 63.1 at $7.88 (−46%) | 67.6 at $7.88 | 67.3 at $4.69 (−40%) |
| Terminal-Bench 4 | 57.6 at $17.46 | 56.1 at $13.37 (−23%) | 55.6 at $10.08 | 50.0 at $6.06 (−40%) |
| SWE-Atlas QnA | 64.8 at $7.57 | 65.9 at $5.00 (−34%) | 61.8 at $5.72 | 59.4 at $3.59 (−37%) |
| Vals Code Migration | 54.6 at $70.97 | 57.3 at $42.00 (−41%) | 67.7 at $44.36 | 61.3 at $35.51 (−20%) |
| FrontierCode 1.1 (Extended) | 63.6 at $2.68 | 63.5 at $1.67 (−38%) | 63.1 at $2.62 | 63.4 at $2.34 (−11%) |

The cost reductions in this table run from 11% to 46%. None of them is 39%, because this table compares Fusion with the same lead model running alone in Devin, while the headline compares Fusion with another vendor’s harness. In six of the 10 cells the score moved by 1.5 points or less. The larger moves are Astra on Terminal-Bench 4 (55.6 to 50.0), Astra on Vals Code Migration (67.7 to 61.3), Astra on SWE-Atlas QnA (61.8 to 59.4), and Fable 5.1 on Vals Code Migration, where Fusion scored higher (54.6 to 57.3).

Read the table as a per-benchmark, per-pair result. A single Fusion percentage without the lead model, the sidekick, the benchmark, the thinking level, and the date is an incomplete citation.

## Earlier Fusion numbers used different comparisons

Cognition has published Fusion cost figures in three posts since June, and they are not the same measurement. The [June 29, 2026 introduction](https://cognition.com/blog/devin-fusion) first reported a 35% cost reduction on its FrontierCode benchmark, then revised it to up to 60% on FrontierCode 1.1 Extended data updated August 7, 2026 for Opus and GPT-5.5-level leads. The same post reported 41% for Fable 5 as lead, measured before Fable 5 access was suspended.

The [August 31, 2026 Fable 5.1 post](https://devin.ai/blog/fable-5-1) reported Devin Fusion at $1.43 per FrontierCode 1.1 Extended task against $2.68 for Fable 5.1 alone, a 47% saving, without naming the sidekick. The September table reports the named Fable 5.1 and SWE-2 pair at $1.67 on the same benchmark, a 38% saving. The two published costs differ; only the September figure names both models.

## A more expensive sidekick did not cost more

Cognition reports that a stronger sidekick can leave the total unchanged. With GPT-6 Astra at the high thinking level as lead on FrontierCode, replacing GPT-5.6 Luna with SWE-2 raised the sidekick’s list price by 275%, lowered the cost per task by 2%, and raised the score from 62.0 to 63.4.

*Sidekick comparison with an Astra lead on FrontierCode, as reported by Cognition*
| Sidekick | List price | Score at cost per task |
| --- | --- | --- |
| GPT-5.6 Luna (high) | $0.20 per million tokens | 62.0 at $2.39 |
| SWE-2 (medium) | $0.75 per million tokens (+275%) | 63.4 at $2.34 (−2%) |

Cognition’s explanation is that a stronger sidekick needs fewer attempts and fewer review rounds from the lead, so the lead’s token use falls. The post makes the same argument for the lead seat: with the same sidekick, Fable 5 as lead cost 9% less than Opus 4.8 while scoring higher on FrontierCode, even though Fable’s per-token price is about twice as high. Both are Cognition’s measurements of its own harness, and both support its stated conclusion that cost per completed task is the number to compare, rather than price per token.

## What the aicharts snapshot shows

The aicharts coding-agent chart is a checked snapshot of the public [Artificial Analysis coding-agents page](https://artificialanalysis.ai/agents/coding-agents/), retrieved Sep 25, 2026, 2:39 PM UTC. The snapshot stores Coding Agent Index v1.5 with DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA as component benchmarks. Compare its Fusion rows only with configurations measured in this same source cohort.

The snapshot includes both Fusion configurations and the two lead models in their single-model harnesses, so readers can compare the source-published rows within one index version.

*Single-model configurations from the aicharts snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Model | Agent | Setting | AA Index | Mean cost per task |
| --- | --- | --- | --- | --- |
| Fable 5.1 (with fallback) | Claude Code | max | 62.2 | $12.39 |
| GPT-6 Astra | Codex | max | 61.6 | $7.47 |

Cognition’s headline chart reports 62.2 for Fable 5.1 (max) on Claude Code and 61.6 for Astra (max) on Codex. The snapshot and Cognition’s chart are separate observations. Differences in index versions, configurations, or evaluation dates can affect their scores; a shared model name does not identify the cause. Compare Fusion with a baseline measured under the same protocol.

The snapshot retrieved Sep 25, 2026, 2:39 PM UTC includes 2 Fusion configurations. The values below are copied from that snapshot and belong to its index version, not to Cognition’s chart.

*Fusion configurations in the aicharts snapshot retrieved Sep 25, 2026, 2:39 PM UTC*
| Model | Agent | Setting | AA Index | Mean cost per task |
| --- | --- | --- | --- | --- |
| Claude Fable 5.1 XHigh + SWE-2 Medium | Devin Fusion CLI | default | 61.7 | $7.90 |
| GPT-6 Astra XHigh + SWE-2 Medium | Devin Fusion CLI | default | 58.9 | $4.54 |

On September 11, 2026, the live Artificial Analysis page listed two Fusion configurations: Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium and Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium. Those labels name the lead thinking level as XHigh and the sidekick level as Medium. Cognition’s FrontierCode figures use the medium thinking level for the lead. Configuration labels differ across the three tables in this note, so carry the label with the number.

> **How to read a Fusion claim**
>
> Ask which two configurations are compared, on which benchmark and index version, at which thinking levels, and on which date. Then read the score beside the cost. A 39% saving with a 2.7-point lower score and a 36% saving with a 0.5-point lower score are different results.

## Limits

- Every percentage in Cognition’s posts is a vendor measurement of its own harness. Cognition names Artificial Analysis and Vals AI as evaluation partners for the September table, and FrontierCode is Cognition’s own benchmark.
- Scores and costs belong to the named lead, sidekick, benchmark, index version, thinking level, and date. Cognition revised its June figure from 35% to up to 60% after a data update, and later posts report different configurations.
- Mean cost per run or per task is an evaluation average. It is not a subscription price, a production invoice, or a guarantee for a specific repository.
- The chart uses the snapshot and index version named above. Results added to the live source page appear only after a snapshot includes them.
- Fusion depends on how well the lead delegates. Cognition’s own June examples include a hard TypeScript feature whose score fell from 54 to 27 when the coding was delegated, so the average saving does not describe every task.

## Current comparison: coding agents

The interactive chart shows the current source snapshot across benchmark performance, cost, speed, and token use.

[Explore chart](https://aicharts.io/)

## Sources

- [Introducing Fusion in Devin Desktop & CLI](https://cognition.com/blog/local-fusion). Cognition, 2026. The September 11, 2026 announcement reports the headline Artificial Analysis Coding Agent Index v1.5 comparison, the five-benchmark lead-versus-Fusion table, the sidekick price comparison, and the recommended Fable 5.1 and SWE-2 pairing.
- [Devin Fusion: Frontier Performance at 60% Lower Cost](https://cognition.com/blog/devin-fusion). Cognition, 2026. The June 29, 2026 post introduces the lead-and-sidekick architecture, reports the initial 35% FrontierCode cost reduction, the later up-to-60% figure with data updated August 7, 2026, and the 41% Fable 5 result.
- [Fable 5.1 in Devin and Why It’s Cheaper than Opus 5](https://devin.ai/blog/fable-5-1). Devin, 2026. The August 31, 2026 post reports Fable 5.1 and Devin Fusion cost per task on FrontierCode 1.1 Extended at the medium thinking level without naming the Fusion sidekick.
- [Coding Agents](https://artificialanalysis.ai/agents/coding-agents/). Artificial Analysis, 2026. The public coding-agents comparison is the source of the aicharts coding-agent snapshot. Model names, agent harnesses, settings, AA Index scores, and mean API costs are Artificial Analysis measurements.

## Related analysis

- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
- [GPT-5.6 Luna made one daily news page cost about $0.10](https://aicharts.io/blog/small-models-have-arrived)
