import {
  BLOG_SOURCES,
  callout,
  heading,
  list,
  paragraph,
  table,
  type BlogArticle,
  type InlineContent,
} from "./articles";

export const SMALL_MODELS_ARTICLE_SLUG = "small-models-have-arrived" as const;
export const SMALL_MODELS_ARTICLE_PUBLISHED_AT = "2026-08-28" as const;
export const SMALL_MODELS_ARTICLE_UPDATED_AT = "2026-08-31" as const;

export const FRENCH_OWEN_SMALL_MODELS = {
  publishedOn: "August 26, 2026",
  reported: {
    lunaSpeed: "about 100 tokens per second",
    newsEvalLuna: "$0.10",
    newsEvalSonnet: "$1",
    researchThread: "tens of cents",
  },
} as const;

export const OPENAI_GPT_56_LUNA = {
  documentedOn: "August 29, 2026",
  pricing: {
    inputPerMillionTokens: "$0.20",
    outputPerMillionTokens: "$1.20",
  },
} as const;

function textCell(value: string): InlineContent {
  return [value];
}

export function createSmallModelsHaveArrivedArticle(): BlogArticle {
  return {
    slug: SMALL_MODELS_ARTICLE_SLUG,
    title: "Cheaper AI models can make everyday products viable",
    dek:
      "Lower inference costs can turn a promising demo into a sustainable feature. The practical goal is to use the cheapest model that meets the task’s quality bar.",
    focusPhrase: "small AI models",
    seoDescription:
      "Small AI models can cut inference costs enough to support frequent-use products. Learn how to compare quality, speed, and total cost for your task.",
    keywords: [
      "small AI models",
      "cheap AI models",
      "consumer AI",
      "gpt-5.6-luna",
      "inference cost",
      "AI model selection",
    ],
    publishedAt: SMALL_MODELS_ARTICLE_PUBLISHED_AT,
    updatedAt: SMALL_MODELS_ARTICLE_UPDATED_AT,
    section: "AI model economics",
    showChartCta: false,
    sourceIds: [
      "calvinFrenchOwenSmallModels",
      "openAiGpt56Luna",
    ],
    relatedSlugs: ["aa-index-cost-coding-agents"],
    body: [
      paragraph(
        "A lower-cost AI model can change a product as soon as it meets the quality bar for a repeated task at a sustainable price. Inference is the work of running a trained model to produce an answer, and every use adds to a product’s inference bill. In an ",
        { href: BLOG_SOURCES.calvinFrenchOwenSmallModels.url, text: `essay published ${FRENCH_OWEN_SMALL_MODELS.publishedOn}` },
        `, software founder Calvin French-Owen reports that GPT-5.6 Luna built his personalized daily news page for about ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalLuna} per run. Earlier, more expensive models that he describes as Sonnet class cost him roughly ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalSonnet} for the same prompt. At one run a day, that difference is about $3 versus $30 over 30 days, before the rest of the product’s costs.`,
      ),
      paragraph(
        "That example captures the opportunity and its limit. The cost difference could make a frequent-use feature affordable. It comes from one person’s experiment, without a published run count, written quality standard, usage breakdown, or exact Sonnet model. It shows that the economics may have shifted for some workloads. A team still has to test its own task before choosing a model.",
      ),
      heading("What French-Owen observed"),
      paragraph(
        "French-Owen describes several weeks of using GPT-5.6 Luna across source code, email, and a personal knowledge base. He reports generation at ",
        FRENCH_OWEN_SMALL_MODELS.reported.lunaSpeed,
        `, a measure of how quickly it writes text. Tokens are the small text units a model reads and writes. He says complicated research sessions, including searches across thousands of emails, often cost ${FRENCH_OWEN_SMALL_MODELS.reported.researchThread}. His clearest product example is a prompt that researches his interests and assembles a small site with stories from Hacker News, Reddit, and X. He judged Luna’s output useful at an average cost of about ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalLuna}.`,
      ),
      table(
        "Results French-Owen reports from his own GPT-5.6 Luna use",
        ["Work", "Reported result", "Scope"],
        [
          [
            textCell("Interactive generation"),
            textCell(FRENCH_OWEN_SMALL_MODELS.reported.lunaSpeed),
            textCell("Observed speed during his use"),
          ],
          [
            textCell("Complicated research sessions"),
            textCell(FRENCH_OWEN_SMALL_MODELS.reported.researchThread),
            textCell("API charges for his research workflow"),
          ],
          [
            textCell("Personalized daily news page"),
            textCell(`${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalLuna} with Luna versus roughly ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalSonnet} with Sonnet-class models`),
            textCell("Luna is his reported average; the Sonnet-class figure is his approximate earlier cost"),
          ],
        ],
      ),
      paragraph(
        "Here, small is a relative product label. It describes a lower-cost model tier, not a disclosed parameter count or a universal capability boundary. ",
        { href: BLOG_SOURCES.openAiGpt56Luna.url, text: "OpenAI describes GPT-5.6 Luna" },
        ` as a model for cost-sensitive, high-volume work. On ${OPENAI_GPT_56_LUNA.documentedOn}, its listed text prices were ${OPENAI_GPT_56_LUNA.pricing.inputPerMillionTokens} per million input tokens and ${OPENAI_GPT_56_LUNA.pricing.outputPerMillionTokens} per million output tokens. External searches and other paid tools can add charges, so token prices alone cannot predict the final cost of a feature.`,
      ),
      heading("Why a tenfold cost drop matters"),
      paragraph(
        "A product pays the model cost every time a person uses an AI feature. Frequent use multiplies a small per-run difference quickly. French-Owen’s daily-news example makes that multiplication easy to see:",
      ),
      table(
        "Illustrative model cost for one run a day over 30 days",
        ["Cost per run", "Runs", "30-day model cost"],
        [
          [textCell("$1.00"), textCell("30"), textCell("$30.00")],
          [textCell("$0.10"), textCell("30"), textCell("$3.00")],
        ],
      ),
      paragraph(
        "A $30 monthly subscription has little room for a $30 model bill per customer after hosting, customer support, payment fees, the cost of finding customers, and the rest of the service. A $3 model bill leaves much more room. The lower amount can also support a free trial, more frequent refreshes, or several model attempts when the first answer fails.",
      ),
      paragraph(
        "Lower model cost does not prove that a business will work. People still need to value the product, return to it, trust its output, and pay enough to cover every expense. Cost removes one constraint. It cannot find customers, keep them, make the product distinct, or make it reliable.",
      ),
      heading("Start with the cheapest model that meets the requirement"),
      paragraph(
        "French-Owen says he still chooses the most capable and expensive models for difficult coding work. That preference does not conflict with his enthusiasm for Luna. The two model tiers serve different jobs. A frontier model, meaning the highest-capability tier available at the time, can be worth its higher price when the task is unusually difficult or a mistake is expensive. A lower-cost model can be the better choice for work that is frequent, well specified, and easy to check.",
      ),
      paragraph(
        "The useful decision rule is to choose the least expensive model that reliably clears the requirement for a specific task. A tool that sorts support requests, a personalized digest, and a large code migration have different success criteria. Testing them as one category hides the trade-off that matters.",
      ),
      callout(
        "Choose by task",
        "Use the lowest-cost model that passes a realistic test set. Send a task to a stronger model when its complexity, uncertainty, or consequences justify the extra cost.",
      ),
      heading("Measure the cost of a successful result"),
      paragraph(
        "Published token prices are useful inputs, but customers experience completed work. A cheaper request can become expensive when it needs several retries, produces output that requires extensive review, or calls paid tools. A more expensive request can save money when it succeeds more often. Compare the full cost of reaching an acceptable result.",
      ),
      table(
        "A practical model-selection scorecard",
        ["Measure", "Question to answer"],
        [
          [
            textCell("Quality"),
            textCell("How often does the result meet a written acceptance rule?"),
          ],
          [
            textCell("Total cost"),
            textCell("What do model tokens, tools, retries, and review cost per accepted result?"),
          ],
          [
            textCell("Response time"),
            textCell("How long does the complete task take, including tools and retries?"),
          ],
          [
            textCell("Consistency"),
            textCell("Does the model keep passing across different examples and repeated runs?"),
          ],
          [
            textCell("Failure cost"),
            textCell("What happens when the answer is wrong, incomplete, or unsafe to use?"),
          ],
        ],
      ),
      paragraph(
        "The last question changes the acceptable quality bar. A misspelled heading in a private draft may take a few seconds to fix. An incorrect financial action, destructive code change, or exposed private record can cause lasting harm. Higher-consequence work needs stronger safeguards and may justify a more capable model, human review, or both.",
      ),
      heading("Test the work you plan to ship"),
      paragraph(
        "A benchmark, meaning a standardized model test, can help narrow the field. A product decision still needs examples from the real workflow. Before switching a feature to a lower-cost model, assemble a small evaluation that includes ordinary cases, difficult cases, and the failures that matter most.",
      ),
      list(
        ["Define one task precisely, including the information and tools the model may use."],
        ["Write an acceptance rule that a reviewer can apply consistently."],
        ["Run both models on the same representative examples and settings."],
        ["Record accepted results, total cost, complete response time, retries, and review effort."],
        ["Set an escalation rule for cases the lower-cost model cannot handle reliably."],
      ),
      paragraph(
        "Run this evaluation again after a model, prompt, tool, or the kinds of inputs people send have changed. The best choice can move as prices and capabilities change. A dated result is evidence for that configuration and workload, not a permanent rank for the model.",
      ),
      heading("What has actually arrived"),
      paragraph(
        "French-Owen’s experiment supports a narrow and useful conclusion: GPT-5.6 Luna produced results he considered acceptable for several substantial, repeated tasks at prices that changed how he thought about products. OpenAI’s pricing and description confirm that Luna is intended for cost-sensitive, high-volume work. Neither source establishes equal quality across models or guarantees that a particular consumer product will succeed.",
      ),
      paragraph(
        "The practical shift is a larger range of viable choices. Teams can reserve expensive models for work that benefits from their capability and use cheaper models where speed, repetition, and cost matter more. The opportunity begins only when a lower-cost model passes the product’s own test.",
      ),
      paragraph(
        "A later note asks a different cost question. ",
        { href: "/blog/terminal-bench-science", text: "Whether a 30% science-agent score is a product win" },
        " looks at Terminal-Bench-Science 0.1, where scientists set the evaluation bar and the suite already reports cost and token Pareto. That page is about scientific research workflows, not everyday product features.",
      ),
    ],
  };
}
