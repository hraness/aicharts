// bun scripts/import-local-nonlanguage.mjs [directory containing <model>/perf.yaml and whisper-bench.txt]
// Without the optional mirror, read the same immutable upstream files over HTTPS.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const qualcomm = "16d6969035dcb8508f0e0780899bd7c5cf404f04";
const whisper = "5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec";
const base = "qualcomm/ai-hub-models";
const mirror = process.argv[2];
const models = [
  ["stable_diffusion_v1_5", "Stable Diffusion 1.5", "Image generation", "Text encoder, U-Net denoiser and VAE are timed separately. A complete image requires repeated denoising."],
  ["stable_diffusion_v2_1", "Stable Diffusion 2.1", "Image generation", "Text encoder, U-Net denoiser and VAE are timed separately. A complete image requires repeated denoising."],
  ...[["tiny", "Tiny"], ["base", "Base"], ["small", "Small"], ["large_v3_turbo", "Large v3 Turbo"]].map(([id, name]) =>
    ["whisper_" + id, "Whisper " + name, "Transcription", "Separate encoder and decoder graph calls. Encoder input represents 30 seconds of audio. Decoding a transcript requires multiple calls."]),
  ["melotts_en", "MeloTTS English", "Speech synthesis", "Individual synthesis graphs, including duration prediction, flow and decoder. Whole-utterance duration depends on input text."],
  ["melotts_es", "MeloTTS Spanish", "Speech synthesis", "Individual synthesis graphs, including duration prediction, flow and decoder. Whole-utterance duration depends on input text."],
  ["minilm_v2", "all-MiniLM-L6-v2", "Embeddings", "128 input tokens and a 384-dimensional sentence embedding."],
  ["openai_clip", "CLIP ViT-B/16", "Embeddings", "Image and text similarity model with 224 × 224 image input."],
  ["yamnet", "YAMNet", "Audio classification", "Audio event classification from a 96 × 64 log-mel patch."],
  ["depth_anything_v2", "Depth Anything V2 Small", "Depth estimation", "Monocular depth estimation at 518 × 518."],
  ["easyocr", "EasyOCR", "Optical character recognition", "Separate text detection and character recognition graphs. The published detector input is 608 × 800."],
  ["real_esrgan_x4plus", "Real-ESRGAN x4plus", "Image super-resolution", "Fourfold image upscaling from a 128 × 128 input tile."],
  ["basicvsr_pp", "BasicVSR++", "Video super-resolution", "Two 64 × 64 input frames. Optical flow, propagation and reconstruction are timed individually."],
  ["video_mae", "VideoMAE", "Video understanding", "Video classification at 224 × 224."],
  ["mediapipe_pose", "MediaPipe Pose", "Pose estimation", "Separate pose detection and landmark graphs."],
  ["yolov8_det", "YOLOv8n", "Object detection", "Object detection at 640 × 640."],
];

async function source(local, repo, rev, path) {
  if (mirror) return readFile(join(mirror, local), "utf8");
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${rev}/${path}`);
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  return response.text();
}
const runtimes = {
  RUNTIME_TFLITE: "TFLite", RUNTIME_ONNX: "ONNX Runtime", RUNTIME_QNN_DLC: "QNN DLC",
  RUNTIME_QNN_CONTEXT_BINARY: "QNN context binary", RUNTIME_PRECOMPILED_QNN_ONNX: "Precompiled QNN ONNX", RUNTIME_VOICE_AI: "Voice AI",
};
function platform(device) {
  if (device.startsWith("Samsung Galaxy")) return "Android";
  if (device.startsWith("Snapdragon X Elite") || device.startsWith("Snapdragon X2")) return "Windows on Arm";
  if (device.startsWith("Arduino")) return "ARM Linux boards";
  if (device.endsWith("QRD")) return "Snapdragon reference phones";
  return "Qualcomm edge & automotive";
}
const aliasesYaml = await source("similar_devices.yaml", base, qualcomm, "src/qai_hub_models/similar_devices.yaml");
const projectedDevices = new Set(Object.keys(Bun.YAML.parse(aliasesYaml).devices));
const suites = [];
for (const [id, model, task, conditions] of models) {
  const path = `src/qai_hub_models/models/${id}/perf.yaml`;
  const yaml = await source(id + "/perf.yaml", base, qualcomm, path);
  const profiles = Bun.YAML.parse(yaml).performance_metrics;
  const runs = [];
  const identities = new Set();
  const jobs = new Set();
  const multi = new Set(profiles.map(r => r.component)).size > 1;
  for (const r of profiles) {
    if (r.profile_job.status !== "Passed" || r.device.includes("(Proxy)") || projectedDevices.has(r.device)) continue;
    const memory = r.metrics.estimated_peak_memory_range_mb;
    const graphMs = r.metrics.inference_time_milliseconds;
    assert(Number.isFinite(graphMs) && graphMs > 0 && memory && Number.isFinite(memory.min) && Number.isFinite(memory.max) && 0 <= memory.min && memory.min <= memory.max);
    assert(runtimes[r.runtime] && r.profile_job.id);
    assert(!jobs.has(r.profile_job.id), "Duplicate physical job " + r.profile_job.id);
    jobs.add(r.profile_job.id);
    const key = [r.device, r.component, r.precision, r.runtime].join("|");
    assert(!identities.has(key), id + ": duplicate " + key);
    identities.add(key);
    const versions = Object.entries(r.tool_versions ?? {}).sort().map(([tool, version]) => tool + " " + version).join(", ");
    const placement = Object.entries(r.metrics.layer_counts ?? {}).filter(([unit]) => unit !== "total").sort().map(([unit, layers]) => layers + " " + unit.toUpperCase()).join(" / ");
    const stage = r.component.replaceAll("_", " ");
    runs.push({
      device: r.device, platform: platform(r.device), model: multi ? model + " · " + stage : model, ...(multi ? {stage} : {}),
      config: [runtimes[r.runtime], r.precision.replace("PRECISION_", "").replaceAll("_", " "), r.metrics.primary_compute_unit].join(" · "),
      values: {graphMs, inferencePeakLowMB: memory.min, inferencePeakHighMB: memory.max},
      protocol: [versions, placement].filter(Boolean).join(" · "),
      note: "Qualcomm AI Hub profile " + r.profile_job.id,
      source: "https://aihub.qualcomm.com/jobs/" + r.profile_job.id,
    });
  }
  assert(runs.length > 0);
  suites.push({id: "qai-" + id.replaceAll("_", "-"), task, title: model + " on Snapdragon", source: `https://github.com/${base}/blob/${qualcomm}/${path}`,
    description: conditions + " Qualcomm AI Hub reports time per graph execution and an estimated range for the inference phase’s memory impact. Loading and device capacity are separate. Only directly profiled hardware is included.",
    metrics: ["graphMs", "inferencePeakLowMB", "inferencePeakHighMB"], runs});
}

