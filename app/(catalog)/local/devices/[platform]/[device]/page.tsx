import { notFound } from "next/navigation";
import { reports,reportFor } from "@/lib/device-reports";
import { measuredMemory,metrics,number,speedKeys,tasks } from "@/lib/local-hardware-format";
import { visionExperiments } from "@/lib/vision-bench";
import { visionRows } from "@/lib/vision-file";
import { VisionExplorer } from "@/components/vision-explorer";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { pageMetadata } from "@/journal/content";
import "../../../local.css";

export const dynamicParams=false;
export function generateStaticParams(){return reports.map(r=>{const [platform,device]=r.slug.split("/");return {platform,device};});}
type Props={params:Promise<{platform:string;device:string}>};
async function selected({params}:Props){const p=await params;return reportFor(p.platform+"/"+p.device) ?? notFound();}
export async function generateMetadata(props:Props){const r=await selected(props);return pageMetadata(r.device+" local AI benchmarks",r.profiles.toLocaleString()+" measured configurations for "+r.device+", covering "+[...r.workloads].join(", ")+". See model settings, timings and original sources.","/local/devices/"+r.slug);}
export default async function DevicePage(props:Props){
  const r=await selected(props), path="/local/devices/"+r.slug;
  const experiments=visionExperiments.filter(e=>e.device===r.device&&e.platform===r.platform);
  const test=experiments.find(e=>e.slug.includes("pt291")&&!e.slug.includes("dynamo")) ?? experiments.at(-1);
  const full="/local?"+new URLSearchParams({platform:r.platform,device:r.device})+"#hardware";
  return <article className="catalog-page"><Breadcrumbs trail={[{name:"Local benchmarks",href:"/local"},{name:"Devices",href:"/local/devices"},{name:r.device,href:path}]}/>
    <h1>{r.device} local AI benchmarks</h1><p>{r.profiles.toLocaleString()} measured configurations across {[...r.workloads].join(", ").toLowerCase()}.</p>
    {!!r.groups.size && <p><a href={full}>Explore all device timings and compare hardware</a></p>}
    {test && <VisionExplorer initial={test} initialRows={await visionRows(test)} deviceOnly/>}
    {[...r.groups].map(([suite,rows])=>{
      const key=speedKeys.find(k=>rows.some(row=>row.values[k]!==undefined));if(!key)return null;
      const available=rows.filter(row=>row.values[key]!==undefined);
      const fastest=available.reduce((a,b)=>((b.values[key]!-a.values[key]!)*(metrics[key]!.lower?1:-1)<0)?b:a);
      const sample=[fastest,...available.filter(row=>row!==fastest)].slice(0,4);
      const hasMemory=sample.some(row=>measuredMemory(row,suite.id) || row.values.inferencePeakHighMB!==undefined);
      return <section key={suite.id}><h2>{suite.title}</h2>
        <p>{r.device} recorded <strong>{number.format(fastest.values[key]!)} {metrics[key]!.unit}</strong> for {fastest.model} ({fastest.config}). {rows.length} published configuration{rows.length===1?"":"s"} in this suite.</p>
        <table className="vision-table"><thead><tr><th>{suite.task??tasks[suite.id]} model</th><th>Test settings</th><th>{metrics[key]!.label}</th>{hasMemory && <th>Memory</th>}</tr></thead>
          <tbody>{sample.map(row=>{const mem=measuredMemory(row,suite.id);return <tr key={row.model+row.config}><th>{row.model}</th><td>{row.config}</td><td>{number.format(row.values[key]!)} {metrics[key]!.unit}</td>{hasMemory && <td>{mem ? number.format(mem.gib)+" GiB · "+mem.kind : row.values.inferencePeakHighMB!==undefined ? [row.values.inferencePeakLowMB,row.values.inferencePeakHighMB].filter(v=>v!==undefined).join("–")+" MB · inference estimate" : "—"}</td>}</tr>})}</tbody></table>
        <details><summary>Measurement conditions</summary><p>{suite.description}</p></details>
        <a href={fastest.source ?? suite.modelSources?.[fastest.model] ?? suite.source}>Published measurements</a>
      </section>;})}
  </article>;
}
