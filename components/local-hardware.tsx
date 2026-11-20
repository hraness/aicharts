"use client";

import { useEffect, useRef, useState } from "react";
import { CompactPicker } from "@/components/compact-picker";
import { browserSignals, matchDevice, type DeviceMatch } from "@/lib/device-match";
import { deviceKind, deviceKeywords } from "@/lib/device-kind";
import { TradeoffPlot,frontierOf } from "@/components/tradeoff-plot";
import { hardwareSlug,visionExperiments } from "@/lib/vision-bench";
import { DeviceIcon } from "@/components/device-icon";
import { protocolKey } from "@/lib/hardware-protocol";
import { deviceBenchmarks } from "@/lib/local-hardware-data";
import "./local-hardware.css";

import { measuredMemory, metrics, tasks, speedKeys, number, sortNames, type Run, type Suite } from "@/lib/local-hardware-format";
const suites: Suite[] = deviceBenchmarks.suites;
const workloadNames = [...new Set(suites.map(suite => suite.task ?? tasks[suite.id]!))];
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
const visionByDevice=new Map<string,number>();
for(const test of visionExperiments) {
  const id=JSON.stringify([test.platform,test.device]);
  if(!byDevice.has(id))byDevice.set(id,[]);
  devicesByTask.get("Image classification")!.add(id);
  visionByDevice.set(id,(visionByDevice.get(id)??0)+test.count);
}
const entries = [...byDevice].map(([value, rows]) => {
  const [platform,device] = JSON.parse(value) as [string,string];
  const coveredTasks=new Set(rows.map(row=>row.task));
  const visions=visionByDevice.get(value)??0;
  if(visions)coveredTasks.add("Image classification");
  const coverage=coveredTasks.size;
  const icon = deviceKind(device,platform);
  return {value, icon, keywords:[...deviceKeywords(device,platform), ...coveredTasks], label:device, group:platform, platform, device, coverage,
    description: coverage + (coverage === 1 ? " workload" : " workloads") + " · " + (rows.length+visions).toLocaleString() + " configurations"};
}).sort((a,b) => sortNames(a.platform,b.platform) || sortNames(a.device,b.device));
const detectionEntries = [...entries].sort((a,b) => b.coverage - a.coverage ||
  (byDevice.get(b.value)!.length - byDevice.get(a.value)!.length));
