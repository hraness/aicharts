import { SITE_URL } from "./catalog";

/** The release data endpoint. `/api` documents it from the lists below. */
export const RELEASES_PATH = "/api/releases";
export const RELEASES_URL = SITE_URL + RELEASES_PATH;

/** Headers the endpoint sends; the API page quotes them. */
export const RELEASES_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
} as const;

export type ApiField = Readonly<{ name: string; type: string; about: string }>;

export type ApiObject = Readonly<{
  id: "response" | "release" | "terminalBench" | "epoch" | "pricing" | "source";
  caption: string;
  fields: readonly ApiField[];
}>;

const field = (name: string, type: string, about: string): ApiField => ({ name, type, about });

/**
 * Every field in the response, in the order the JSON lists them. A unit test
 * compares these names with the published data, so a new field fails the
 * check until it is documented here.
 */
export const API_OBJECTS: readonly ApiObject[] = [
  {
    id: "response",
    caption: "The response",
    fields: [
      field(
        "schemaVersion",
        "number",
        "Currently 2. It goes up when a field is renamed, removed or changes meaning; new fields can appear without a change.",
      ),
      field("updatedAt", "string", "When the data last changed, as an ISO 8601 time in UTC."),
      field("snapshotDate", "string", "The UTC day of that change, YYYY-MM-DD."),
      field("sources", "array", "Where each part of the data comes from, with its license."),
      field("releases", "array", "One item per model, newest release first."),
    ],
  },
  {
    id: "release",
    caption: "Each item in releases",
    fields: [
      field("slug", "string", "Stable id, also the model's page: /models/{slug}."),
      field("name", "string", "Display name, such as Claude Opus 5.5."),
      field("provider", "string", "anthropic, openai or google."),
      field("releaseDate", "string", "Launch day, YYYY-MM-DD."),
      field("deprecated", "boolean", "true once a newer release in the same line has come out."),
      field("supersededOn", "string or null", "The day that newer release came out; null while the model is current."),
      field("announcementUrl", "string or null", "The lab's launch post or model page."),
      field("pricing", "object or null", "List API prices; null when LiteLLM does not list the model."),
      field("terminalBench", "object or null", "Its run on the Terminal-Bench leaderboard; null when it has none."),
      field("epoch", "array", "Its Epoch AI scores; empty when Epoch has none."),
    ],
  },
  {
    id: "terminalBench",
    caption: "terminalBench: one run on the Terminal-Bench leaderboard",
    fields: [
      field("version", "string", "The dataset version the trials were graded on, such as 4.1."),
      field("agent", "string", "The coding agent that drove the model, such as Claude Code or Codex."),
      field("agentVersion", "string or null", "The agent's version."),
      field("agentUrl", "string or null", "The agent's home page."),
      field("effort", "string or null", "Reasoning setting: none, minimal, low, medium, high, xhigh or max."),
      field("accuracy", "number", "Percent of trials passed."),
      field("ci95", "number or null", "Half width of the 95% confidence interval, in points."),
      field("trials", "number", "Trials graded: every task, at least five times."),
      field("successes", "number", "Trials passed."),
      field(
        "costPerTaskUsd",
        "number or null",
        "The run's reported API cost divided by its trials, in US dollars; null when it reported none.",
      ),
      field("tokensPerTask.total", "number", "All tokens per trial, input included; 0 when the run reported none."),
      field("tokensPerTask.output", "number", "Output tokens per trial; 0 when the run reported none."),
      field("minutesPerTask", "number or null", "Average wall-clock minutes per trial."),
      field("sourceUrl", "string", "The submission on GitHub."),
    ],
  },
  {
    id: "epoch",
    caption: "Each item in epoch: one Epoch AI score",
    fields: [
      field("benchmark", "string", "mirrorCode, gpqaDiamond or frontierMath."),
      field("effort", "string or null", "The setting Epoch ran; null for the default or when Epoch did not record one."),
      field("score", "number", "Percent, 0 to 100."),
      field("stderr", "number or null", "Standard error, in points."),
      field("runOn", "string or null", "The day Epoch started the run, YYYY-MM-DD."),
    ],
  },
  {
    id: "pricing",
    caption: "pricing: list API prices from LiteLLM",
    fields: [
      field("inputPer1M", "number", "US dollars per million input tokens."),
      field("outputPer1M", "number", "US dollars per million output tokens."),
      field("cachedInputPer1M", "number or null", "US dollars per million cached input tokens."),
      field("maxInputTokens", "number or null", "The longest input the model accepts, in tokens."),
    ],
  },
  {
    id: "source",
    caption: "Each item in sources",
    fields: [
      field("id", "string", "terminal-bench, epoch-ai or litellm."),
      field("name", "string", "The source's name."),
      field("url", "string", "The source's page or file."),
      field("license", "string", "SPDX license id, such as CC-BY-4.0."),
      field("licenseUrl", "string", "The license text."),
      field("attribution", "string", "The credit to keep with any copy of the data."),
      field("covers", "string", "What aicharts takes from it."),
    ],
  },
];
