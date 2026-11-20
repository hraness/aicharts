export type Run = {
  platform: string;
  device: string;
  model: string;
  config: string;
  values: Partial<Record<string, number>>;
  capacity?: string;
  source?: string;
  storageMiB?: number;
  protocol?: string;
  note?: string;
};

export type Suite = {
  id: string;
  title: string;
  source: string;
  modelSources?: Record<string,string>;
  task?: string;
  description: string;
  metrics: string[];
  runs: Run[];
};


export const metrics: Record<string, { label: string; unit: string; lower: boolean }> = {
  energyJ: {label:"Energy per summary",unit:"J",lower:true},
  bufferMiB: {label:"Model and runtime buffers",unit:"MiB",lower:true},
  summaryQuality: {label:"G-Eval summary score",unit:"0–1",lower:false},
  finalTextMs: {label:"Wait for final transcript",unit:"ms",lower:true},
  tenSecondPeakMiB: {label:"Peak memory on 10 s of audio",unit:"MiB",lower:true},
  ttsInputRate: {label:"Text synthesized",unit:"input tokens/s",lower:false},
  inferenceTokens: {label:"Average inference throughput",unit:"tok/s",lower:false},
  fid: {label:"Image distribution distance",unit:"FID",lower:true},
  queryP90Ms: {label:"90th percentile query",unit:"ms",lower:true},
  sampleRate: {label:"Offline throughput",unit:"samples/s",lower:false},
  residentMB: {label:"Resident memory",unit:"MB",lower:true},
  pipelineMedianMs: {label:"Median pipeline time",unit:"ms",lower:true},
  pipelineMeanMs: {label:"Mean pipeline time",unit:"ms",lower:true},
  executionMs: {label:"Forward execution",unit:"ms",lower:true},
  coldLoadMs: {label:"Cold load",unit:"ms",lower:true},
  forwardRate: {label:"Forward passes",unit:"passes/s",lower:false},
  audioTimeRatio: {label:"Processing / audio",unit:"s/s",lower:true},
  forwardMeanMs: {label:"Mean forward",unit:"ms",lower:true},
  forwardMinMs: {label:"Fastest forward",unit:"ms",lower:true},
  forwardMaxMs: {label:"Slowest forward",unit:"ms",lower:true},
  combinedTokens: {label:"Prompt + output",unit:"tok/s",lower:false},
  peakResidentMiB: {label:"Peak resident memory",unit:"MiB",lower:true},
  stepSeconds: { label: "Denoising step", unit: "s/step", lower: true },
  peakGpuGB: { label: "Peak GPU memory", unit: "GB", lower: true },
  gpuMemoryMB: { label: "Peak GPU memory", unit: "MB", lower: true },
  visionEncoderMs: { label: "Visual encoder time", unit: "ms", lower: true },
  graphMs: { label: "Component latency", unit: "ms", lower: true },
  inferencePeakLowMB: { label: "Estimated inference memory · low", unit: "MB", lower: true },
  inferencePeakHighMB: { label: "Estimated inference memory · high", unit: "MB", lower: true },
  whisperEncodeMs: { label: "Audio encoder call", unit: "ms/call", lower: true },
  whisperDecodeMs: { label: "Single-token decode", unit: "ms/token", lower: true },
  whisperBatchMs: { label: "Batched decode", unit: "ms/token", lower: true },
  whisperPromptMs: { label: "Prompt processing", unit: "ms/token", lower: true },
  prompt: { label: "Read a prompt", unit: "tok/s", lower: false },
  generation: { label: "Generate text", unit: "tok/s", lower: false },
  audio: { label: "Transcribe audio", unit: "× real time", lower: false },
  wer: { label: "Word error rate", unit: "%", lower: true },
  embeddings: { label: "Embed queries", unit: "queries/s", lower: false },
  rerank: { label: "Rerank documents", unit: "documents/s", lower: false },
  retrieval: { label: "Retrieval quality", unit: "NDCG@10", lower: false },
  synthesis: { label: "Generate speech", unit: "× real time", lower: false },
  firstAudio: { label: "Time to first audio", unit: "ms", lower: true },
  tokenLatency: { label: "Time per decoded token", unit: "ms/token", lower: true },
  firstToken: { label: "Time to first token", unit: "ms", lower: true },
  requestMs: { label: "Request latency", unit: "ms", lower: true },
  meanRss: { label: "Mean resident memory", unit: "MB", lower: true },
  latency: { label: "Elapsed time", unit: "s", lower: true },
  peak: { label: "Peak app memory", unit: "MiB", lower: true },
  storage: { label: "Model storage", unit: "MiB", lower: true },
  vramGiB: { label: "Peak GPU allocation", unit: "GiB", lower: true },
  memoryMB: { label: "Reported memory usage", unit: "MB", lower: true },
};
export const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
export const sortNames = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
export const tasks: Record<string, string> = {
  "4167": "Language", "4508": "Language", "15013": "Language", "15021": "Language", "10879": "Language",
  "webllm-m3": "Language", "webgpu-decode": "Language", "webgpu-request": "Language", "pi-llama": "Language",
  "pi-asr": "Transcription", "wk-earnings22": "Transcription", "wk-librispeech": "Transcription",
  "faster-whisper": "Transcription", moi: "Image generation", coreml: "Image generation",
  sana: "Image generation", video: "Video generation", ace: "Music generation",
  "fluid-tts": "Speech synthesis", "hf-gooaq": "Embeddings", "msmarco-v100": "Reranking",
  "qwen-vl-a100": "Vision and language",
};


