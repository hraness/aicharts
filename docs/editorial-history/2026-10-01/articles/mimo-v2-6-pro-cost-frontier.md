# MiMo-V2.6-Pro pairs a 46.3 score with $0.133 per task

Artificial Analysis records an Intelligence Index score of 46.3 at $0.133 per task for MiMo-V2.6-Pro in the snapshot retrieved Sep 23, 2026, 1:38 PM UTC.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

Xiaomi announced the MiMo-V2.6 series in a release note dated September 22, 2026, with weights, a technical report, training environments, and training code published together. The flagship, MiMo-V2.6-Pro, is a sparse mixture-of-experts model with 1.02 trillion total and 42 billion active parameters, a context window of 1 million tokens, text, image, video, and audio input with text output, and an MIT license. Xiaomi’s [release note](https://mimo.mi.com/docs/en-US/news/latest/v2-6) says the model scores 46 on the Artificial Analysis Intelligence Index, “surpassing Kimi K3 and Qwen3.8 Max to become the most powerful open-source model available,” while conceding a gap to Claude Fable 5.1 and GPT-6 Astra.

The same day, Deedy Das (@deedydas), a partner at Menlo Ventures, [posted on X](https://x.com/deedydas/status/2102293684767412393) that he had tried the model and was impressed: it was very cheap against Kimi K3, GLM 5.3, and DeepSeek V4, was in his words “unquestionably on the Pareto frontier,” answered a cybersecurity prompt that he says most models refuse, offered a faster paid mode, and handled video, speech, and music tasks well. He concluded that it is “too early to tell if it’s the best open source model, but it is a pretty strong contender.”

## What the 46 measures

The [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/models) is a composite of 10 independently run evaluations, weighted 30% agents, 20% coding, 20% scientific reasoning, and 30% general capability. The snapshot uses version 4.3.2, and its components are AA-Briefcase v1.1, GDPval-AA v2.1, AutomationBench-AA, Terminal-Bench 4.0, SciCode, Humanity's Last Exam, GDP.pdf, CritPt, AA-Omniscience, AA-LCR v1.1. Xiaomi’s 46 is Artificial Analysis’s measurement, not a self-reported score.

The [Artificial Analysis model page](https://artificialanalysis.ai/models/mimo-v2-6-pro), captured September 22, 2026 UTC, lists the model as open weights, released September 21, 2026, with an index score of 46, ranked first of 114 in its comparison class of large open-weights models, where the median score is 18. It records Xiaomi’s API prices of $0.435 per million input tokens and $0.87 per million output tokens with a 99% cache discount, an output speed of 110.8 tokens per second on Xiaomi’s API, and a weighted cost of $0.13 per index task. Running the whole index generated 140 million output tokens and cost $206.66, which the page calls somewhat verbose for its class.

Xiaomi’s own evaluation table, printed in the [model card](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-RL) and the technical report, shows a profile the composite hides. Against Claude Opus 5 in Xiaomi’s runs, MiMo-V2.6-Pro is close on agentic knowledge work (GDPval-AA 1673 against 1708; AutomationBench 53.1 against 50.3) and on long-horizon coding (DeepSWE v1.1 71.9 against 74.0), and well behind on terminal work (Terminal-Bench 4.0 34.9 against 49.0). Those are Xiaomi’s own runs under its evaluation setup, so they show the shape of the model rather than an independent ranking.

## Where it sits on the measured cost frontier

The aicharts capability and cost chart is a checked snapshot of the public [Artificial Analysis models leaderboard](https://artificialanalysis.ai/models), restricted to current, non-estimated configurations with a complete per-task cost breakdown under index version 4.3.2. Cost per task is Artificial Analysis’s weighted average of what each evaluation cost at the provider’s list prices, including cached input, so it already reflects the token mix each model produced.

In the snapshot retrieved Sep 23, 2026, 1:38 PM UTC, MiMo-V2.6-Pro scores 46.3 at $0.133 per Intelligence Index task and used 64,276 output tokens per task. It is on the cost frontier: no other configuration scores at least as high at no greater cost, with a strict improvement on at least one measure.

Its frontier neighbors are GPT-6 Luna (max) at 37.3 for $0.068 below it, and GPT-6 Sol (max) at 47.5 for $1.06 above it. The next step up the frontier buys 1.2 points for 7.9x the cost.

The 17 configurations that score higher all cost more; the cheapest of them, GPT-6 Sol (max), costs 7.9x as much per task. The 23 configurations that cost less all score lower; the best of them, GPT-6 Luna (max), scores 37.3, 9.1 points below.

Five other configurations in the snapshot score within one index point of MiMo-V2.6-Pro. The table lists them cheapest first, with each cost as a multiple of MiMo-V2.6-Pro’s $0.133.

*Configurations within one Intelligence Index point of MiMo-V2.6-Pro in the aicharts snapshot retrieved Sep 23, 2026, 1:38 PM UTC*
| Configuration | Intelligence Index | Cost per task | Multiple of MiMo-V2.6-Pro’s cost | Output tokens per task |
| --- | --- | --- | --- | --- |
| GPT-6 Astra (low) | 45.8 | $0.818 | 6.1x | 4,433 |
| Claude Fable 5.1 (Adaptive Reasoning, Low Effort, Default Fallback) | 46.8 | $2.37 | 17.8x | 21,562 |
| Grok 4.7 (high) | 46.3 | $2.73 | 20.5x | 65,901 |
| Grok 4.7 (xhigh) | 46.4 | $3.74 | 28.1x | 80,561 |
| Qwen3.8 Max (0902) | 45.4 | $5.41 | 40.6x | 107,730 |

## Das’s price multiples against measured cost per task

Das wrote that “with some standard assumptions” the model is “15x cheaper than Kimi K3, 6x cheaper than GLM 5.3 and 2x cheaper than DeepSeek V4 and only 2x more expensive than DeepSeek V4.1 Flash” (“assuming agentic coding and how much is cache hits”). Those are estimates from list prices under a workload he assumed, not measured costs. He also quoted Xiaomi’s prices of $0.0036 per million cached input tokens, $0.435 per million input tokens, and $0.87 per million output tokens, which match the Artificial Analysis page and the first-party endpoint listed on OpenRouter.

The snapshot offers a different ratio for the same models: measured cost per Intelligence Index task, which folds in each model’s verbosity and cache use on one shared task set. Agreement between the ratios does not establish that the workloads match. Differences can reflect token mix, cache use, the chosen configuration, or the prices used in each calculation.

*Models Das and Xiaomi name, as stored in the aicharts snapshot retrieved Sep 23, 2026, 1:38 PM UTC. The measured multiple is the configuration’s cost per Intelligence Index task divided by MiMo-V2.6-Pro’s. Das’s multiples are restated in the same direction, so his “2x more expensive than DeepSeek V4.1 Flash” appears as 0.5x.*
| Configuration | Intelligence Index | Cost per task | Measured multiple of MiMo-V2.6-Pro’s cost | Das’s stated multiple of MiMo-V2.6-Pro’s price |
| --- | --- | --- | --- | --- |
| Kimi K3 (max) | 43.6 | $2.00 | 15.0x (−2.7 points) | 15x |
| GLM-5.3 (max) | 44.8 | $2.01 | 15.1x (−1.5 points) | 6x |
| DeepSeek V4 Pro 0813 (Reasoning, Max Effort) | 36.0 | $0.674 | 5.1x (−10.3 points) | 2x |
| DeepSeek V4.1 Flash (Reasoning, Max Effort) | 39.5 | $0.265 | 2.0x (−6.9 points) | 0.5x |
| Qwen3.8 Max (0902) | 45.4 | $5.41 | 40.6x (−0.9 points) | not stated |

Two cautions apply to every row. A cost multiple without the score gap is incomplete; a model that costs a fifth as much and scores ten points lower is a different proposition from one that costs a fifth as much at the same score. And the DeepSeek row is the snapshot’s closest same-name configuration to the “DeepSeek V4” Das named; he did not specify which DeepSeek V4 variant or effort level he priced.

## UltraSpeed costs 10x for a claimed up-to-20x

Xiaomi’s release note says MiMo-V2.6-Pro also ships in an UltraSpeed mode on its open platform and desktop client, “up to 20x inference speed.” The [OpenRouter listing](https://openrouter.ai/xiaomi/mimo-v2.6-pro-ultraspeed) for that edition, captured September 22, 2026 UTC, describes it as built from the same checkpoint and prices Xiaomi’s endpoint at $4.35 per million input tokens, $8.70 per million output tokens, and $0.036 per million cached input tokens: 10x the standard prices on every line.

Das reports that in his use the mode delivered about 3x throughput on OpenRouter, with a median of about 150 tokens per second, for “10x the net price.” That is one person’s throughput on one router on launch day. Artificial Analysis measured the standard model at 110.8 tokens per second on Xiaomi’s API and had not published an UltraSpeed measurement when this note was written, so the 20x claim remains Xiaomi’s. Das’s public bio lists OpenRouter, the router he measured on, among his investments.

## The cybersecurity lead is on one kind of task

Das called the model “insane at cyber,” citing a CyberGym score of 95 and one prompt about finding buffer overflows in an image library that the model answered where, in his experience, most models refuse. Xiaomi’s table supports a narrower statement.

CyberGym asks an agent to reproduce a known vulnerability in real open-source software: given the project and a description of the bug, produce an input that triggers that specific crash. Xiaomi reports 94.0 for MiMo-V2.6-Pro and 95.1 for MiMo-V2.6-Flash, against 40.0 for MiMo-V2.5-Pro. Two details bound that number. The [technical report](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-RL/blob/main/MiMo_V2_6_technical_report.pdf) footnotes that Xiaomi corrected what it calls flawed CyberGym evaluation environments using its own oracle, which accepts a proof of concept only when the sanitizer-reported vulnerability type and crash location both match, so the score was not produced under the public CyberGym protocol. And the frontier columns of the table are blank for CyberGym, so the table offers no same-protocol comparison with Claude Opus 5, GPT-5.6 Sol, or Claude Fable 5.

Where the table does compare, the lead disappears. On ExploitGym, which measures turning a vulnerability into a working exploit, MiMo-V2.6-Pro scores 17.8 against 30.3 for GPT-5.6 Sol. On ExploitBench, which scores progress through exploitation stages, it scores 47.9 against 78.5. On SEC Bench Pro, which reproduces complex vulnerabilities from bug reports, it scores 66.3 against 79.1. The report explains the emphasis: Xiaomi trained the model with reinforcement learning on vulnerability reproduction because OSS-Fuzz supplies tens of thousands of confirmed instances with a cheap, deterministic reward, and its published training environments include that task family.

> **How to read the cyber claim**
>
> MiMo-V2.6-Pro reproduces described vulnerabilities in real code at a rate Xiaomi measured far above its predecessor, under Xiaomi’s corrected protocol, with no frontier model measured the same way. On exploitation benchmarks Xiaomi did compare, GPT-5.6 Sol scores higher. Das’s refusal observation is one prompt from one user; the report’s text describes cybersecurity as a training and evaluation domain and does not discuss refusal behavior. Whether a model answers offensive-security prompts is a deployment question that no score in this note measures.

## Multimodal output and the report

Das also reports that the model is good at producing informational videos with speech and sound effects and at composing music in a digital audio workstation. Xiaomi’s release note describes the same capabilities as demonstrations: popular-science videos that call MiMo-V2.5-TTS for voiceover, and an orchestral piece for about ten instruments that the model scored and converted to MIDI. Neither party reports a benchmark for these outputs, so they stay demonstrations.

The technical report’s main subject is how Xiaomi scaled reinforcement learning. The report states that each training step consumed 1,568 samples and 2.7 to 3.7 billion tokens with context lengths up to 1 million tokens, in a fully asynchronous loop. Pro and Flash each completed 30 steps in less than six days, approximately 750,000 trajectories in total, at stated training costs of $2.62 million and $850,000. Xiaomi reports that Pro’s DeepSWE v1.1 score rose from 58.4 to 72.6 across those steps. The report also freezes the mixture-of-experts router during training, grades passing solutions against each other within a group rather than scoring them all alike, and trains across several lightweight harnesses at once; it reports that mean pass rate on three harnesses held out of training rose from about 50% to 66% on DeepSWE v1.1.

The open-source inventory is broader than weights. Xiaomi lists the report, more than 7,000 reinforcement-learning task environments across software engineering, vulnerability reproduction, knowledge work, and web development, an end-to-end training framework, the mini-harnesses used for multi-harness training, and a distilled nine-billion-parameter model for smaller experiments.

## How to read the open-source claim

Xiaomi’s basis for “most powerful open-source model” is one composite, the Intelligence Index, and two named comparators, Kimi K3 and Qwen3.8 Max. The snapshot stores Kimi K3 (max) at 43.6 and Qwen3.8 Max (0902) at 45.4, both below MiMo-V2.6-Pro’s 46.3. The Artificial Analysis page ranks the model first in its open-weights class. The snapshot does not record weight availability, so this note does not rank open models from it; the classification is Artificial Analysis’s. In the snapshot, Claude Fable 5.1 (Adaptive Reasoning, Max Effort, Default Fallback) scores 53.4 at $7.63 and GPT-6 Astra (max) scores 52.7 at $3.26. Xiaomi names both as the closed models it still trails, and Das’s own verdict is that it is “too early to tell if it’s the best open source model, but it is a pretty strong contender.”

## Limits

- Every Xiaomi benchmark figure in this note is a vendor measurement under Xiaomi’s own evaluation setup, and CyberGym uses Xiaomi’s corrected protocol. The Intelligence Index figures are Artificial Analysis measurements under version 4.3.2 and belong to that version’s task mix and weights.
- Cost per Intelligence Index task is an evaluation average at list prices on one shared task set. It is not a coding-agent cost, a production invoice, or a guarantee for a particular workload, and it differs from Das’s per-token multiples by design.
- Das’s throughput, refusal, video, and music observations are one person’s launch-day experience, and he states his own workload assumptions for the price multiples.
- The frontier position, neighbor table, and cost multiples are derived from the snapshot named in each caption and will change as Artificial Analysis adds configurations or the checked snapshot advances.
- aicharts did not run MiMo-V2.6-Pro, test its refusal behavior, or evaluate UltraSpeed. Speed and refusal claims remain with their sources.

## Compare current Intelligence Index configurations

The capability and cost chart plots every comparable configuration in the current snapshot with its cost frontier. The data page defines the index, its evaluations, and its comparison rules.

- [Capability and cost chart](https://aicharts.io/#intelligence-index)
- [Benchmark definitions and data](https://aicharts.io/data)

## Sources

- [Xiaomi just dropped Mimo 2.6 Pro which claims to be the best open source model](https://x.com/deedydas/status/2102293684767412393). X, 2026. The September 22, 2026 post by Deedy Das reports his price multiples and their stated workload assumptions, his frontier judgment, one cybersecurity prompt the model answered, his UltraSpeed throughput on OpenRouter, and his video, music, and technical-report impressions.
- [MiMo-V2.6: Scaling Up Reinforcement Learning for Self-Improvement](https://mimo.mi.com/docs/en-US/news/latest/v2-6). Xiaomi MiMo, 2026. The release note updated September 22, 2026 reports the Intelligence Index claim and its named comparators, the unchanged API pricing statement, the UltraSpeed speed claim, the training step, trajectory, and cost figures, the DeepSWE gains, and the open-source inventory.
- [XiaomiMiMo/MiMo-V2.6-Pro-RL](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-RL). Hugging Face, 2026. The model card reports the MIT license, the 1.02T total and 42B active parameter counts, the 1M-token context length, the modality list, and the evaluation table comparing MiMo-V2.6 Pro and Flash with MiMo-V2.5 Pro, Claude Opus 5, GPT-5.6 Sol, and Claude Fable 5.
- [MiMo-V2.6: Scaling Reinforcement Learning Towards Self-Improvement](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-RL/blob/main/MiMo_V2_6_technical_report.pdf). LLM-Core Xiaomi, 2026. The technical report reports the RL scaling method, the per-step sample and token counts, the vulnerability-reproduction training task and its corrected CyberGym oracle, the multi-harness training result on held-out harnesses, and the evaluation setup behind the printed table.
- [MiMo-V2.6-Pro: Intelligence, Performance & Price Analysis](https://artificialanalysis.ai/models/mimo-v2-6-pro). Artificial Analysis, 2026. The model page captured September 22, 2026 UTC reports the 46 index score, the open-weights label and class rank, the $0.435 and $0.87 per million token prices with a 99% cache discount, the 110.8 tokens per second output speed, the $0.13 cost per index task, and the index run cost.
- [Xiaomi: MiMo-V2.6-Pro-UltraSpeed](https://openrouter.ai/xiaomi/mimo-v2.6-pro-ultraspeed). OpenRouter, 2026. The listing captured September 22, 2026 UTC reports the UltraSpeed prices of $4.35 per million input tokens, $8.70 per million output tokens, and $0.036 per million cached input tokens on Xiaomi’s endpoint, and describes the edition as built from the same checkpoint as MiMo-V2.6-Pro.
- [LLM Leaderboard](https://artificialanalysis.ai/models). Artificial Analysis, 2026. The public models leaderboard is the source of the aicharts Intelligence Index snapshot. Scores, per-task costs, and output tokens are Artificial Analysis measurements under Intelligence Index v4.3.2.

## Related analysis

- [Open models closed SemiAnalysis composites, not this table](https://aicharts.io/blog/open-models-coding-agent-benchmarks)
- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
- [GPT-5.6 Luna made one daily news page cost about $0.10](https://aicharts.io/blog/small-models-have-arrived)