const benchPath = "scripts/bench-all-gg.txt";
const bench = await source("whisper-bench.txt", "ggml-org/whisper.cpp", whisper, benchPath);
const whisperRuns = [];
const aliases = {"M2 ULTRA":"Apple M2 Ultra", "V100":"Tesla V100", "DGX Spk.":"DGX Spark"};
for (const line of bench.split("\n")) {
  if (!line.startsWith("|")) continue;
  const [hardware, backend, checkpoint, threads, flash, enc, dec, batch, prompt, commit] = line.split("|").slice(1,-1).map(s => s.trim());
  if (hardware === "---" || hardware === "GPU" || hardware === "CPU") continue;
  assert(/^[a-f0-9]{7,8}$/.test(commit) && /^[01]$/.test(flash) && /^\d+$/.test(threads));
  const times = [enc, dec, batch, prompt].map(Number);
  assert(times.every(t => Number.isFinite(t) && t >= 0) && times.slice(0,3).every(t=>t>0));
  whisperRuns.push({device: aliases[hardware] ?? hardware, platform: hardware.startsWith("M") ? "Apple silicon Macs" : "NVIDIA GPUs",
    model: "Whisper " + checkpoint, config: `${backend} · ${threads} thread${threads === "1" ? "" : "s"} · flash attention ${flash === "1" ? "on" : "off"} · build ${commit}`,
    values:{whisperEncodeMs:times[0], whisperDecodeMs:times[1], whisperBatchMs:times[2], ...(times[3] > 0 ? {whisperPromptMs:times[3]} : {})}, protocol:"whisper.cpp build " + commit, note:times[3] === 0 ? "The publisher rounded prompt timing to 0.00 ms/token." : "whisper.cpp build " + commit});
}
assert(whisperRuns.length > 0);
suites.push({id:"whisper-cpp-stages", task:"Transcription", title:"Whisper encoder and decoder speed", source:`https://github.com/ggml-org/whisper.cpp/blob/${whisper}/${benchPath}`,
  description:"whisper.cpp microbenchmarks use synthetic inputs. Encoder time is per call. Decoder timings are per token with a single token, a five-token batch, or a 256-token prompt. Each row retains its build, thread count and attention setting. End-to-end transcription depends on the audio and decoded length.",
  metrics:["whisperEncodeMs","whisperDecodeMs","whisperBatchMs","whisperPromptMs"], runs:whisperRuns});