export const speedKeys = ["generation", "tokenLatency", "requestMs", "firstToken", "audio", "synthesis", "latency", "embeddings", "rerank", "graphMs", "whisperEncodeMs", "prompt", "pipelineMedianMs", "pipelineMeanMs", "forwardMeanMs", "executionMs", "forwardRate", "audioTimeRatio", "combinedTokens", "coldLoadMs","queryP90Ms","sampleRate","finalTextMs","firstAudio","ttsInputRate","inferenceTokens"];
export function measuredMemory(run: Run, suite?: string) {
  if (run.values.bufferMiB !== undefined) return {gib:run.values.bufferMiB / 1024,kind:"Model and runtime buffers"};
  if (run.values.tenSecondPeakMiB !== undefined) return {gib:run.values.tenSecondPeakMiB / 1024,kind:"Peak memory on 10 s of audio"};
  if (run.values.residentMB !== undefined) return {gib:run.values.residentMB*1e6 / 2**30,kind:"Resident memory"};
  if (run.values.peakResidentMiB !== undefined) return { gib: run.values.peakResidentMiB / 1024, kind: "Peak resident memory" };
  if (run.values.peakGpuGB !== undefined) return { gib: run.values.peakGpuGB * 1e9 / 2 ** 30, kind: "Peak GPU memory" };
  if (run.values.gpuMemoryMB !== undefined) return { gib: run.values.gpuMemoryMB * 1e6 / 2 ** 30, kind: "Peak GPU memory" };
  if (run.values.meanRss !== undefined) return { gib: run.values.meanRss * 1e6 / 2 ** 30, kind: "Mean resident RAM" };
  if (run.values.vramGiB !== undefined) return { gib: run.values.vramGiB, kind: "Peak GPU allocation" };
  if (run.values.peak !== undefined) return { gib: run.values.peak / 1024, kind: suite === "moi" || suite?.startsWith("rne-") ? (run.platform === "Android" ? "Peak process PSS" : "Peak physical footprint") : suite?.startsWith("edge-llm-") ? "Peak physical footprint" : "Peak app memory" };
  if (run.values.memoryMB !== undefined) return { gib: run.values.memoryMB * 1e6 / 2 ** 30, kind: run.platform === "NVIDIA GPUs" ? "Reported VRAM" : "Reported RAM" };
  return null;
}

