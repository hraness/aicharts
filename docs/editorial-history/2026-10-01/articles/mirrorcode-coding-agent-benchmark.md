# MirrorCode scores complete-program reimplementation

Epoch AI and METR hide the original source and grade a replacement on held-out tests under project-scale budgets.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

[MirrorCode](https://epoch.ai/MirrorCode) is a long-horizon coding benchmark developed by Epoch AI and METR. It asks an agent to reimplement an entire program without access to the original source code. The replacement must match the reference program on end-to-end tests, including held-out tests that the agent cannot inspect while developing.

That makes the task different from fixing one repository issue or adding one feature. The agent must infer a complete behavioral contract, build a replacement, and close enough edge cases to satisfy strict evaluation. The benchmark measures sustained autonomous implementation at project scale, under budgets large enough to support hours or days of work.

## What MirrorCode measures

MirrorCode contains 25 target programs drawn from several areas of computing:

- Unix utilities
- Data serialization and query tools
- Bioinformatics
- Language interpreters and static analysis
- Cryptography and compression

The agent works in a sandbox without internet access and cannot inspect the original repository. It receives enough observable behavior for a replacement to be possible, then must produce the same outputs as the target. Held-out tests prevent success through a lookup table limited to visible examples.

MirrorCode is therefore a behavioral reimplementation benchmark. It does not require the replacement to share the original architecture, internal interfaces, or source layout. It asks whether the agent can reproduce externally tested behavior closely enough to count as complete.

## Project-scale budgets are part of the result

Epoch AI gives agents substantially more time and inference than most software-engineering benchmarks. One of the largest runs reported on the source page cost about $2,600 and continued for 19 days without human intervention. That example belongs to the broader benchmark work, not the dated seven-day leaderboard configuration.

These budgets make difficult project-scale attempts possible, but they also bound what the result means. MirrorCode shows what an agent can complete when allowed to work for a long time with a large token allowance. It does not show that the same result is economical for routine use or reachable in a normal interactive session.

## MirrorCode leaderboard on August 5, 2026

The Epoch AI page captured on August 5, 2026 UTC reports the maintained configuration named **MirrorCode (ML, +Private, 2L)**. It uses 15 Medium and Large target programs and excludes the Small bucket. Each target is evaluated in two implementation languages, generally Go and Ada, producing 30 tasks. Each task receives three attempts, with up to 10 billion tokens and seven days per attempt.

*MirrorCode solve@100% snapshot, captured August 5, 2026 UTC*
| Model | Solve@100% |
| --- | --- |
| Claude Fable 5 | 64% |
| GPT-5.6 Sol | 20% |
| GPT-5.4 | 16% |
| GPT-5.5 | 10% |

> **Configuration matters**
>
> These values belong to the dated ML, +Private, 2L leaderboard. They are not directly comparable with the [MirrorCode paper](https://arxiv.org/abs/2606.30182), which evaluated all 25 targets, used six implementation languages for Small and Medium tasks, and generally used a one-billion-token budget outside the Large tasks. The paper also did not impose the dated leaderboard’s seven-day limit.

A model name and percentage are incomplete without the target subset, language mapping, private tasks, attempt count, token budget, and time limit. The maintained leaderboard can also change after this article's observation date.

## The gotree near-solve

One run shows both the capability MirrorCode captures and the strictness of its scoring. Claude Opus 4.7 reimplemented gotree, a Go bioinformatics toolkit with roughly 16,000 lines and more than 40 commands. The run lasted 14 hours and cost $251. Epoch AI estimates that a human engineer without AI assistance would need about two to 17 weeks for the same task.

The replacement passed 2,000 of 2,001 tests. It failed one edge case in a niche command that manipulates date annotations. Epoch describes the implementation as near-perfect because it covered essentially all scoped functionality, but it was not a strict solve.

That distinction prevents a mostly working program from being reported as finished. It also exposes a limitation of a binary solve rate: the score does not show how close an unsuccessful attempt came. The gotree result counts differently from a full solve even though it demonstrates substantial autonomous engineering work.

## Data contamination remains a limitation

MirrorCode targets are based on open-source programs. A model may have encountered their source, documentation, tests, or related material during pretraining. That could make reimplementation easier than work on a genuinely unseen private program.

The benchmark authors used a memorization screen to investigate this risk. Agents succeeded on several targets that passed the screen and failed on some targets where the screen found evidence of memorization. They interpret that pattern as evidence that memorized code did not dominate the results.

The screen cannot prove that training data had no influence. Epoch AI expects the measured capability to generalize to unseen codebases, but that remains an inference rather than a result directly established by MirrorCode.

## How to interpret MirrorCode

MirrorCode provides evidence that leading coding agents can sustain autonomous work across complete software projects. The strongest systems can finish a meaningful share of difficult reimplementation tasks under large budgets. Near-solves such as gotree show that strict completion can understate the amount of working functionality produced.

The benchmark does not establish that an agent can maintain an evolving production system, collaborate with a team, resolve ambiguous product requirements, or leave code that remains maintainable. Its question is narrower: can the agent reproduce a complete program's externally tested behavior?

## Current comparison: coding agents

The interactive chart shows the current source snapshot across benchmark performance, cost, speed, and token use.

[Explore chart](https://aicharts.io/)

## Sources

- [MirrorCode: What's the largest software project AI can complete on its own?](https://epoch.ai/MirrorCode). Epoch AI, 2026. Epoch AI's maintained benchmark page defines the current leaderboard configuration, resource budgets, result snapshot, gotree example, and contamination caveat.
- [MirrorCode: How Far Can Frontier AI Models Go on Long-Horizon Coding Tasks?](https://arxiv.org/abs/2606.30182). arXiv, 2026. The MirrorCode paper documents the broader task set and evaluation design. Its configuration differs from the maintained leaderboard summarized here.

## Related analysis

