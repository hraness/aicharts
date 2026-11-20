"use client";
import { useState } from "react";
import { DeviceIcon } from "./device-icon";
import { deviceKind,deviceTerms } from "@/lib/device-kind";
import { searchBenchmarks } from "@/lib/benchmark-search";
type Listing={platform:string;device:string;slug:string;profiles:number;workloads:string[]};
export function DeviceDirectoryList({devices}:{devices:Listing[]}){
  const [query,setQuery]=useState("");
  const all=devices.map(device=>{
    const icon=deviceKind(device.device,device.platform);
    return {...device,id:device.slug,label:device.device,icon,summary:device.workloads.join(" "),keywords:[device.platform,deviceTerms[icon]]};
  });
  const visible=searchBenchmarks(all,query), groups=[...new Set(visible.map(d=>d.platform))];
  return <><label className="directory-search">Find hardware<input type="search" placeholder="Device, family, or workload" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <nav className="device-anchors" aria-label="Hardware families">{groups.map(g=><a key={g} href={"#family-"+encodeURIComponent(g)}>{g}</a>)}</nav>
    {!visible.length && <p role="status">No matching devices.</p>}
    {groups.map(g=><section key={g} id={"family-"+g}><h2>{g}</h2><div className="device-directory">{visible.filter(r=>r.platform===g).map(r=>
      <a key={r.slug} href={"/local/devices/"+r.slug}><DeviceIcon kind={r.icon}/> <span><strong>{r.device}</strong><small>{r.profiles.toLocaleString()} configurations · {r.workloads.length} workload{r.workloads.length===1?"":"s"}</small></span></a>)}</div></section>)}</>;
}