function rankProtocols(a: Sample, b: Sample) {
  const stageMetric = (sample: Sample) => sample.key === "graphMs" || sample.key.startsWith("whisper");
  return Number(stageMetric(a)) - Number(stageMetric(b)) || (breadth.get(b.protocol) ?? 0) - (breadth.get(a.protocol) ?? 0);
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

const memoryKeys = new Set(["residentMB","peakResidentMiB","peakGpuGB","gpuMemoryMB","vramGiB","peak","memoryMB","meanRss","inferencePeakLowMB","inferencePeakHighMB"]);
const timingLabels: Record<string,string> = {
  prompt:"Prompt speed", generation:"Output speed", firstToken:"First token", latency:"Elapsed time",
  graphMs:"Graph time", audio:"Transcription", synthesis:"Speech speed", tokenLatency:"Token time",
  firstAudio:"First audio", requestMs:"Request time", embeddings:"Embedding speed", rerank:"Reranking speed"
};

function memoryReadout(sample: Sample) {
  const {run,suite} = sample;
  if (run.values.inferencePeakHighMB !== undefined) {
    const low = run.values.inferencePeakLowMB;
    const high = number.format(run.values.inferencePeakHighMB);
    return { value:(low === undefined ? high : number.format(low) + "–" + high) + " MB", label:"Inference estimate" };
  }
  const measured = measuredMemory(run,suite.id);
  return measured ? {value:number.format(measured.gib) + " GiB",label:measured.kind} : undefined;
}

type Option = { primary?: Sample; secondary?: Sample };
// Give each model a place in the first page before listing its many context sizes.
function variedOptions(items:Option[]) {
  if (items.length <= 6) return items;
  const models = new Map<string,Option[]>();
  for (const item of items) {
    const model = (item.primary ?? item.secondary)!.run.model;
    if (!models.has(model)) models.set(model,[]);
    models.get(model)!.push(item);
  }
  const groups = [...models.values()];
  return groups.flatMap(group => group.slice(0,1)).concat(groups.flatMap(group => group.slice(1)));
}

function TestTable({suite, items, device, peer, inspect}: {
  suite: Suite; items: Option[]; device: string; peer?: string; inspect: (s:Sample) => void;
}) {
  const [limit,setLimit] = useState(6);
  const [sort,setSort] = useState<{key:string; ascending:boolean}>();
  const suffixes = new Set(items.map(item => {
    const parts = (item.primary ?? item.secondary)!.run.model.split(" · ");
    return parts.length > 1 ? parts[parts.length-1] : undefined;
  }));
  const commonSuffix = suffixes.size === 1 ? [...suffixes][0] : undefined;
  const columns = suite.metrics.filter(key => !memoryKeys.has(key) && !["storage","wer","retrieval"].includes(key) &&
    items.some(item => item.primary?.run.values[key] !== undefined || item.secondary?.run.values[key] !== undefined));
  const hasDisk = items.some(item => [item.primary,item.secondary].some(sample => sample && storage(sample.run) !== null));
  const hasMemory = items.some(item => [item.primary,item.secondary].some(sample => sample && memoryReadout(sample)));
  const ordered = sort ? [...items].sort((a,b) => {
    const val = (item:Option) => (item.primary ?? item.secondary)!.run.values[sort.key];
    const av = val(a), bv = val(b);
    if (av === undefined || bv === undefined) return Number(av === undefined) - Number(bv === undefined);
    return (av - bv) * (sort.ascending ? 1 : -1);
  }) : items;
  const scales = new Map(columns.map(key => [key, items.reduce((high,item) =>
    Math.max(high,item.primary?.run.values[key] ?? 0,item.secondary?.run.values[key] ?? 0),0)]));
  const orderBy = (key:string) => {
    setSort({key,ascending:sort?.key === key ? !sort.ascending : metrics[key]!.lower});
    setLimit(6);
  };
  return <div className="timing-suite">
    <header><h5>{suite.title}{commonSuffix && <small> · {commonSuffix}</small>}</h5><a href={suite.source}>Source</a></header>
    <details className="timing-method"><summary>Test conditions</summary><p>{suite.description}</p>
      <p>{peer ? "Bars share a scale within each matched pair." : "Bars share a scale within each timing column for the filtered configurations."}</p></details>
    {items.length > 6 && <div className="timing-mobile-sort"><CompactPicker label={"Order " + suite.title} value={sort?.key ?? ""} options={[
      {value:"",label:"Published configurations"}, ...columns.map(key => ({value:key,label:metrics[key]!.label,description:metrics[key]!.lower ? "Lowest first" : "Highest first"}))
    ]} onChange={key => {setSort(key ? {key,ascending:metrics[key]!.lower} : undefined);setLimit(6);}}/></div>}
    <table className="timing-table" aria-label={suite.title}>
      <thead><tr><th scope="col">Model and settings</th>{peer && <th scope="col">Device</th>}
        {columns.map(key => <th key={key} scope="col" aria-sort={sort?.key === key ? sort.ascending ? "ascending" : "descending" : undefined}>
          <button type="button" title={"Sort by " + metrics[key]!.label} onClick={() => orderBy(key)}>{timingLabels[key] ?? metrics[key]!.label} {sort?.key === key ? (sort.ascending ? "↑" : "↓") : "↕"}</button></th>)}
        {hasMemory && <th scope="col">Memory</th>}{hasDisk && <th scope="col">On disk</th>}</tr></thead>
      <tbody>{ordered.slice(0,limit).flatMap((item,i) => [item.primary,item.secondary].flatMap((sample,side) => {
        if (!sample) return [];
        const {run} = sample;
        const memory = memoryReadout(sample);
        const disk = run.values.storage ?? run.storageMiB;
        return [<tr key={side + sample.protocol} data-side={side} data-band={i%2}>
          <th scope="row"><button type="button" title={run.model} onClick={() => inspect(sample)}>
            {commonSuffix ? run.model.slice(0,-(commonSuffix.length+3)) : run.model}</button>
            <small>{run.config}{(run.source || suite.modelSources?.[run.model]) &&
              <> · <a href={run.source ?? suite.modelSources?.[run.model]}>Run source</a></>}</small></th>
          {peer && <td className="timing-device">{side === 1 ? peer : device}<small>{item.primary && item.secondary ? "Matched timing" : "Only this device"}</small></td>}
          {columns.map(key => {
            const value = run.values[key];
            const scale = peer ? item.primary && item.secondary && item.primary.run.values[key] !== undefined && item.secondary.run.values[key] !== undefined ?
              Math.max(item.primary.run.values[key]!,item.secondary.run.values[key]!) : undefined : scales.get(key);
            return <td key={key} data-label={timingLabels[key] ?? metrics[key]!.label}>
            <span>{value === undefined ? "—" : number.format(value) + " " + metrics[key]!.unit}</span>
            {value !== undefined && scale !== undefined && scale > 0 && <i className="timing-bar" aria-hidden="true" style={{width:100 * value / scale + "%"}}/>}</td>;
          })}
          {hasMemory && <td data-label="Memory"><span>{memory?.value ?? "—"}</span>{memory && <small>{memory.label}</small>}</td>}
          {hasDisk && <td data-label="On disk"><span>{disk === undefined ? "—" : number.format(disk) + " MiB"}</span></td>}
        </tr>];
      }))}</tbody>
    </table>
    {items.length > 6 && <div className="timing-pages"><span>{Math.min(limit,items.length)} of {items.length} configurations</span>
      {items.length > limit && <button type="button" onClick={() => setLimit(limit + 20)}>Show more timings</button>}
      {limit > 6 && <button type="button" onClick={() => setLimit(6)}>Show fewer</button>}</div>}
  </div>;
}

function MemoryFrontier({samples}:{samples:Sample[]}) {
  const groups = new Map<string,{label:string; key:string; kind:string; samples:Sample[]}>();
  for (const sample of samples) {
    const memory = measuredMemory(sample.run,sample.suite.id);
    if (!memory || memory.gib<=0) continue;
    const id = JSON.stringify([sample.suite.id,sample.key,memory.kind]);
    if (!groups.has(id)) groups.set(id,{label:sample.suite.title,key:sample.key,kind:memory.kind,samples:[]});
    groups.get(id)!.samples.push(sample);
  }
  const options=[...groups].filter(([,g])=>new Set(g.samples.map(s=>measuredMemory(s.run,s.suite.id)!.gib)).size>1);
  const [choice,setChoice]=useState(""),[picked,setPicked]=useState("");
  const active=options.find(([id])=>id===choice) ?? options[0];
  if(!active)return null;
  const [id,g]=active,metric=metrics[g.key]!;
  const points=g.samples.map(sample=>({key:sample.protocol,label:runName(sample.run),x:measuredMemory(sample.run,sample.suite.id)!.gib,y:sample.run.values[g.key]!}));
  const frontier=frontierOf(points,true,metric.lower);
  const selected=points.find(p=>p.key===picked) ?? frontier[Math.floor(frontier.length/2)]!;
  return <section className="vision-explorer memory-frontier"><h4>Speed and memory frontier</h4>
    {options.length>1 && <CompactPicker label="Speed and memory test" value={id} options={options.map(([value,test])=>({value,label:test.label,description:metrics[test.key]!.label+" · "+test.kind}))} onChange={value=>{setChoice(value);setPicked("");}}/>}
    <p><strong>{g.label}</strong> · {points.length} configurations · {frontier.length} on the frontier</p>
    <strong className="vision-axis">{metric.label} ({metric.unit}) · {metric.lower?"lower":"higher"} is better</strong>
    <TradeoffPlot points={points} lowerX lowerY={metric.lower} selected={selected.key} onSelect={setPicked} xLabel={g.kind+" (GiB)"} yLabel={metric.label}/>
    <div className="vision-tools"><button type="button" onClick={()=>setPicked(frontier[0]!.key)}>Least memory on frontier</button><button type="button" onClick={()=>setPicked(frontier.at(-1)!.key)}>Fastest on frontier</button></div>
    <p className="vision-readout"><strong>{selected.label}</strong> · {number.format(selected.x)} GiB · {number.format(selected.y)} {metric.unit}</p>
    <a href={g.samples[0]!.suite.source}>Source and test conditions</a>
  </section>;
}

function WorkloadResults({left,right,device,peer,inspect}:{
  left:Sample[]; right:Sample[]; device:string; peer?:string; inspect:(s:Sample)=>void;
}) {
  const [query,setQuery] = useState("");
  const [task,setTask] = useState("");
  const [allSources,setAllSources] = useState<string[]>([]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const grouped = new Map<string,Map<Suite,Map<string,Option>>>();
  const availableTasks = workloadNames.filter(name => left.some(s => s.task === name) || right.some(s => s.task === name));
  for (const [side,samples] of [["primary",left],["secondary",right]] as const) {
    for (const sample of samples) {
      if (task && sample.task !== task) continue;
      const {run,suite} = sample;
      const text = [sample.task,suite.title,run.model,run.config,run.protocol].join(" ").toLowerCase();
      if (words.some(word => !text.includes(word))) continue;
      if (!grouped.has(sample.task)) grouped.set(sample.task,new Map());
      const bySuite = grouped.get(sample.task)!;
      if (!bySuite.has(suite)) bySuite.set(suite,new Map());
      const pairs = bySuite.get(suite)!;
      const pair = pairs.get(sample.protocol) ?? {};
      pair[side] = sample;
      pairs.set(sample.protocol,pair);
    }
  }
  return <div className="timing-results" aria-label="Speed by workload">
    <div className="timing-heading"><div><h3>Measured timings</h3><p>{device}{peer && " and " + peer}</p></div>
      <label>Filter results<input type="search" value={query} placeholder="Model, runtime, or test" onChange={e => setQuery(e.target.value)}/></label></div>
    <nav className="timing-tasks" aria-label="Filter measured workloads">
      {["",...availableTasks].map(name => <button key={name} type="button" aria-pressed={task === name} onClick={() => setTask(name)}>{name || "All workloads"}</button>)}
    </nav>
    {!peer && !words.length && <MemoryFrontier samples={task?left.filter(s=>s.task===task):left}/>}
    {grouped.size === 0 && <p role="status">No published timings match this filter. <button type="button" onClick={() => {setQuery("");setTask("");}}>Clear filters</button></p>}
    {availableTasks.filter(name => grouped.has(name)).map(name => <section className="timing-workload" key={name} id={"workload-" + encodeURIComponent(name)}>
      <h4>{name}</h4>{[...grouped.get(name)!].slice(0, words.length || task || allSources.includes(name) ? undefined : 2).map(([suite,pairs]) => {
        const options = [...pairs.values()];
        const shared = options.filter(item => item.primary && item.secondary);
        const items = [...variedOptions(shared), ...variedOptions(options.filter(item => !item.primary || !item.secondary))];
        return <TestTable key={suite.id + query} suite={suite} items={items} device={device} peer={peer} inspect={inspect}/>;
      })}
      {grouped.get(name)!.size > 2 && !words.length && !task && <button className="hardware-more" type="button" onClick={() =>
        setAllSources(previous => previous.includes(name) ? previous.filter(x => x !== name) : [...previous,name])}>
        {allSources.includes(name) ? "Show first two suites" : "See all " + grouped.get(name)!.size + " " + name.toLowerCase() + " suites"}
      </button>}</section>)}
  </div>;
}

export function LocalHardware() {
  const [example, setExample] = useState(true);
  const [platform, setPlatform] = useState("iPhone & iPad");
  const [device, setDevice] = useState("iPhone 17 Pro");
  const [peerId, setPeerId] = useState("");
  const [match, setMatch] = useState<DeviceMatch>();
  const [automatic, setAutomatic] = useState(false);
  const [remembered, setRemembered] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(false);
  const [browseTask, setBrowseTask] = useState("");
  const [workloadVisit,setWorkloadVisit] = useState(0);
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
    let saved: typeof entries[number] | undefined;
    try {
      const preference = window.localStorage.getItem("aicharts.hardware");
      saved = preference ? entries.find(e => e.value === preference) : undefined;
      setRemembered(saved?.value ?? "");
      setStorageAvailable(true);
    } catch { /* Browser storage can be disabled. */ }
    if (!shared && saved) {
      setPlatform(saved.platform);
      setDevice(saved.device);
      setExample(false);
    }
    let live = true;
    void browserSignals().then(signals => {
      if (!live) return;
      const found = matchDevice(signals, detectionEntries);
      setMatch(found);
      if (!shared && !saved && !manual.current && found.entry) {
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
    manual.current = true; setAutomatic(false); setExample(false); setDevice(name); setInspectOpen(false); setSelectedRun(""); setExpanded(false); setAllDevices(false); setBudget("");
  };
  const setMeasurement = (id: string) => {
    setSelection(id); setInspectOpen(false); setSelectedRun(""); setExpanded(false); setAllDevices(false);
  };
  const peer = entries.find(e => e.value === peerId && peerId !== deviceId);
  const right = (peer && byDevice.get(peer.value)) || [];
  const coverage = (task: string) => Number(devicesByTask.get(task)?.has(deviceId) ?? false) + Number(peer && devicesByTask.get(task)?.has(peer.value) ? 1 : 0);
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
    if (!sample) {
      if(task==="Image classification" && visionByDevice.has(id)) {
        const selected=entries.find(e=>e.value===id)!;
        window.location.assign("/local/devices/"+hardwareSlug(selected.platform,selected.device)+"#vision-frontier");
      }
      return;
    }
    pickDevice(id);
    setWorkloadVisit(previous => previous + 1);
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
      {storageAvailable && <div className="hardware-preference">
        {remembered === deviceId ? <><span>Default on this browser</span> <button type="button" onClick={() => {
          try { window.localStorage.removeItem("aicharts.hardware"); setRemembered(""); } catch { setStorageAvailable(false); }
        }}>Forget saved device</button></> :
        <button type="button" onClick={() => {
          try { window.localStorage.setItem("aicharts.hardware",deviceId); setRemembered(deviceId); manual.current = true; }
          catch { setStorageAvailable(false); }
        }}>Remember {device} on this browser</button>}
      </div>}
      {suggestions.length > 0 && <div className="hardware-shortcuts"><span>Compare on shared tests</span>{suggestions.map(({entry,workloads,tests}) =>
        <button key={entry.value} type="button" title={workloads+" workloads · "+tests+" matching configurations"} onClick={() => { manual.current = true; setPeerId(entry.value); }}><DeviceIcon kind={entry.icon}/> {entry.device}</button>)}</div>}
      {[deviceId,...(peer?[peer.value]:[])].filter(id=>visionByDevice.has(id)).map(id=>{
        const target=entries.find(e=>e.value===id)!;
        return <p key={id}><a href={"/local/devices/"+hardwareSlug(target.platform,target.device)+"#vision-frontier"}>{target.device} image classification frontier</a> · {visionByDevice.get(id)!.toLocaleString()} timm timings</p>;
      })}
      {(left.length>0 || right.length>0) && <WorkloadResults key={JSON.stringify([deviceId,peerId,workloadVisit])} left={left} right={right} device={device} peer={peer?.device} inspect={inspect}/>}
      <div className="hardware-coverage">
        <h3>Browse by workload</h3>
        {[{label:"Measured on your selection",items:covered},{label:"Measured on other hardware",items:absent}].filter(group => group.items.length).map(group =>
          <div key={group.label}><p>{group.label}</p><div className="coverage-tasks">{group.items.map(task => <button type="button" key={task} aria-pressed={task === browseTask} onClick={() => setBrowseTask(task === browseTask ? "" : task)}>
          {task} <span>{devicesByTask.get(task)?.size ?? 0} devices</span>
        </button>)}</div></div>)}
        {browseTask && <div className="hardware-browse-results">
          <div className="hardware-shortcuts"><span>{browseTask} measurements</span>{detectionEntries.filter(e => devicesByTask.get(browseTask)?.has(e.value)).slice(0,3).map(e =>
            <button type="button" key={e.value} onClick={() => viewWorkload(e.value,browseTask)}><DeviceIcon kind={e.icon}/> {e.device}</button>)}</div>
          <CompactPicker label={"Measured devices for " + browseTask} value={devicesByTask.get(browseTask)?.has(deviceId) ? deviceId : ""} options={[
          {value:"",label:"Choose measured hardware"},...entries.filter(e => devicesByTask.get(browseTask)?.has(e.value))]} onChange={id => viewWorkload(id,browseTask)} /></div>}
      </div>
      {left.length>=4 && <><a href={"/local/devices/"+hardwareSlug(platform,device)}>{device} benchmark report</a> · </>}
      <a href={"/local?" + new URLSearchParams({platform, device, peer: peer?.value ?? ""}) + "#hardware"}>Share device overview</a>
      {active && <details className="hardware-drill" id="hardware-detail" open={inspecting} onToggle={e => setInspecting(e.currentTarget.open)}>
      <summary>Explore all measurements on {device}</summary>
      <div className="hardware-controls">
        {active && available.length > 1 && <CompactPicker label="Measurement" value={active.id} options={
          available.map(({ suite, id, key }) => ({
            value: id, label: suite.title + " · " + metrics[key]!.label,
            group: suite.task ?? tasks[suite.id] ?? suite.title, description: metrics[key]!.unit,
          }))
        } onChange={setMeasurement} />}
      </div>

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
      </details>}
      <noscript><p>The initial device measurements are available above. Download the full dataset to inspect other devices.</p></noscript>
    </section>
  );
}
