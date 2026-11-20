// bun scripts/import-local-device-benchmarks.mjs [--check]
// Set BENCHMARK_CACHE to a directory containing perf/<family>.yaml and the vendor Markdown snapshots
// for an offline replay. Absent cache entries are fetched from immutable revisions.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const database = fileURLToPath(new URL("../data/local-hardware-language.json", import.meta.url));
const qpin = "16d6969035dcb8508f0e0780899bd7c5cf404f04";
const npin = "513dcd18291e587c80928911a480761352f3c2d8";
const qrepo = "qualcomm/ai-hub-models";
const qpath = "src/qai_hub_models/models";
const nrepo = "NVIDIA/TensorRT-Edge-LLM";
const npath = "docs/source/user_guide/performance/performance-benchmarks.md";
// All model directories with language-token measurements in this snapshot,
// excluding the two ASR decoders (their token rates do not measure audio speed).
const families = `
falcon_v3_7b_instruct gemma_4_e2b_it gemma_4_e4b_it gpt_oss_20b granite_4_0_micro
ibm_granite_v3_1_8b_instruct indus_1b intern3_5_vl_2b intern3_5_vl_4b jais_6p7b_chat
lfm2_5_1_2b_instruct lfm3_1_7b lfm3_vl_2b llama_v3_1_8b_instruct llama_v3_1_sea_lion_3_5_8b_r
llama_v3_2_1b_instruct llama_v3_2_3b_instruct llama_v3_2_3b_instruct_ssd llama_v3_8b_instruct
llama_v3_elyza_jp_8b llama_v3_taide_8b_chat ministral_3_3b_instruct_2512 mistral_7b_instruct_v0_3
phi_3_5_mini_instruct phi_4_mini_instruct plamo_1b qwen2_5_vl_7b_instruct qwen2_7b_instruct
qwen3_0_6b qwen3_1_7b qwen3_4b qwen3_4b_instruct_2507 qwen3_5_0_8b qwen3_5_2b qwen3_8b
qwen3_vl_2b_instruct qwen3_vl_4b_instruct qwen3_vl_8b_instruct smolvlm2_2_2b_instruct
`.trim().split(/\s+/);

