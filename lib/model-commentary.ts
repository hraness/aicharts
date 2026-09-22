import modelCommentaryData from "@/data/model-commentary.json";

import { canonicalModelIdSchema } from "./model-card-data";
import type { Result } from "./result";
import { parseResult, z } from "./schema";

const MAX_TWEETS_PER_MODEL = 5;
const MAX_TWEET_TEXT_CHARS = 2_000;
const X_STATUS_ID_PATTERN = /^[0-9]{8,20}$/u;
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;

function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isXStatusUrl(value: string, statusId: string, handle: string): boolean {
  const url = parseHttpsUrl(value);
  if (url === null) return false;
  const host = url.hostname.toLocaleLowerCase("en-US");
  if (host !== "x.com" && host !== "twitter.com" && host !== "www.x.com" && host !== "www.twitter.com") {
    return false;
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{8,20})\/?$/u);
  return match?.[1]?.toLocaleLowerCase("en-US") === handle.toLocaleLowerCase("en-US")
    && match[2] === statusId
    && url.search === ""
    && url.hash === "";
}

const tweetSchema = z.object({
  authorHandle: z.string().regex(X_HANDLE_PATTERN, "Expected a public X handle."),
  authorName: z.string().min(1).max(80).refine(
    value => value === value.trim(),
    "Author name must not have leading or trailing whitespace.",
  ),
  lang: z.string().min(2).max(8),
  postedAt: z.string().refine(
    value => Number.isFinite(Date.parse(value)),
    "postedAt must be a valid timestamp.",
  ),
  statusId: z.string().regex(X_STATUS_ID_PATTERN, "Expected a numeric X status id."),
  text: z.string().min(1).max(MAX_TWEET_TEXT_CHARS).refine(
    value => value === value.trim(),
    "Tweet text must not have leading or trailing whitespace.",
  ),
  url: z.string().url(),
}).strict().readonly();

const noteSchema = z.object({
  canonicalModelId: canonicalModelIdSchema,
  tweets: z.array(tweetSchema).min(1).max(MAX_TWEETS_PER_MODEL).readonly(),
}).strict().readonly();

export const modelCommentarySchema = z.object({
  notes: z.array(noteSchema).min(1).readonly(),
  schemaVersion: z.literal(1),
}).strict().superRefine((value, context) => {
  const modelIds = new Set<string>();
  for (const [noteIndex, note] of value.notes.entries()) {
    if (modelIds.has(note.canonicalModelId)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate commentary for ${note.canonicalModelId}.`,
        path: ["notes", noteIndex, "canonicalModelId"],
      });
    }
    modelIds.add(note.canonicalModelId);
    const statusIds = new Set<string>();
    for (const [tweetIndex, tweet] of note.tweets.entries()) {
      if (statusIds.has(tweet.statusId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate status ${tweet.statusId}.`,
          path: ["notes", noteIndex, "tweets", tweetIndex, "statusId"],
        });
      }
      statusIds.add(tweet.statusId);
      if (!isXStatusUrl(tweet.url, tweet.statusId, tweet.authorHandle)) {
        context.addIssue({
          code: "custom",
          message: "Tweet URL must be the public x.com or twitter.com status for that handle and id.",
          path: ["notes", noteIndex, "tweets", tweetIndex, "url"],
        });
      }
    }
  }
}).readonly();

export type ModelCommentaryTweet = z.infer<typeof tweetSchema>;
export type ModelCommentaryNote = z.infer<typeof noteSchema>;
export type ModelCommentary = z.infer<typeof modelCommentarySchema>;

export function parseModelCommentary(
  value: unknown,
): Result<ModelCommentary, z.ZodError> {
  return parseResult(modelCommentarySchema, value);
}

const checkedCommentary = parseModelCommentary(modelCommentaryData);
if (!checkedCommentary.ok) {
  throw new Error(
    `Checked model commentary is invalid: ${checkedCommentary.error.message}`,
    { cause: checkedCommentary.error },
  );
}

export const MODEL_COMMENTARY = checkedCommentary.value;

const commentaryByCanonicalId = new Map(
  MODEL_COMMENTARY.notes.map(note => [note.canonicalModelId, note]),
);

export function modelCommentaryForCanonicalId(
  canonicalModelId: string,
): ModelCommentaryNote | undefined {
  return commentaryByCanonicalId.get(canonicalModelId);
}

export function officialXStatusUrl(tweet: ModelCommentaryTweet): string {
  return `https://x.com/${tweet.authorHandle}/status/${tweet.statusId}`;
}
