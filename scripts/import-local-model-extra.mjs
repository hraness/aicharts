// bun scripts/import-local-model-extra.mjs [local directory of pinned publisher files]
// Only source tables are fetched. No inference or benchmark runner is executed.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const mirror = process.argv[2];
const react = ["software-mansion/react-native-executorch", "23f271a9188683d3ac4536b9174386477672cac5"];
const rockchip = ["airockchip/rknn_model_zoo", "837db8e992815ff8647eadb709f07067f4bc3a71"];
const tencent = ["Tencent/ncnn", "2331a364953ba934782673fe32f6bbd0757d55d3"];
const versionDir = "docs/versioned_docs/version-0.11.x/04-benchmarks/";
function link([repo, sha], path) { return `https://github.com/${repo}/blob/${sha}/${path}`; }
async function source([repo, sha], path, local) {
  if (mirror) return readFile(join(mirror, local), "utf8");
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path}`);
  if (!response.ok) throw Error(`${path}: ${response.status}`);
  return response.text();
}
const suites = new Map();
function append(meta, run) {
  for (const [metric,value] of Object.entries(run.values)) {
    assert(Number.isFinite(value) && value >= 0, [meta.id, metric, value].join(" "));
  }
  if (!suites.has(meta.id)) suites.set(meta.id, {...meta, runs:[]});
  suites.get(meta.id).runs.push(run);
}
const devices = {
  s26ultra: "Samsung Galaxy S26 Ultra", s24: "Samsung Galaxy S24 (SM-S921B)", s20plus: "Samsung Galaxy S20+ (Exynos 990)",
  pixel10: "Google Pixel 10", iphone17:"iPhone 17", iphonese:"iPhone SE (3rd gen)",
};
const rneTasks = {
  classification:["Image classification","512 × 512 synthetic RGBA frame"],
  "object-detection":["Object detection","640 × 640 synthetic RGBA frame"],
  "instance-segmentation":["Instance segmentation","640 × 640 RGBA frame"],
  "semantic-segmentation":["Semantic segmentation","512 × 512 RGBA frame"],
  "keypoint-detection":["Pose estimation","512 × 512 RGBA frame"],
  "style-transfer":["Style transfer","512 × 512 RGBA frame"],
  "depth-estimation":["Depth estimation","512 × 512 synthetic RGBA frame"],
  inpainting:["Image inpainting","512 × 512 synthetic RGBA frame with a 256 × 256 central mask"],
  "image-embeddings":["Embeddings","512 × 512 RGBA image"],
  ocr:["Optical character recognition","640 × 640 RGBA frame"],
  "text-to-image":["Image generation","Fixed sailboat prompt and seed, one denoising step"],
  "text-embeddings":["Embeddings","Four English sentences, about 80 words"],
  "colbert-embeddings":["Embeddings","Four English sentences encoded as a ColBERT document"],
  "privacy-filter":["PII detection","Three English sentences with five types of personal data"],
  "speech-to-text":["Transcription","10 s of synthetic voice-shaped audio at 16 kHz mono; little decoded text"],
  "text-to-speech":["Speech synthesis","Two fixed English sentences"],
  "voice-activity-detection":["Voice activity detection","10 s of 16 kHz mono audio"],
};
const rneKeys = ["pipelineMedianMs","pipelineMeanMs","executionMs","coldLoadMs","peak","storage"];
for (const [filename, period] of [["imported.json","September 2026"],["measured.json","October 2026"]]) {
  const rows = JSON.parse(await source(react, versionDir + filename, filename));
  for (const r of rows) {
    if (r.task === "llm") continue;
    assert(rneTasks[r.task] && devices[r.device]);
    const [task, input] = rneTasks[r.task];
    const ios = r.device.startsWith("iphone");
    const values = Object.fromEntries(rneKeys.map((key,i)=>[key,r[["medianMs","meanMs","etMs","loadMs","peakMb","sizeMb"][i]]]));
    const meta = {id:"rne-"+r.task,task,title:"ExecuTorch mobile · " + r.task.replaceAll("-"," "),
      source:link(react,versionDir+"01-benchmarks.mdx"),
      description:"Software Mansion’s release-build benchmark measures the complete pipeline, native execution, cold load, package size and sampled peak process memory including the app baseline. iOS measures physical footprint and Android measures proportional set size. Inference memory excludes loading peaks. Benchmark input: "+input+".",
      metrics:rneKeys};
    append(meta,{device:devices[r.device],platform:ios?"iPhone & iPad":"Android",model:r.model,
      config:r.backend.toUpperCase()+" · "+r.precision.toUpperCase(),protocol:period+" · "+input,
      note:(ios?"iOS physical footprint":"Android total PSS")+" · separate inference pass",source:link(react,versionDir+filename),values});
  }
}

const rkTasks = {
  mobilenet:"Image classification",resnet:"Image classification", yolov8_pose:"Pose estimation", deeplabv3:"Semantic segmentation",
  yolov5_seg:"Instance segmentation",yolov8_seg:"Instance segmentation",ppseg:"Semantic segmentation",mobilesam:"Image segmentation",
  RetinaFace:"Face detection", LPRNet:"Optical character recognition","PPOCR-Det":"Optical character recognition","PPOCR-Rec":"Optical character recognition",
  lite_transformer:"Translation",clip:"Embeddings",wav2vec2:"Transcription",whisper:"Transcription",zipformer:"Transcription",
  yamnet:"Audio classification",mms_tts:"Speech synthesis",
};
const rkTable = (await source(rockchip,"README.md","rockchip.md")).split("## Model performance benchmark(FPS)")[1].split("\n##")[0];
const markdownRows = rkTable.split("\n").filter(l=>l.startsWith("|")).map(l=>l.split("|").slice(1,-1).map(c=>c.trim()));
const hardware = markdownRows[0].slice(4);
assert.deepEqual(hardware,["RK3566 RK3568","RK3562","RK3588 @single_core","RK3576 @single_core","RV1126B","RV1109","RV1126","RK1808"]);
let demo;
for (const row of markdownRows.slice(2)) {
  assert.equal(row.length,12);
  const [group, model, shape, dtype, ...cells] = row;
  if (group) demo=group;
  const task=rkTasks[demo] ?? (/^(yolo|ppyolo)/.test(demo)?"Object detection":null);
  assert(task, demo);
  for (const [i,cell] of cells.entries()) {
    if (cell === "/") continue;
    const match=cell.match(/^(RTF\s+)?(\d+(?:\.\d+)?)(?:\((INT8)\))?$/);
    assert(match,cell);
    const precision = match[3] ?? dtype;
    const metric = match[1] ? "audioTimeRatio" : "forwardRate";
    const title = demo === "yolo_world" && model === "clip_text" ? "YOLO-World CLIP text encoder" : model;
    const chip = hardware[i].replace(" @single_core","").replace("RK3566 RK3568","RK3566 / RK3568");
    const cores = hardware[i].endsWith("@single_core") ? "one NPU core" : "core count unspecified";
    const meta = {id:"rknn-"+demo.toLowerCase().replaceAll("_","-"),task,title:"Rockchip NPU · "+demo.replaceAll("_"," "),
      source:link(rockchip,"README.md#model-performance-benchmarkfps"),metrics:[metric],
      description:"Rockchip’s model benchmark at each platform’s maximum NPU frequency excludes preprocessing and postprocessing unless specified. RK3566 and RK3568 share one published entry. Audio real-time factor is processing time divided by audio duration."};
    append(meta,{device:chip,platform:"Rockchip NPUs",model:title,config:precision+" · "+shape+" · "+cores,protocol:"Maximum NPU frequency · "+shape+" · "+precision,
      note:"Rockchip RKNN model inference",values:{[metric]:Number(match[2])}});
  }
}

// Use only sections that name an exact processor and print all five runtime parameters.
const ncnnSections = [
  ["AMD Ryzen 9 5950X 16-Core of Desktop", "Ryzen 9 5950X", "AMD CPUs"],
  ["AMD Radeon RX 6900 XT of Desktop", "Radeon RX 6900 XT", "AMD graphics"],
  ["NVIDIA GeForce RTX 3060 Ti of Desktop", "RTX 3060 Ti", "NVIDIA GPUs"],
  ["Intel(R) UHD Graphics 770 of Desktop", "UHD Graphics 770", "Intel graphics"],
  ["Intel® Core™ i7-13700K of Desktop", "Core i7-13700K", "Intel CPUs"],
  ["Raspberry Pi 5 Broadcom BCM2712, Cortex-A76", "Raspberry Pi 5", "ARM Linux boards"],
  ["Raspberry Pi 5 Broadcom BCM2712, VideoCore VII", "Raspberry Pi 5", "ARM Linux boards"],
  ["Arduino UNO Q - QRB2210", "Arduino UNO Q", "ARM Linux boards"],
  ["MediaTek Dimensity 9300 (MT6989)", "Dimensity 9300", "Mobile chipsets"],
];
const ncnnText = await source(tencent,"benchmark/README.md","ncnn.md");
const ncnn = ncnnText.split(/^### /m);
for (const [heading, device, platform] of ncnnSections) {
  const relevant = ncnn.filter(section=>section.startsWith(heading));
  assert.equal(relevant.length,1,heading);
  const lineNumber = ncnnText.slice(0,ncnnText.indexOf("### "+heading)).split("\n").length;
  const boardSource = link(tencent,"benchmark/README.md#L"+lineNumber);
  let params;
  for (const line of relevant[0].split("\n")) {
    const setting = line.match(/^(loop_count|num_threads|powersave|gpu_device|cooling_down) = (-?\d+)/);
    if (setting) {
      if (setting[1] === "loop_count") params = {};
      params[setting[1]] = Number(setting[2]);
    }
    const timing = line.match(/^\s*([\w.-]+)\s+min =\s*([\d.]+)\s+max =\s*([\d.]+)\s+avg =\s*([\d.]+)/);
    if (!timing) continue;
    assert.equal(Object.keys(params).length,5,heading);
    const [,model,min,max,mean] = timing;
    assert(Number(min)<=Number(mean)&&Number(mean)<=Number(max));
    const task = model === "blazeface" ? "Face detection" : /ssd|yolo|nanodet|fastestdet/i.test(model) ? "Object detection" : "Image classification";
    const config=(params.gpu_device<0?"CPU":"Vulkan")+" · "+params.num_threads+" threads · power mode "+params.powersave;
    const protocol=params.loop_count+" runs · cooling "+(params.cooling_down?"on":"off");
    append({id:"ncnn-"+task.toLowerCase().replaceAll(" ","-"),task,title:"ncnn · "+task.toLowerCase(),
      source:link(tencent,"benchmark/README.md"),metrics:["forwardMeanMs","forwardMinMs","forwardMaxMs"],
      description:"Tencent’s benchncnn reports the minimum, mean and maximum native inference time with synthetic model weights. This measures the network execution path. Reported loops, thread count, power mode and backend identify each test."},
    {device,platform,model,config:config+" · "+protocol,protocol, note:"benchncnn · synthetic weights",source:boardSource,
      values:{forwardMeanMs:Number(mean),forwardMinMs:Number(min),forwardMaxMs:Number(max)}});
  }
}
for (const s of suites.values()) {
  const keys=s.runs.map(r=>[r.platform,r.device,r.model,r.config].join("|"));
  assert.equal(new Set(keys).size,keys.length,s.id+": duplicate displayed configuration");
  assert(s.runs.every(r=>Object.keys(r.values).every(k=>s.metrics.includes(k))),s.id+": unexpected metric");
}
const payload='{"schemaVersion":1,"suites":[\n'+[...suites.values()].map(({runs,...s})=>JSON.stringify(s).slice(0,-1)+',"runs":[\n'+runs.map(r=>JSON.stringify(r)).join(",\n")+'\n]}').join(",\n")+'\n]}\n';
await writeFile("data/local-hardware-model-extra.json",payload);
console.log(suites.size,"suites,", [...suites.values()].reduce((n,s)=>n+s.runs.length,0),"published configurations");
