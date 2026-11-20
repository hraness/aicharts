"use client";
import { useEffect,useState } from "react";
import { CompactPicker } from "./compact-picker";
import { frontierOf, TradeoffPlot } from "./tradeoff-plot";
import { hardwareSlug,visionExperiments, validationSource, type Experiment, type VisionRow } from "@/lib/vision-bench";
import { deviceKind } from "@/lib/device-kind";

const fmt=new Intl.NumberFormat("en",{maximumFractionDigits:2});
const rowKey=(r:VisionRow)=>[r[0],r[1],r[4]].join("/");
export function VisionExplorer({initial,initialRows,deviceOnly=false}:{initial:Experiment;initialRows:VisionRow[];deviceOnly?:boolean}) {
  const [slug,setSlug]=useState(initial.slug),[loaded,setLoaded]=useState({test:initial,rows:initialRows});
  const [error,setError]=useState(""),[retry,setRetry]=useState(0),[query,setQuery]=useState(""),[mode,setMode]=useState("frontier"),[page,setPage]=useState(0),[chosen,setChosen]=useState("");
  const [batch,setBatch]=useState(""),[floor,setFloor]=useState("");
  const experiments=deviceOnly?visionExperiments.filter(e=>e.device===initial.device):visionExperiments;
  useEffect(()=>{
    const test=visionExperiments.find(e=>e.slug===slug)!;
    setError("");
    if(test.slug===initial.slug){setLoaded({test:initial,rows:initialRows});return;}
    const controller=new AbortController();
    fetch(test.path,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then((rows:VisionRow[])=>{
      if(!controller.signal.aborted)setLoaded({test,rows});
    }).catch(()=>{if(!controller.signal.aborted)setError("Could not load the published timings.");});
    return ()=>controller.abort();
  },[slug,initial,initialRows,retry]);
  const {test,rows}=loaded;
  const batches=[...new Set(rows.map(r=>r[4]))].sort((a,b)=>a-b);
  const eligible=rows.filter(r=>(!batch || r[4]===Number(batch)) && (!floor || r[7]!==null && r[7]>=Number(floor)));
  const points=eligible.flatMap(r=>r[7]===null?[]:[{key:rowKey(r),label:r[0],x:r[3],y:r[7]}]);
  const frontier=frontierOf(points,false,false);
  const keys=new Set(frontier.map(p=>p.key));
  const active=eligible.find(r=>rowKey(r)===chosen) ?? eligible.find(r=>rowKey(r)===frontier[Math.floor(frontier.length/2)]?.key);
  const search=query.toLowerCase().trim();
  const filtered=eligible.filter(r=>(mode!=="frontier"||keys.has(rowKey(r)))&&(!search||[r[0],r[6],r[1]].join(" ").toLowerCase().includes(search)));
  const pages=Math.ceil(filtered.length/10), current=Math.min(page,Math.max(0,pages-1));
  return <section className="vision-explorer" id="vision-frontier" aria-label="Image classification frontier">
    <h2>Image classification frontier</h2>
    <p>Compare ImageNet-1k top-1 accuracy with the number of images a device processes per second. Each point is a measured architecture at its published image and batch sizes.</p>
    <CompactPicker label="Vision benchmark run" value={slug} options={experiments.map(e=>({value:e.slug,label:e.device+" · "+e.settings,group:e.device,icon:deviceKind(e.device,e.platform)}))} onChange={id=>{setSlug(id);setPage(0);setChosen("");setBatch("");}}/>
    <div className="vision-tools">{batches.length>1 && <CompactPicker label="Batch size" value={batch} options={[{value:"",label:"All published batches"},...batches.map(b=>({value:String(b),label:String(b)+" images"}))]} onChange={v=>{setBatch(v);setPage(0);setChosen("");}}/>}
      <label>Minimum top-1 (%) <input type="number" min="0" max="100" step="any" placeholder="Any" value={floor} onChange={e=>{setFloor(e.target.value);setPage(0);setChosen("");}}/></label></div>
    {slug!==test.slug && <p role="status">{error || "Loading benchmark…"} {error && <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry</button>}</p>}
    <p className="vision-caption"><strong>{test.device}</strong> · {points.length.toLocaleString()} plotted · {frontier.length} on the frontier</p>
    {!deviceOnly && <a href={"/local/devices/"+hardwareSlug(test.platform,test.device)}>{test.device} device report</a>}
    <strong className="vision-axis">Top-1 accuracy (%)</strong>
    {!points.length && <p role="status">No scored architectures match these limits.</p>}
    <TradeoffPlot points={points} selected={active?rowKey(active):""} onSelect={setChosen} xLabel="Throughput (images/s)" yLabel="Top-1 accuracy (%)"/>
    {active && <p className="vision-readout"><strong>{active[6] ?? active[0]}</strong> · {fmt.format(active[3])} images/s{active[7]!==null && " · "+fmt.format(active[7])+"% top-1"} · {active[1]} px · batch {active[4]}</p>}
    <div className="vision-tools"><div role="group" aria-label="Vision results">{["frontier","all"].map(m=><button type="button" key={m} aria-pressed={mode===m} onClick={()=>{setMode(m);setPage(0);}}>{m==="frontier"?"Frontier":"All timings"}</button>)}</div>
      <input aria-label="Search vision models" type="search" placeholder="Search models" value={query} onChange={e=>{setQuery(e.target.value);setMode("all");setPage(0);}}/></div>
    <table className="vision-table"><thead><tr><th>Architecture</th><th>Images/s</th><th>Top-1</th><th>Batch</th></tr></thead><tbody>
      {filtered.slice(current*10,current*10+10).map(r=><tr key={rowKey(r)}><th><button onClick={()=>setChosen(rowKey(r))}>{r[0]}</button><small>{r[1]} px · {fmt.format(r[5])} ms/batch</small></th><td>{fmt.format(r[3])}</td><td>{r[7]===null?"—":fmt.format(r[7])+"%"}</td><td>{r[4]}</td></tr>)}
    </tbody></table>
    {filtered.length===0?<p>No matching models.</p>:pages>1 && <div className="vision-tools"><button disabled={!current} onClick={()=>setPage(current-1)}>Previous models</button><span>{current+1} / {pages}</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Next models</button></div>}
    <details><summary>Sources and comparison method</summary><p>The frontier contains checkpoints for which no plotted option is both at least as fast and at least as accurate with a strict advantage in either measure. Accuracy comes from a separate validation run. We match architecture, input size and parameter count and require a single matching checkpoint. Unmatched timings remain in the table. Batch throughput describes bulk processing.</p><a href={test.source}>Timing CSV</a> · <a href={validationSource}>Validation CSV</a> · <a href={test.path}>Download this run</a></details>
  </section>;
}
