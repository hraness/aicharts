# GPT-5.6 Luna made one daily news page cost about $0.10

French-Owen reports about $0.10 per run versus about $1 with earlier Sonnet-class models, from one person’s experiment.

By Hraness.

Figures come from the cited primary sources and the aicharts datasets. aicharts did not rerun the reported benchmarks.

A lower-cost model changes a product only when it meets a written quality bar for a repeated task at a price the product can carry. Inference is the work of running a trained model to produce an answer, and every use adds to that bill. In an [essay published August 26, 2026](https://calv.info/small-models-have-arrived), software founder Calvin French-Owen reports that GPT-5.6 Luna built his personalized daily news page for about $0.10 per run. Earlier, more expensive models that he describes as Sonnet class cost him roughly $1 for the same prompt. At one run a day, that difference is about $3 versus $30 over 30 days, before the rest of the product’s costs.

That example captures the opportunity and its limit. The cost difference could make a frequent-use feature affordable. It comes from one person’s experiment, without a published run count, written quality standard, usage breakdown, or exact Sonnet model. It shows that the economics may have shifted for some workloads. A team still has to test its own task before choosing a model.

## What French-Owen observed

French-Owen describes several weeks of using GPT-5.6 Luna across source code, email, and a personal knowledge base. He reports generation at about 100 tokens per second, a measure of how quickly it writes text. Tokens are the small text units a model reads and writes. He says complicated research sessions, including searches across thousands of emails, often cost tens of cents. His clearest product example is a prompt that researches his interests and assembles a small site with stories from Hacker News, Reddit, and X. He judged Luna’s output useful at an average cost of about $0.10.

*Results French-Owen reports from his own GPT-5.6 Luna use*
| Work | Reported result | Scope |
| --- | --- | --- |
| Interactive generation | about 100 tokens per second | Observed speed during his use |
| Complicated research sessions | tens of cents | API charges for his research workflow |
| Personalized daily news page | $0.10 with Luna versus roughly $1 with Sonnet-class models | Luna is his reported average; the Sonnet-class figure is his approximate earlier cost |

Here, small is a relative product label. It describes a lower-cost model tier, not a disclosed parameter count or a universal capability boundary. [OpenAI describes GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) as a model for cost-sensitive, high-volume work. On August 29, 2026, its listed text prices were $0.20 per million input tokens and $1.20 per million output tokens. External searches and other paid tools can add charges, so token prices alone cannot predict the final cost of a feature.

## Why a tenfold cost drop matters

A product pays the model cost every time a person uses an AI feature. Frequent use multiplies a small per-run difference. French-Owen’s daily-news figures show the scale:

*Illustrative model cost for one run a day over 30 days*
| Cost per run | Runs | 30-day model cost |
| --- | --- | --- |
| $1.00 | 30 | $30.00 |
| $0.10 | 30 | $3.00 |

A $30 monthly subscription has little room for a $30 model bill per customer after hosting, customer support, payment fees, the cost of finding customers, and the rest of the service. A $3 model bill leaves much more room. The lower amount can also support a free trial, more frequent refreshes, or several model attempts when the first answer fails.

Lower model cost does not prove that a business will work. People still need to value the product, return to it, trust its output, and pay enough to cover every expense. Cost removes one constraint. It cannot find customers, keep them, make the product distinct, or make it reliable.

## Start with the cheapest model that meets the requirement

French-Owen says he still chooses the most capable and expensive models for difficult coding work. That preference does not conflict with his enthusiasm for Luna. The two model tiers serve different jobs. A frontier model, meaning the highest-capability tier available at the time, can be worth its higher price when the task is unusually difficult or a mistake is expensive. A lower-cost model can be the better choice for work that is frequent, well specified, and checkable against a written rule.

The useful decision rule is to choose the least expensive model that reliably clears the requirement for a specific task. A tool that sorts support requests, a personalized digest, and a large code migration have different success criteria. Testing them as one category hides the trade-off that matters.

> **Choose by task**
>
> Use the lowest-cost model that passes a realistic test set. Send a task to a stronger model when its complexity, uncertainty, or consequences justify the extra cost.

## Measure the cost of a successful result

Published token prices are useful inputs, but customers experience completed work. A cheaper request can become expensive when it needs several retries, produces output that requires extensive review, or calls paid tools. A more expensive request can save money when it succeeds more often. Compare the full cost of reaching an acceptable result.

*A practical model-selection scorecard*
| Measure | Question to answer |
| --- | --- |
| Quality | How often does the result meet a written acceptance rule? |
| Total cost | What do model tokens, tools, retries, and review cost per accepted result? |
| Response time | How long does the complete task take, including tools and retries? |
| Consistency | Does the model keep passing across different examples and repeated runs? |
| Failure cost | What happens when the answer is wrong, incomplete, or unsafe to use? |

The last question changes the acceptable quality bar. A misspelled heading in a private draft may take a few seconds to fix. An incorrect financial action, destructive code change, or exposed private record can cause lasting harm. Higher-consequence work needs stronger safeguards and may justify a more capable model, human review, or both.

## Test the work you plan to ship

A benchmark, meaning a standardized model test, can help narrow the field. A product decision still needs examples from the real workflow. Before switching a feature to a lower-cost model, assemble a small evaluation that includes ordinary cases, difficult cases, and the failures that matter most.

- Define one task precisely, including the information and tools the model may use.
- Write an acceptance rule that a reviewer can apply consistently.
- Run both models on the same representative examples and settings.
- Record accepted results, total cost, complete response time, retries, and review effort.
- Set an escalation rule for cases the lower-cost model cannot handle reliably.

Run this evaluation again after a model, prompt, tool, or the kinds of inputs people send have changed. The best choice can move as prices and capabilities change. A dated result is evidence for that configuration and workload, not a permanent rank for the model.

## What the sources establish

French-Owen’s experiment supports a narrow conclusion: GPT-5.6 Luna produced results he considered acceptable for several substantial, repeated tasks at prices that changed how he thought about products. OpenAI’s pricing and description confirm that Luna is intended for cost-sensitive, high-volume work. Neither source establishes equal quality across models or guarantees that a particular consumer product will succeed.

The usable change is a wider set of priced options. Reserve an expensive model for work that needs its capability. Use a cheaper model where speed, repetition, and cost matter more, and only after it passes the product’s own test.

A later note asks a different cost question. [What a 30% science-agent result measures](/blog/terminal-bench-science) looks at Terminal-Bench-Science 0.1, where scientists selected the task set and the benchmark reports resolution beside evaluation cost and token use. That page is about scientific research workflows, not everyday product features.

## Sources

- [Small Models Have Arrived](https://calv.info/small-models-have-arrived). calv.info, 2026. The August 26, 2026 essay reports GPT-5.6 Luna speed and costs from French-Owen’s research and personalized-news experiments.
- [GPT-5.6 Luna Model](https://developers.openai.com/api/docs/models/gpt-5.6-luna). OpenAI, 2026. The official model page describes GPT-5.6 Luna as a cost-sensitive, high-volume model and lists its current token prices and additional cost conditions.

## Related analysis

- [Highest AA Index and lowest cost pick different coding agents](https://aicharts.io/blog/aa-index-cost-coding-agents)
