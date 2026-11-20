"use client";

import { useEffect, useRef, useState } from "react";
import { CompactPicker } from "@/components/compact-picker";
import { browserSignals, matchDevice, type DeviceMatch } from "@/lib/device-match";
import { protocolKey } from "@/lib/hardware-protocol";
import { deviceBenchmarks } from "@/lib/local-hardware-data";
import "./local-hardware.css";

type Run = {
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

type Suite = {
  id: string;
  title: string;
  source: string;
  modelSources?: Record<string,string>;
  task?: string;
  description: string;
  metrics: string[];
  runs: Run[];
};

const suites: Suite[] = deviceBenchmarks.suites;
const metrics: Record<string, { label: string; unit: string; lower: boolean }> = {
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
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const sortNames = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const tasks: Record<string, string> = {
  "4167": "Language", "4508": "Language", "15013": "Language", "15021": "Language", "10879": "Language",
  "webllm-m3": "Language", "webgpu-decode": "Language", "webgpu-request": "Language", "pi-llama": "Language",
  "pi-asr": "Transcription", "wk-earnings22": "Transcription", "wk-librispeech": "Transcription",
  "faster-whisper": "Transcription", moi: "Image generation", coreml: "Image generation",
  sana: "Image generation", video: "Video generation", ace: "Music generation",
  "fluid-tts": "Speech synthesis", "hf-gooaq": "Embeddings", "msmarco-v100": "Reranking",
  "qwen-vl-a100": "Vision and language",
};

const workloadNames = [...new Set(suites.map(suite => suite.task ?? tasks[suite.id]!))];
const speedKeys = ["generation", "tokenLatency", "requestMs", "firstToken", "audio", "synthesis", "latency", "embeddings", "rerank", "graphMs", "whisperEncodeMs", "prompt"];
// Keep the source order within each suite. The overview picks the first shared protocol
// in this order, so a faster measurement never wins selection just for being faster.
const samples = suites.flatMap(suite => suite.runs.flatMap(run => {
  const key = speedKeys.find(metric => run.values[metric] !== undefined);
  if (!key) return [];
  return [{
    suite, key, run, task: suite.task ?? tasks[suite.id]!, protocol: protocolKey(suite.id, key, run),
    deviceId: JSON.stringify([run.platform, run.device]),
  }];
}));
type Sample = typeof samples[number];
const byDevice = new Map<string, Sample[]>();
const protocolsByDevice = new Map<string, Set<string>>();
const devicesByTask = new Map<string, Set<string>>();
const breadth = new Map<string, number>();
for (const sample of samples) {
  const { deviceId, protocol, task } = sample;
  if (!byDevice.has(deviceId)) {
    byDevice.set(deviceId, []);
    protocolsByDevice.set(deviceId, new Set());
  }
  byDevice.get(deviceId)!.push(sample);
  const seen = protocolsByDevice.get(deviceId)!;
  if (!seen.has(protocol)) breadth.set(protocol, (breadth.get(protocol) ?? 0) + 1);
  seen.add(protocol);
  if (!devicesByTask.has(task)) devicesByTask.set(task, new Set());
  devicesByTask.get(task)!.add(deviceId);
}
const entries = [...byDevice].map(([value, rows]) => {
  const {platform, device} = rows[0]!.run;
  const coverage = new Set(rows.map(row => row.task)).size;
  return {value, label:device, group:platform, platform, device, coverage,
    description: coverage + (coverage === 1 ? " workload" : " workloads") + " · " + rows.length + " configurations"};
}).sort((a,b) => sortNames(a.platform,b.platform) || sortNames(a.device,b.device));
const detectionEntries = [...entries].sort((a,b) => b.coverage - a.coverage ||
  (byDevice.get(b.value)!.length - byDevice.get(a.value)!.length));
function rankProtocols(a: Sample, b: Sample) {
  const stageMetric = (sample: Sample) => sample.key === "graphMs" || sample.key.startsWith("whisper");
  return Number(stageMetric(a)) - Number(stageMetric(b)) || (breadth.get(b.protocol) ?? 0) - (breadth.get(a.protocol) ?? 0);
}

function WorkloadCell({sample, max, inspect}: {sample?: Sample; max?: number; inspect: (s: Sample) => void}) {
  if (!sample) return <td className="matrix-missing">Unreported</td>;
  const {run, key} = sample;
  const memory = measuredMemory(run, sample.suite.id);
  const value = run.values[key]!;
  return <td><button className="matrix-result" type="button" onClick={() => inspect(sample)}>
    <b>{number.format(value)} {metrics[key]!.unit}</b>
    {max !== undefined && max > 0 && <span aria-hidden="true" className="hardware-track"><i style={{width: 100 * value / max + "%"}} /></span>}
    <span>{metrics[key]!.label} · {run.model} · {run.config}</span>
    {memory && <span>{memory.kind} · {number.format(memory.gib)} GiB</span>}
    {run.values.inferencePeakHighMB !== undefined && <span>Estimated inference memory · {number.format(run.values.inferencePeakLowMB ?? 0)}–{number.format(run.values.inferencePeakHighMB)} MB</span>}
  </button><details className="hardware-conditions"><summary>Test conditions</summary>
    <p>{sample.suite.description}</p>{run.protocol && <p>{run.protocol}</p>}{run.note && <p>{run.note}</p>}<a href={run.source ?? sample.suite.modelSources?.[run.model] ?? sample.suite.source}>Published benchmark</a>
  </details></td>;
}

function measuredMemory(run: Run, suite?: string) {
  if (run.values.peakGpuGB !== undefined) return { gib: run.values.peakGpuGB * 1e9 / 2 ** 30, kind: "Peak GPU memory" };
  if (run.values.gpuMemoryMB !== undefined) return { gib: run.values.gpuMemoryMB * 1e6 / 2 ** 30, kind: "Peak GPU memory" };
  if (run.values.meanRss !== undefined) return { gib: run.values.meanRss * 1e6 / 2 ** 30, kind: "Mean resident RAM" };
  if (run.values.vramGiB !== undefined) return { gib: run.values.vramGiB, kind: "Peak GPU allocation" };
  if (run.values.peak !== undefined) return { gib: run.values.peak / 1024, kind: suite === "moi" ? (run.platform === "Android" ? "Peak process PSS" : "Peak physical footprint") : "Peak app memory" };
  if (run.values.memoryMB !== undefined) return { gib: run.values.memoryMB * 1e6 / 2 ** 30, kind: run.platform === "NVIDIA GPUs" ? "Reported VRAM" : "Reported RAM" };
  return null;
}

function storage(run: Run) {
  const mib = run.values.storage ?? run.storageMiB;
  return mib === undefined ? null : mib / 1024;
}

function runName(run: Run) {
  return run.model + " · " + run.config;
}

function comparisonRows(rows: Run[], device: string, expanded: boolean) {
  if (expanded || rows.length <= 7) return rows;
  const index = rows.findIndex(r => r.device === device);
  const indices = new Set([0, 1, rows.length - 1, index - 1, index, index + 1]);
  return rows.filter((_, i) => indices.has(i));
}

function rates(value: number, key: string) {
  if (key === "tokenLatency") return number.format(1000 / value) + " tok/s";
  if (key === "audio") return number.format(600 / value) + " s per 10 min audio";
  if (key === "synthesis") return number.format(60 / value) + " s per minute of speech";
  if (key === "generation") return number.format(128 / value) + " s per 128 tokens";
  if (key === "prompt") return number.format(512 / value) + " s per 512 tokens";
  return null;
}

export function LocalHardware() {
  const [example, setExample] = useState(true);
  const [platform, setPlatform] = useState("iPhone & iPad");
  const [device, setDevice] = useState("iPhone 17 Pro");
  const [peerId, setPeerId] = useState("");
  const [match, setMatch] = useState<DeviceMatch>();
  const [automatic, setAutomatic] = useState(false);
  const [browseTask, setBrowseTask] = useState("");
  const [chosenProtocols, setChosenProtocols] = useState<Record<string, string>>({});
  const manual = useRef(false);
  const [inspecting, setInspecting] = useState(false);
  const [selection, setSelection] = useState("moi/latency");
  const [budget, setBudget] = useState("");
  const [selectedRun, setSelectedRun] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [allDevices, setAllDevices] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const p = query.get("platform");
    const d = query.get("device");
    const shared = !!(p && d && byDevice.has(JSON.stringify([p,d])));
    let live = true;
    void browserSignals().then(signals => {
      if (!live) return;
      const found = matchDevice(signals, detectionEntries);
      setMatch(found);
      if (!shared && !manual.current && found.entry) {
        setPlatform(found.entry.platform);
        setDevice(found.entry.device);
        setExample(false);
        setAutomatic(true);
      }
    }).catch(() => { if (live) setMatch({detected:"Unavailable",reason:"Choose a measured device below."}); });
    if (!shared || !p || !d) return () => {live = false;};
    const peer = query.get("peer");
    if (peer !== null) setPeerId(entries.some(e => e.value === peer) ? peer : "");
    setInspecting(query.has("measure"));
    setExample(false);
    setPlatform(p);
    setDevice(d);
    setSelection(query.get("measure") ?? "");
    setSelectedRun(query.get("run") ?? "");
    setInspectOpen(query.has("run"));
    const memory = Number(query.get("memory"));
    if (Number.isFinite(memory) && memory > 0) setBudget(String(memory));
    return () => {live = false;};
  }, []);
  const deviceId = JSON.stringify([platform, device]);
  const left = byDevice.get(deviceId) ?? [];
  const deviceSuites = new Map<Suite, Run[]>();
  for (const {suite,run} of left) {
    if (!deviceSuites.has(suite)) deviceSuites.set(suite, []);
    deviceSuites.get(suite)!.push(run);
  }
  const available = [...deviceSuites].flatMap(([suite,runs]) => {
    return suite.metrics.filter(key => runs.some(r => r.values[key] !== undefined)).map(key => ({ suite, key, id: suite.id + "/" + key, runs }));
  });
  const active = available.find(o => o.id === selection) ?? available[0];
  const key = active?.key ?? "latency";
  const metric = metrics[key]!;
  const sorted = (a: Run, b: Run) => (a.values[key]! - b.values[key]!) * (metric.lower ? 1 : -1) || sortNames(a.device, b.device);
  const rows = active?.runs.filter(r => r.values[key] !== undefined).sort(sorted) ?? [];
  const max = rows.reduce((highest,r) => Math.max(highest,r.values[key]!),0);
  const compare = rows.find(r => runName(r) === selectedRun) ?? rows[0];
  const peers = active && compare ? active.suite.runs.filter(r => protocolKey(active.suite.id,key,r) === protocolKey(active.suite.id,key,compare) && r.values[key] !== undefined).sort(sorted) : [];
  const share = new URLSearchParams({ platform, device, measure: active?.id ?? "" });
  share.set("peer", peerId);
  if (compare) share.set("run", runName(compare));
  if (Number(budget) > 0 && Number.isFinite(Number(budget))) share.set("memory", budget);
  const peerMax = peers.reduce((highest,r) => Math.max(highest,r.values[key]!),0);
  const selectedIndex = peers.findIndex(r => r.device === device && r.platform === platform);
  const selectedMemory = compare && measuredMemory(compare, active?.suite.id);
  const selectedDisk = compare && storage(compare);
  const capacity = rows.find(r => r.capacity)?.capacity;
  const hasMemory = rows.some(r => measuredMemory(r) !== null);
  const hasStorage = rows.some(r => storage(r) !== null);
  const hasBudget = budget.trim() !== "" && Number.isFinite(Number(budget)) && Number(budget) > 0;
  const memoryBars = [
    ...(selectedDisk != null ? [{ name: "Weights on disk", gib: selectedDisk, color: "storage" }] : []),
    ...(selectedMemory ? [{ name: selectedMemory.kind, gib: selectedMemory.gib, color: "runtime" }] : []),
    ...(hasBudget && selectedMemory ? [{ name: "Your budget", gib: Number(budget), color: "budget" }] : []),
  ];
  const maxMemory = Math.max(0, ...memoryBars.map(item => item.gib));
  const formatted = (run: Run) => number.format(run.values[key]!) + (metric.unit === "%" ? "" : " ") + metric.unit;
  const changeDevice = (name: string) => {
    setChosenProtocols({});
    manual.current = true; setAutomatic(false); setExample(false); setDevice(name); setInspectOpen(false); setSelectedRun(""); setExpanded(false); setAllDevices(false); setBudget("");
  };
  const setMeasurement = (id: string) => {
    setSelection(id); setInspectOpen(false); setSelectedRun(""); setExpanded(false); setAllDevices(false);
  };
  const peer = entries.find(e => e.value === peerId && peerId !== deviceId);
  const right = (peer && byDevice.get(peer.value)) || [];
  const coverage = (task: string) => Number(left.some(s => s.task === task)) + Number(right.some(s => s.task === task));
  const covered = workloadNames.filter(task => coverage(task) > 0);
  const absent = workloadNames.filter(task => coverage(task) === 0);
  const protocols = protocolsByDevice.get(deviceId) ?? new Set<string>();
  const suggestions = entries.filter(e => e.value !== deviceId && e.value !== peer?.value)
    .map(entry => {
      const matches = byDevice.get(entry.value)!.filter(s => protocols.has(s.protocol));
      return {entry, tests: new Set(matches.map(s => s.protocol)).size, workloads:new Set(matches.map(s => s.task)).size};
    }).filter(e => e.tests > 0).sort((a,b) => b.workloads - a.workloads ||
      Number(b.entry.platform === platform) - Number(a.entry.platform === platform) ||
      b.tests - a.tests || sortNames(a.entry.device,b.entry.device)).slice(0,3);
  function pickDevice(id: string) {
    const entry = entries.find(e => e.value === id);
    if (!entry) return;
    if (peerId === id) setPeerId(deviceId);
    setPlatform(entry.platform);
    changeDevice(entry.device);
    setSelection("");
    setInspecting(false);
  }
  function viewWorkload(id: string, task: string) {
    const sample = byDevice.get(id)?.filter(s => s.task === task).sort(rankProtocols)[0];
    if (!sample) return;
    pickDevice(id);
    setSelection(sample.suite.id + "/" + sample.key);
    setSelectedRun(runName(sample.run));
    requestAnimationFrame(() => document.getElementById("workload-" + encodeURIComponent(task))?.scrollIntoView({block:"center"}));
  }
  function inspect(sample: Sample) {
    if (sample.deviceId !== deviceId) {
      setPeerId(deviceId);
      setPlatform(sample.run.platform);
      changeDevice(sample.run.device);
    }
    setSelection(sample.suite.id + "/" + sample.key);
    setSelectedRun(runName(sample.run));
    setInspectOpen(true);
    setInspecting(true);
    requestAnimationFrame(() => document.getElementById("hardware-detail")?.scrollIntoView({block:"start"}));
  }
  return (
    <section id="hardware" className="local-hardware" aria-labelledby="hardware-heading">
      <h2 id="hardware-heading">Device speeds and memory</h2>
      <p className="hardware-fine">{entries.length} hardware configurations · {workloadNames.length} workloads · {suites.length} published benchmark suites</p>
      <div className="hardware-detected" data-private>
        <span>Browser reports <strong>{match?.detected ?? "Checking device…"}</strong></span>
        {automatic ? <span>{match?.reason}</span> : match?.entry && match.entry.value !== deviceId ?
          <button type="button" onClick={() => { pickDevice(match.entry!.value); setAutomatic(true); }}>Use {match.entry.device}</button> :
          <span>{example ? match?.reason ?? "Showing an example while the page loads." : "Showing your selected hardware."}</span>}
      </div>
      <div className="hardware-controls">
        <CompactPicker label="Device" value={deviceId} options={entries} onChange={pickDevice} />
        <CompactPicker label="Compare device" value={peer?.value ?? ""} options={[{value:"",label:"One device"}, ...entries.filter(e => e.value !== deviceId)]}
          onChange={value => { manual.current = true; setPeerId(value); }} />
      </div>
      {suggestions.length > 0 && <div className="hardware-shortcuts"><span>Compare on shared tests</span>{suggestions.map(({entry,workloads,tests}) =>
        <button key={entry.value} type="button" title={workloads+" workloads · "+tests+" matching configurations"} onClick={() => { manual.current = true; setPeerId(entry.value); }}>{entry.device}</button>)}</div>}
      <table className="device-matrix" aria-label="Speed by workload"><caption>Speed by workload <small>{covered.length} of {workloadNames.length} workloads have results for this selection</small></caption><thead><tr><th scope="col">Workload</th><th scope="col">{device}<small>{platform}</small></th>{peer && <th scope="col">{peer.device}<small>{peer.platform}</small></th>}</tr></thead>
        <tbody>{covered.map(task => {
          const first = left.filter(s => s.task === task).sort(rankProtocols);
          const second = right.filter(s => s.task === task).sort(rankProtocols);
          const other = new Map(second.map(s => [s.protocol,s]));
          const shared = first.filter(s => other.has(s.protocol));
          const common = shared.find(s => s.protocol === chosenProtocols[task]) ?? shared[0];
          const a = common ?? first[0];
          const b = common ? other.get(common.protocol) : second[0];
          const max = common && b ? Math.max(a!.run.values[a!.key]!, b.run.values[b.key]!) : undefined;
          return <tr key={task} id={"workload-" + encodeURIComponent(task)} data-focus={task === browseTask}><th scope="row">{task}
            <small>{shared.length ? "Matched test · " + (metrics[a!.key]!.lower ? "lower" : "higher") + " is better" :
              a && b ? "Separate tests" : peer ? "One device measured" : metrics[(a ?? b)!.key]!.label}</small>
            {common && shared.length > 1 && <details className="hardware-conditions"><summary>{shared.length} shared tests</summary>
              <CompactPicker label={"Shared test for " + task} value={common.protocol} options={shared.map(s => ({
                value:s.protocol, label:runName(s.run), group:s.suite.title, description:s.run.protocol ?? s.run.note
              }))} onChange={value => setChosenProtocols(previous => ({...previous,[task]:value}))}/>
            </details>}
          </th><WorkloadCell sample={a} max={max} inspect={inspect}/>{peer && <WorkloadCell sample={b} max={max} inspect={inspect}/>}</tr>;
        })}</tbody>
      </table>
      <p className="hardware-fine">Select a value for the source, model settings and other runs. The overview favors matched tests, then whole workloads, then tests published for more devices. Bars compare results within a matched test.</p>
      <div className="hardware-coverage">
        <h3>Browse by workload</h3>
        {[{label:"Measured on your selection",items:covered},{label:"Measured on other hardware",items:absent}].filter(group => group.items.length).map(group =>
          <div key={group.label}><p>{group.label}</p><div className="coverage-tasks">{group.items.map(task => <button type="button" key={task} aria-pressed={task === browseTask} onClick={() => setBrowseTask(task === browseTask ? "" : task)}>
          {task} <span>{devicesByTask.get(task)?.size ?? 0} devices</span>
        </button>)}</div></div>)}
        {browseTask && <div className="hardware-browse-results">
          <div className="hardware-shortcuts"><span>{browseTask} measurements</span>{detectionEntries.filter(e => devicesByTask.get(browseTask)?.has(e.value)).slice(0,3).map(e =>
            <button type="button" key={e.value} onClick={() => viewWorkload(e.value,browseTask)}>{e.device}</button>)}</div>
          <CompactPicker label={"Measured devices for " + browseTask} value={devicesByTask.get(browseTask)?.has(deviceId) ? deviceId : ""} options={[
          {value:"",label:"Choose measured hardware"},...entries.filter(e => devicesByTask.get(browseTask)?.has(e.value))]} onChange={id => viewWorkload(id,browseTask)} /></div>}
      </div>
      <a href={"/local?" + new URLSearchParams({platform, device, peer: peer?.value ?? ""}) + "#hardware"}>Share device overview</a>
      <details className="hardware-drill" id="hardware-detail" open={inspecting} onToggle={e => setInspecting(e.currentTarget.open)}>
      <summary>Explore all measurements on {device}</summary>
      <div className="hardware-controls">
        {active && available.length > 1 && <CompactPicker label="Measurement" value={active.id} options={
          available.map(({ suite, id, key }) => ({
            value: id, label: suite.title + " · " + metrics[key]!.label,
            group: suite.task ?? tasks[suite.id] ?? suite.title, description: metrics[key]!.unit,
          }))
        } onChange={setMeasurement} />}
      </div>
      {!active && <p className="hardware-empty">The published sources cover {entries.filter(e => e.platform === platform).length} device configurations on this platform. Choose a listed device to inspect its measurements. Speed and memory for an unlisted device are unknown.</p>}
      {active && (
        <div className="hardware-panel">
          <h3>{example ? "Example device · " : ""}{device}</h3>
          <p className="hardware-source"><strong>{active.suite.title}</strong> · <a href={compare?.source ?? (compare && active.suite.modelSources?.[compare.model]) ?? active.suite.source}>Source and protocol</a></p>
          <p>{active.suite.description}</p>
          {capacity && <p><strong>Test device memory</strong> {capacity}</p>}
          {hasMemory && <label className="hardware-budget">Available memory (GiB)<input type="number" min="0.01" step="any" placeholder="Enter a budget" value={budget} onChange={e => setBudget(e.target.value)} /></label>}
          <div className="hardware-plot-title"><h4>{metric.label}</h4><span>{metric.lower ? "Lower" : "Higher"} is better · {rows.length} configurations</span></div>
          <div className="hardware-plot" aria-label="Measurements on selected device">
            {(expanded ? rows : rows.slice(0, 8)).map(run => {
              const memory = measuredMemory(run, active.suite.id);
              const disk = storage(run);
              const remaining = memory && hasBudget ? Number(budget) - memory.gib : null;
              const normalized = rates(run.values[key]!, key);
              return <div key={runName(run)} className="hardware-row">
                <div className="hardware-value"><span><strong>{run.model}</strong> · {run.config}</span><b>{formatted(run)}</b></div>
                <span className="hardware-track" aria-hidden="true"><i style={{width: (max ? 100 * run.values[key]! / max : 0) + "%"}} /></span>
                <div className="hardware-meta">
                  {normalized && <span>{normalized}</span>}
                  {disk !== null && <span>Weights on disk {number.format(disk)} GiB</span>}
                  {memory && <span>{memory.kind} {number.format(memory.gib)} GiB</span>}
                  {remaining !== null && <strong>{number.format(Math.abs(remaining))} GiB {remaining < 0 ? "over budget" : "below budget"}</strong>}
                </div>
              </div>;
            })}
          </div>
          {rows.length > 8 && <button className="hardware-more" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Show first 8" : "Show all " + rows.length + " configurations"}</button>}
          {hasMemory ? <p className="hardware-fine">The budget compares your available memory to the reported run. Other apps and longer inputs can change what fits.</p>
            : <p className="hardware-fine">{rows.some(r => r.values.inferencePeakHighMB !== undefined) ? "Memory ranges estimate the incremental allocation during inference. Inspect the memory measurements for both endpoints." : "Runtime memory use is unreported for these runs."}{hasStorage && " Loading weights also requires working memory."}</p>}
          <details className="hardware-peers" open={inspectOpen} onToggle={e => setInspectOpen(e.currentTarget.open)}>
            <summary>Inspect a configuration</summary>
            {compare && rows.length > 1 ? <CompactPicker label="Model and configuration" value={runName(compare)}
              options={rows.map(r => ({ value: runName(r), label: runName(r), group: r.model, description: formatted(r) }))}
              onChange={value => {setSelectedRun(value);setAllDevices(false);}} /> : compare && <p>{runName(compare)}</p>}
            {compare?.protocol && <p className="hardware-fine">{compare.protocol}</p>}
            {compare?.note && <p className="hardware-fine">{compare.note}</p>}
            {memoryBars.length > 0 && <div className="hardware-memory-profile">
              <h5>Memory profile</h5>
              {memoryBars.map(item => <div className="hardware-peer" key={item.name}>
                <span>{item.name}</span><span className="hardware-track" aria-hidden="true"><i data-kind={item.color} style={{width: (maxMemory ? 100 * item.gib / maxMemory : 0) + "%"}} /></span>
                <b>{number.format(item.gib)} GiB</b>
              </div>)}
            </div>}
            <h5>Compare devices</h5>
            {peers.length === 1 ? <p>This source reports the selected configuration on one device.</p> : <>
              <p>{device} ranks {selectedIndex + 1} of {peers.length} measured devices in this configuration.</p>
              {comparisonRows(peers, device, allDevices).map(r => <div className="hardware-peer" key={JSON.stringify([r.platform,r.device])} data-selected={r.device === device && r.platform === platform}>
                <span>{r.device}</span>
                <span className="hardware-track" aria-hidden="true"><i style={{width:(peerMax ? 100 * r.values[key]! / peerMax : 0) + "%"}} /></span>
                <b>{formatted(r)}</b>
              </div>)}
              {peers.length > 7 && <button className="hardware-more" type="button" onClick={() => setAllDevices(!allDevices)}>{allDevices ? "Show nearby and endpoint results" : "Show all " + peers.length + " devices"}</button>}
            </>}
          </details>
          <p><a href={"/local?" + share + "#hardware"}>Link to this comparison</a></p>
        </div>
      )}
      </details>
      <noscript><p>The initial device measurements are available above. Download the full dataset to inspect other devices.</p></noscript>
    </section>
  );
}
