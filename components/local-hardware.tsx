"use client";

import { useEffect, useState } from "react";
import measurements from "@/data/local-hardware.json";
import "./local-hardware.css";

type Run = {
  platform: string;
  device: string;
  model: string;
  config: string;
  values: Partial<Record<string, number>>;
  capacity?: string;
  storageMiB?: number;
  note?: string;
};

type Suite = {
  id: string;
  title: string;
  source: string;
  description: string;
  metrics: string[];
  runs: Run[];
};

const suites: Suite[] = measurements.suites;
const metrics: Record<string, { label: string; unit: string; lower: boolean }> = {
  prompt: { label: "Read a prompt", unit: "tok/s", lower: false },
  generation: { label: "Generate text", unit: "tok/s", lower: false },
  audio: { label: "Transcribe audio", unit: "× real time", lower: false },
  wer: { label: "Word error rate", unit: "%", lower: true },
  embeddings: { label: "Embed queries", unit: "queries/s", lower: false },
  rerank: { label: "Rerank documents", unit: "documents/s", lower: false },
  retrieval: { label: "Retrieval quality", unit: "NDCG@10", lower: false },
  synthesis: { label: "Generate speech", unit: "× real time", lower: false },
  firstAudio: { label: "Time to first audio", unit: "ms", lower: true },
  latency: { label: "Elapsed time", unit: "s", lower: true },
  peak: { label: "Peak app memory", unit: "MiB", lower: true },
  storage: { label: "Model storage", unit: "MiB", lower: true },
  vramGiB: { label: "Peak GPU allocation", unit: "GiB", lower: true },
  memoryMB: { label: "Reported memory usage", unit: "MB", lower: true },
};
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const sortNames = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const platforms = [...new Set(suites.flatMap(s => s.runs.map(r => r.platform)))].sort(sortNames);
const devicesByPlatform = new Map(platforms.map(p => [
  p, [...new Set(suites.flatMap(s => s.runs.filter(r => r.platform === p).map(r => r.device)))].sort(sortNames),
]));
const defaults: Record<string, string> = {
  "iPhone & iPad": "iPhone 17 Pro",
  "Apple silicon Macs": "M2 Max · 38 GPU cores",
  "NVIDIA GPUs": "RTX 4090",
  "AMD graphics": "RX 7900 XTX",
  "Intel graphics": "Intel Arc B580",
  "Android": "Xiaomi 15 Pro",
};