async function source(local, url) {
  if (process.env.BENCHMARK_CACHE) {
    const cached = Bun.file(join(process.env.BENCHMARK_CACHE, local));
    if (await cached.exists()) return cached.text();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function platform(device) {
  if (device.startsWith("Samsung")) return "Android";
  if (device.startsWith("Snapdragon X")) return "Snapdragon laptops";
  if (device.startsWith("SA")) return "Automotive development boards";
  return "Edge AI boards";
}

async function qualcomm() {
  const suite = {
    id: "qcom-aihub-language", task: "Language", title: "Qualcomm AI Hub language inference",
    source: `https://github.com/${qrepo}/tree/${qpin}/${qpath}`,
    description: "Qualcomm AI Hub reports prompt and generation rates by configured context limit, compute unit, precision and runtime. Context is the configured limit. Vision-capable model entries measure language tokens only. Input lengths and peak memory are unpublished in these records.",
    metrics: ["prompt", "generation"], modelSources: {}, runs: [],
  };
  for (const family of families) {
    const path = `${qpath}/${family}/perf.yaml`;
    const raw = await source(`perf/${family}.yaml`, `https://raw.githubusercontent.com/${qrepo}/${qpin}/${path}`);
    for (const row of Bun.YAML.parse(raw).performance_metrics) {
      const versions = Object.entries(row.tool_versions ?? {}).map(([tool, version]) => `${tool} ${version}`).join(", ");
      for (const m of row.llm_metrics ?? []) {
        const values = {};
        if (m.prefill_tokens_per_second > 0) values.prompt = m.prefill_tokens_per_second;
        if (m.tokens_per_second > 0) values.generation = m.tokens_per_second;
        if (!Object.keys(values).length) continue;
        const model = row.component;
        const permalink = `https://github.com/${qrepo}/blob/${qpin}/${path}`;
        if (suite.modelSources[model] && suite.modelSources[model] !== permalink) throw new Error(`Ambiguous source for ${model}`);
        suite.modelSources[model] = permalink;
        const config = [row.precision.replace("PRECISION_", ""), m.desired_compute_unit.toUpperCase(),
          row.runtime.replace("RUNTIME_", "").replaceAll("_", " "), `${m.context_length} context`, versions].filter(Boolean).join(" · ");
        suite.runs.push({ device: row.device, platform: platform(row.device), model, config, values });
      }
    }
  }
  return suite;
}

async function nvidia() {
  const text = await source("nvidia.md", `https://raw.githubusercontent.com/${nrepo}/${npin}/${npath}`);
  const body = text.split("### v0.10.0 Runtime Performance Dashboard")[1].split("### v0.10.0 Collection Method")[0];
  const suites = ["language", "vision"].map(kind => ({
    id: `trt-edge-${kind}`, task: kind === "vision" ? "Vision and language" : "Language", title: kind === "vision" ? "NVIDIA edge visual inference" : "NVIDIA edge language inference",
    source: `https://github.com/${nrepo}/blob/${npin}/${npath}#v0100-runtime-performance-dashboard`,
    description: "TensorRT Edge-LLM 0.10.0 end-to-end inference, one stream and ten warmups. Generation counts accepted tokens for speculative modes. Peak GPU memory is the vendor's inference measurement in MB. It does not establish total device memory required.",
    metrics: kind === "vision" ? ["prompt", "generation", "gpuMemoryMB", "visionEncoderMs"] : ["prompt", "generation", "gpuMemoryMB"],
    runs: [],
  }));
  let device;
  for (const line of body.split("\n")) {
    if (line.startsWith("#### ")) device = line.replace("#### v0.10.0 ", "");
    if (!line.startsWith("| ")) continue;
    const cells = line.slice(1, -1).split("|").map(x => x.trim());
    const [model, kind, mode, precision, batch, seq, , prefill, vision, visualTokens, , generation, , memory] = cells;
    if (batch !== "1") continue;
    if (!device || !["LLM", "VLM"].includes(kind) || cells.length !== 14) throw new Error(line);
    const numeric = x => Number(x.replaceAll(",", ""));
    const values = { prompt: numeric(prefill), generation: numeric(generation), gpuMemoryMB: numeric(memory) };
    const configParts = [precision, mode, `${seq} input tokens`];
    if (kind === "VLM" && vision !== "-") {
      values.visionEncoderMs = numeric(vision);
      configParts.push(`${visualTokens} visual tokens/run`);
    }
    suites[Number(kind === "VLM")].runs.push({ device, platform: "NVIDIA edge systems", model, config: configParts.join(" · "), values });
  }
  return suites;
}

async function litert() {
  const repo = "google-ai-edge/LiteRT-LM";
  const pin = "449dbb22e21991905b01b0e5e8832100159a1d5d";
  const raw = await source("litert.md", `https://raw.githubusercontent.com/${repo}/${pin}/README.md`);
  const table = raw.split("| Model | Device | Backend | Prefill (tokens/sec) |")[1].split("\n\n")[0];
  const devices = {
    "MacBook Pro<br>(2023 M3)": "MacBook Pro · M3 (2023)",
    "Samsung S24<br>(Ultra)": "Samsung Galaxy S24 Ultra",
    "Samsung S25<br>(Ultra)": "Samsung Galaxy S25 Ultra",
  };
  const runs = [];
  for (const line of table.split("\n").slice(2)) {
    const [model, reportedDevice, backend, prompt, generation, context] = line.slice(1, -1).split("|").map(x => x.trim());
    const device = devices[reportedDevice];
    if (!device) throw new Error(line);
    runs.push({ device, platform: device.startsWith("MacBook") ? "Apple silicon Macs" : "Android",
      model, config: `${backend} · ${context} context`, values: { prompt: Number(prompt), generation: Number(generation) } });
  }
  return { id: "google-litert-language", task: "Language", title: "Google LiteRT-LM single-stream inference",
    source: `https://github.com/${repo}/blob/${pin}/README.md#supported-models-and-performance`,
    description: "Google AI Edge measured 1,024 prompt tokens and 256 generated tokens. Android performance clocks were locked. The table identifies the backend and configured context size for each run.",
    metrics: ["prompt", "generation"], runs };
}

const generated = [await qualcomm(), ...await nvidia(), await litert()];
for (const suite of generated) {
  const seen = new Set();
  if (!suite.runs.length) throw new Error(`No rows for ${suite.id}`);
  for (const r of suite.runs) {
    const id = JSON.stringify([r.device, r.model, r.config]);
    if (seen.has(id)) throw new Error(`Repeated configuration: ${id}`);
    seen.add(id);
    if (Object.values(r.values).some(v => !Number.isFinite(v) || v <= 0)) throw new Error(JSON.stringify(r));
  }
  console.log(`${suite.id}: ${suite.runs.length} configurations`);
}
const format = suite => {
  const { runs, ...metadata } = suite;
  return JSON.stringify(metadata, null, 2).slice(0, -2) + ',\n  "runs": [\n' +
    runs.map(r => "    " + JSON.stringify(r)).join(",\n") + "\n  ]\n}";
};
const updated = '{ "suites": [\n' + generated.map(format).join(",\n") + "\n]}\n";
if (JSON.stringify(JSON.parse(updated).suites) !== JSON.stringify(generated)) throw new Error("Round-trip failure");
if (process.argv.includes("--check")) {
  if (updated !== await readFile(database, "utf8")) throw new Error("Device evidence has changed");
} else {
  await writeFile(database, updated);
}
