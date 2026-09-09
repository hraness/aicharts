import checkedSnapshot from "../data/benchmark-atlas-audio.json";
import type { BenchmarkAtlasDataset, BenchmarkAtlasEntry, BenchmarkAtlasPoint } from "./benchmark-atlas";
import { AUDIO_MODELS, AUDIO_SOURCE_REVISION, audioSnapshotSchema } from "./benchmark-atlas-audio-data";

const snapshot = audioSnapshotSchema.parse(checkedSnapshot);
const source = {
  name: "Hugging Face Open ASR Leaderboard",
  url: `https://huggingface.co/datasets/hf-audio/open-asr-leaderboard-results/blob/${AUDIO_SOURCE_REVISION}/english_short_latest.csv`,
  methodologyUrl: "https://github.com/huggingface/open_asr_leaderboard",
} as const;

export const AUDIO_ATLAS_ENTRIES = [{
  id: "open-asr-ami-cleaned",
  name: "Open ASR · meeting transcription",
  version: snapshot.version,
  category: "audio",
  question: "Which open-weight speech models make fewer errors in English meetings?",
  summary: "Ten selected configurations on the same cleaned meeting-transcription test. These are publisher-reported results with different inference pipelines.",
  source,
  measure: "Word error rate (WER), %; lower is better. Counts substituted, missing, and extra words.",
  comparisonRule: "Compare only the AMI-Cleaned English test in this September 4, 2026 snapshot. Keep the model version and publisher scoring protocol fixed.",
  limitations: [
    "A selected open-weight comparison, not the full leaderboard or a top-ten list.",
    "Inference pipelines differ. The published rows do not identify exact run dates, decoding settings, checkpoint revisions, or execution records.",
    "Short speech clips do not test whole-meeting speaker attribution, punctuation quality, other languages, or live response time.",
    "No uncertainty is published; small differences do not establish a reliable winner. WER can exceed 100% when extra words are inserted.",
  ],
  coverage: "charted",
  tags: ["audio", "speech", "transcription", "ASR", "WER", "English", "meetings", "AMI", "open weights", "Whisper", "Parakeet", "Cohere", "Qwen", "Granite", "Voxtral"],
}] as const satisfies readonly BenchmarkAtlasEntry[];

export const AUDIO_ATLAS_DATASETS: readonly BenchmarkAtlasDataset[] = [{
  benchmarkId: "open-asr-ami-cleaned",
  version: snapshot.version,
  score: { label: "Word error rate", unit: "% WER", direction: "lower", minimum: 0 },
  source: { name: source.name, url: source.url, revision: snapshot.source.revision, retrievedAt: snapshot.source.retrievedAt },
  observedAt: snapshot.observedAt,
  evidenceLabel: "Open ASR owner-reported · selected open-weight configurations",
  configurationLabel: "Published model configuration",
  comparabilityNote: "Same AMI-Cleaned English test and publisher scoring protocol. Inference pipelines differ; exact per-run configurations are not published. Lower word-error rate is better. This is not a speed, speaker-attribution, or overall audio-quality ranking.",
  points: AUDIO_MODELS.map<BenchmarkAtlasPoint>(model => {
    const row = snapshot.rows.find(candidate => candidate.modelId === model.modelId);
    if (!row) throw new Error(`Checked audio model missing: ${model.modelId}.`);
    return {
      id: model.id, label: model.label, model: model.label, provider: model.provider,
      harness: "Open ASR published configuration", effort: null, score: row.wer,
      costUsd: null, uncertainty: null, sourceUrl: source.url,
      details: [
        { label: "Source model ID", value: row.modelId },
        { label: "Test", value: "AMI-Cleaned · English · test split" },
        { label: "Scoring", value: "Publisher English normalization and compound-aware word-error rate" },
        { label: "Exact execution configuration", value: "Not published with this result; current launcher documentation is not a run receipt" },
        { label: "Source snapshot", value: "September 4, 2026; individual run date not published" },
      ],
    };
  }),
}];