// Wan's results are published as a raster table. Each pair is seconds / reported peak GB,
// in the figure's order of one, four and eight GPUs. Keep the authors' combined device labels.
const wan = "https://github.com/Wan-Video/Wan2.2/blob/1ea34ff48f87168174e12956e200b1d908b1c5ff";
const wanRuns = [];
for (const [gpu, model, resolution, pairs] of [
  ["RTX 4090","TI2V-5B text-to-video","720p",[[534.7,22.9],[231.3,22.6],[157.2,22.6]]],
  ["RTX 4090","TI2V-5B image-to-video","720p",[[524.8,22.8],[227.3,22.6],[160.1,22.6]]],
  ["H20","T2V-A14B","480p",[[1133.9,41.3],[306.6,40.9],[170.5,26.2]]],
  ["H20","T2V-A14B","720p",[[4048.7,59.8],[1067.8,51.7],[564.7,37.0]]],
  ["H20","I2V-A14B","480p",[[1117.4,41.0],[305.4,40.8],[173.4,26.1]]],
  ["H20","I2V-A14B","720p",[[4054.7,59.7],[1076.9,51.6],[577.0,37.0]]],
  ["A100/A800","T2V-A14B","480p",[[785.7,41.3],[215.2,40.9],[119.9,26.3]]],
  ["A100/A800","T2V-A14B","720p",[[2735.7,59.8],[725.3,51.7],[386.7,37.0]]],
  ["A100/A800","I2V-A14B","480p",[[810.0,41.0],[215.4,40.7],[121.6,26.1]]],
  ["A100/A800","I2V-A14B","720p",[[2810.9,59.7],[730.5,51.6],[393.4,37.0]]],
  ["H100/H800","T2V-A14B","480p",[[326.9,41.3],[91.7,40.9],[51.5,26.3]]],
  ["H100/H800","T2V-A14B","720p",[[1041.5,59.8],[288.7,51.7],[155.1,37.1]]],
  ["H100/H800","I2V-A14B","480p",[[327.8,41.0],[92.4,40.8],[52.9,26.1]]],
  ["H100/H800","I2V-A14B","720p",[[1055.9,59.7],[290.4,51.6],[159.0,37.0]]],
]) {
  for (const [i, [latency, peakGpuGB]] of pairs.entries()) {
    const count = [1,4,8][i];
    const small = model.startsWith("TI2V-5B");
    const settings = [
      count > 1 ? "Ulysses " + count : "Single GPU", small || count === 1 ? "model offload + dtype conversion" : "DiT + T5 FSDP",
      small ? "T5 on CPU" : "", /^(H100|H20)/.test(gpu) ? "FlashAttention 3" : "",
    ].filter(Boolean).join(" · ");
    wanRuns.push({platform:"NVIDIA GPUs", device:count === 1 ? gpu : count + " × " + gpu, model:"Wan 2.2 " + model,
      config:resolution + " · " + settings, protocol:"Warm mean · " + settings, note:"Prompt extension disabled", values:{latency, peakGpuGB}});
  }
}
suites.push({id:"wan22-multigpu",task:"Video generation",title:"Wan 2.2 video generation on one to eight GPUs",source:wan+"/README.md#computational-efficiency-on-different-gpus",
  description:"Average total time after warm-up and peak GPU memory from the Wan team. Text and image inputs are separate. Paired accelerator names reproduce the publisher’s grouped results. GPU count describes the complete system needed. Frame count and steps are unspecified in the table.",
  metrics:["latency","peakGpuGB"],runs:wanRuns});

const musicSource = "https://github.com/andrade0/musicgen-mlx/blob/3c2451568b56297cd8443c4e2a7d09093ee89f96/README.md#performance";
suites.push({id:"musicgen-mlx", task:"Music generation", title:"MusicGen on Apple silicon", source:musicSource,
  description:"The MLX port’s author measured generation of eight seconds on M4 Max with MLX 0.21. T5 runs in PyTorch on CPU. Model downloads are approximate.",
  metrics:["latency"], runs:[
    {model:"MusicGen Small",config:"Mono · 300M",latency:6.3,note:"Reported download about 1.2 GB."},
    {model:"MusicGen Stereo Large",config:"Stereo · 3.3B",latency:24,note:"Approximate elapsed time. Stereo EnCodec runs in PyTorch. Reported download about 6.5 GB."},
  ].map(({model, config, latency, note})=>({platform:"Apple silicon Macs",device:"M4 Max",model,config,values:{latency},note,protocol:"8 s output · MLX 0.21"}))});
suites.push({id:"audiocraft-mlx-music", task:"Music generation", title:"MusicGen medium and large on M4 Max", source:"https://github.com/theashishmaurya/mlx-audiocraft/blob/bd969249949729dc907f28522377378d382b1ed1/README.md#benchmark-m4-max-64-gb",
  description:"The MLX AudioCraft maintainer reports approximate elapsed time to generate ten seconds of music. The host had 64 GB of unified memory.",
  metrics:["latency"],runs:[["MusicGen Medium",17],["MusicGen Large",35]].map(([model,latency])=>({platform:"Apple silicon Macs",device:"M4 Max",capacity:"64 GB unified memory",model,config:"MLX AudioCraft · 10 s output",protocol:"MLX AudioCraft · 10 s output · 64 GB host",values:{latency},note:"Approximate elapsed time."}))});

for (const suite of suites) {
  const keys = suite.runs.map(run => [run.platform, run.device, run.model, run.config].join("|"));
  assert.equal(new Set(keys).size, keys.length, suite.id + ": indistinguishable runs");
}
const payload = '{"schemaVersion":1,"suites":[\n' + suites.map(({runs,...s}) => JSON.stringify(s).slice(0,-1) + ',"runs":[\n' + runs.map(r=>JSON.stringify(r)).join(",\n") + '\n]}').join(",\n") + '\n]}\n';
await Bun.write("data/local-hardware-nonlanguage.json", payload);
console.log(suites.length, "suites,", suites.reduce((n,s)=>n+s.runs.length,0), "direct profiles");