function measuredMemory(run: Run) {
  if (run.values.vramGiB !== undefined) return { gib: run.values.vramGiB, kind: "Peak GPU allocation" };
  if (run.values.peak !== undefined) return { gib: run.values.peak / 1024, kind: "Peak app memory" };
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
  const [selection, setSelection] = useState("moi/latency");
  const [budget, setBudget] = useState("");
  const [selectedRun, setSelectedRun] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [allDevices, setAllDevices] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const p = query.get("platform");
    const d = query.get("device");
    if (!p || !d || !devicesByPlatform.get(p)?.includes(d)) return;
    setExample(false);
    setPlatform(p);
    setDevice(d);
    setSelection(query.get("measure") ?? "");
    setSelectedRun(query.get("run") ?? "");
    const memory = Number(query.get("memory"));
    if (Number.isFinite(memory) && memory > 0) setBudget(String(memory));
  }, []);
  const devices = devicesByPlatform.get(platform) ?? [];
  const available = suites.flatMap(suite => {
    const runs = suite.runs.filter(r => r.device === device && r.platform === platform);
    return suite.metrics.filter(key => runs.some(r => r.values[key] !== undefined)).map(key => ({ suite, key, id: suite.id + "/" + key, runs }));
  });
  const active = available.find(o => o.id === selection) ?? available[0];
  const key = active?.key ?? "latency";
  const metric = metrics[key]!;
  const sorted = (a: Run, b: Run) => (a.values[key]! - b.values[key]!) * (metric.lower ? 1 : -1) || sortNames(a.device, b.device);
  const rows = active?.runs.filter(r => r.values[key] !== undefined).sort(sorted) ?? [];
  const max = Math.max(0, ...rows.map(r => r.values[key]!));
  const compare = rows.find(r => runName(r) === selectedRun) ?? rows[0];
  const peers = active && compare ? active.suite.runs.filter(r => r.model === compare.model && r.config === compare.config && r.values[key] !== undefined).sort(sorted) : [];
  const share = new URLSearchParams({ platform, device, measure: active?.id ?? "" });
  if (compare) share.set("run", runName(compare));
  if (Number(budget) > 0 && Number.isFinite(Number(budget))) share.set("memory", budget);
  const peerMax = Math.max(0, ...peers.map(r => r.values[key]!));
  const selectedIndex = peers.findIndex(r => r.device === device);
  const selectedMemory = compare && measuredMemory(compare);
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
    setExample(false); setDevice(name); setSelectedRun(""); setExpanded(false); setAllDevices(false); setBudget("");
  };
  const setMeasurement = (id: string) => {
    setSelection(id); setSelectedRun(""); setExpanded(false); setAllDevices(false);
  };
  return (
    <section id="hardware" className="local-hardware" aria-labelledby="hardware-heading">
      <h2 id="hardware-heading">Device speeds and memory</h2>
      <p>Choose your hardware to see measured runs, compare model configurations and check memory use.</p>
      <div className="hardware-controls">
        <label>Platform<select aria-label="Platform" value={platform} onChange={e => {
          const p = e.target.value;
          setPlatform(p); changeDevice(defaults[p] ?? devicesByPlatform.get(p)![0]!);
        }}>{platforms.map(p => <option key={p}>{p}</option>)}</select></label>
        <label>Device<select aria-label="Device" value={device} onChange={e => changeDevice(e.target.value)}>
          {devices.map(d => <option key={d}>{d}</option>)}<option value="">My device is missing</option>
        </select></label>
        {active && <label>Measurement<select aria-label="Measurement" value={active.id} onChange={e => setMeasurement(e.target.value)}>
          {available.map(({ suite, id, key }) => <option value={id} key={id}>{suite.title} · {metrics[key]!.label}</option>)}
        </select></label>}
      </div>
      {!active && <p className="hardware-empty">The published sources cover {devices.length} device configurations on this platform. Choose a listed device to inspect its measurements. Speed and memory for an unlisted device are unknown.</p>}
      {active && (
        <div className="hardware-panel">
          <h3>{example ? "Example device · " : ""}{device}</h3>
          <p className="hardware-source"><strong>{active.suite.title}</strong> · <a href={active.suite.source}>Source and protocol</a></p>
          <p>{active.suite.description}</p>
          {capacity && <p><strong>Test device memory</strong> {capacity}</p>}
          {hasMemory && <label className="hardware-budget">Available memory (GiB)<input type="number" min="0.01" step="any" placeholder="Enter a budget" value={budget} onChange={e => setBudget(e.target.value)} /></label>}
          <div className="hardware-plot-title"><h4>{metric.label}</h4><span>{metric.lower ? "Lower" : "Higher"} is better · {rows.length} configurations</span></div>
          <div className="hardware-plot" aria-label="Measurements on selected device">
            {(expanded ? rows : rows.slice(0, 8)).map(run => {
              const memory = measuredMemory(run);
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
                  {run.note && <span>{run.note}</span>}
                </div>
              </div>;
            })}
          </div>
          {rows.length > 8 && <button className="hardware-more" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Show first 8" : "Show all " + rows.length + " configurations"}</button>}
          {hasMemory ? <p className="hardware-fine">The budget compares your available memory to the reported run. Other apps and longer inputs can change what fits.</p>
            : <p className="hardware-fine">Runtime memory use is unreported for these runs.{hasStorage && " Loading weights also requires working memory."}</p>}
          <div className="hardware-peers">
            <h4>Inspect a configuration</h4>
            <label>Model and configuration<select aria-label="Model and configuration" value={compare ? runName(compare) : ""} onChange={e => {setSelectedRun(e.target.value);setAllDevices(false);}}>
              {rows.map(r => <option key={runName(r)}>{runName(r)}</option>)}
            </select></label>
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
              {comparisonRows(peers, device, allDevices).map(r => <div className="hardware-peer" key={r.device} data-selected={r.device === device}>
                <span>{r.device}</span>
                <span className="hardware-track" aria-hidden="true"><i style={{width:(peerMax ? 100 * r.values[key]! / peerMax : 0) + "%"}} /></span>
                <b>{formatted(r)}</b>
              </div>)}
              {peers.length > 7 && <button className="hardware-more" type="button" onClick={() => setAllDevices(!allDevices)}>{allDevices ? "Show nearby and endpoint results" : "Show all " + peers.length + " devices"}</button>}
            </>}
          </div>
          <p><a href={"/local?" + share + "#hardware"}>Link to this comparison</a></p>
        </div>
      )}
      <noscript><p>The initial device measurements are available above. Download the full dataset to inspect other devices.</p></noscript>
    </section>
  );
}
