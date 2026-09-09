import { z } from "./schema";

export const AUDIO_SOURCE_REVISION = "ba5712d5ace8f785fa0daae1aecea8561ecd87c9";
export const AUDIO_SOURCE_URL = `https://huggingface.co/datasets/hf-audio/open-asr-leaderboard-results/raw/${AUDIO_SOURCE_REVISION}/english_short_latest.csv`;
export const AUDIO_SOURCE_SHA256 = "07f02da66f62ea16ee6999163109544e8ffccc5476fd4b73149bc21b1e987451";
export const AUDIO_OBSERVED_AT = "2026-09-04";
export const AUDIO_BENCHMARK_VERSION = "AMI-Cleaned · English test · 2026-09-04";

/** Deliberate cross-developer examples and version baselines, not a top-ten claim. */
export const AUDIO_MODELS = [
  { modelId: "ibm-granite/granite-speech-4.1-2b-nar", id: "granite-speech-4-1-2b-nar", label: "Granite Speech 4.1 2B NAR", provider: "IBM" },
  { modelId: "CohereLabs/cohere-transcribe-03-2026", id: "cohere-transcribe-03-2026", label: "Cohere Transcribe 03-2026", provider: "Cohere" },
  { modelId: "nvidia/canary-qwen-2.5b", id: "canary-qwen-2-5b", label: "Canary-Qwen 2.5B", provider: "NVIDIA" },
  { modelId: "Qwen/Qwen3-ASR-1.7B-hf", id: "qwen3-asr-1-7b-hf", label: "Qwen3-ASR 1.7B HF", provider: "Alibaba" },
  { modelId: "nvidia/parakeet-tdt-0.6b-v2", id: "parakeet-tdt-0-6b-v2", label: "Parakeet TDT 0.6B v2", provider: "NVIDIA" },
  { modelId: "nvidia/parakeet-tdt-0.6b-v3", id: "parakeet-tdt-0-6b-v3", label: "Parakeet TDT 0.6B v3", provider: "NVIDIA" },
  { modelId: "mistralai/Voxtral-Small-24B-2507", id: "voxtral-small-24b-2507", label: "Voxtral Small 24B 2507", provider: "Mistral AI" },
  { modelId: "openai/whisper-large-v3", id: "whisper-large-v3", label: "Whisper large-v3", provider: "OpenAI" },
  { modelId: "facebook/omniASR-LLM-7B-v2", id: "omniasr-llm-7b-v2", label: "omniASR LLM 7B v2", provider: "Meta" },
  { modelId: "openai/whisper-large-v3-turbo", id: "whisper-large-v3-turbo", label: "Whisper large-v3-turbo", provider: "OpenAI" },
] as const;

/** WER counts insertions as errors: it is nonnegative, but is not capped at 100%. */
export const audioRowsSchema = z.array(z.object({
  modelId: z.enum(AUDIO_MODELS.map(model => model.modelId)),
  wer: z.number().finite().min(0),
}).strict()).length(AUDIO_MODELS.length).superRefine((rows, ctx) => {
  const ids = new Set(rows.map(row => row.modelId));
  if (ids.size !== rows.length || AUDIO_MODELS.some(model => !ids.has(model.modelId))) {
    ctx.addIssue({ code: "custom", message: "The selected audio cohort must contain each reviewed model exactly once." });
  }
});

/** Only selected aggregate facts. Model licenses do not license the result dataset. */
export const audioSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.literal(AUDIO_BENCHMARK_VERSION),
  observedAt: z.literal(AUDIO_OBSERVED_AT),
  source: z.object({
    url: z.literal(AUDIO_SOURCE_URL),
    revision: z.literal(AUDIO_SOURCE_REVISION),
    sha256: z.literal(AUDIO_SOURCE_SHA256),
    retrievedAt: z.iso.datetime(),
  }).strict(),
  task: z.object({
    dataset: z.literal("hf-audio/open-asr-leaderboard"),
    configuration: z.literal("ami_cleaned"),
    split: z.literal("test"),
    language: z.literal("English"),
    metricColumn: z.literal("AMI-Cleaned WER"),
    unit: z.literal("% WER"),
  }).strict(),
  rows: audioRowsSchema,
}).strict().superRefine((snapshot, ctx) => {
  if (Date.parse(snapshot.observedAt) > Date.parse(snapshot.source.retrievedAt)) {
    ctx.addIssue({ code: "custom", path: ["source", "retrievedAt"], message: "Audio retrieval cannot precede its published snapshot." });
  }
});

export type AudioSnapshot = z.infer<typeof audioSnapshotSchema>;
