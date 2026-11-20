"use client";
import { useEffect, useRef, useState } from "react";
import { computeParetoFrontier } from "@/lib/pareto";

export type TradeoffPoint = {key:string;label:string;x:number;y:number};
export function frontierOf(points:TradeoffPoint[], lowerX:boolean, lowerY:boolean) {
  return computeParetoFrontier(points.map(p => ({...p,budget:lowerX ? p.x : -p.x,score:lowerY ? -p.y : p.y})));
}
const format = new Intl.NumberFormat("en",{maximumFractionDigits:2,notation:"compact"});
export function TradeoffPlot({points,lowerX=false,lowerY=false,xLabel,yLabel,selected,onSelect}:{
  points:TradeoffPoint[];lowerX?:boolean;lowerY?:boolean;xLabel:string;yLabel:string;selected:string;onSelect:(key:string)=>void
}) {
  const root=useRef<SVGSVGElement>(null);
  const [width,setWidth]=useState(680);
  const hasPoints=points.length>0;
  useEffect(()=>{
    const el=root.current;
    if (!el) return;
    const observer=new ResizeObserver(([entry])=>{if(entry && entry.contentRect.width>0)setWidth(Math.max(235,entry.contentRect.width));});
    observer.observe(el);return ()=>observer.disconnect();
  },[hasPoints]);
  if (!points.length) return null;
  const height=240, left=53, right=width-16, top=17, bottom=height-39;
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const log=minX>0 && maxX/minX>12;
  function linearTicks(low:number,high:number) {
    if(low===high) return [low];
    const rough=(high-low)/4, unit=10**Math.floor(Math.log10(rough));
    const multiple=rough/unit;
    const step=(multiple<1.5?1:multiple<3.5?2:multiple<7.5?5:10)*unit;
    const start=Math.floor(low/step),end=Math.ceil(high/step);
    return Array.from({length:end-start+1},(_,i)=>(start+i)*step);
  }
  const xTicks=log ? Array.from({length:Math.ceil(Math.log10(maxX))-Math.floor(Math.log10(minX))+1},(_,i)=>10**(i+Math.floor(Math.log10(minX)))) : linearTicks(minX,maxX);
  const yTicks=linearTicks(minY,maxY);
  const scaleX=(v:number)=>log?Math.log10(v):v;
  const lowX=scaleX(xTicks[0]!),highX=scaleX(xTicks.at(-1)!);
  const lowY=yTicks[0]!,highY=yTicks.at(-1)!;
  const x=(v:number)=>left+(right-left)*(highX===lowX?.5:(scaleX(v)-lowX)/(highX-lowX));
  const y=(v:number)=>bottom-(bottom-top)*(highY===lowY?.5:(v-lowY)/(highY-lowY));
  const frontier=frontierOf(points,lowerX,lowerY), active=points.find(p=>p.key===selected);
  return <svg ref={root} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={yLabel+" by "+xLabel+" with measured frontier"} className="local-tradeoff" onClick={e=>{
    const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)*width/r.width,py=(e.clientY-r.top)*height/r.height;
    const distance=(p:TradeoffPoint)=>(x(p.x)-px)**2+(y(p.y)-py)**2;
    onSelect(points.reduce((best,p)=>distance(p)<distance(best)?p:best).key);
  }}>
    {yTicks.map(t=><g key={t}><line x1={left} x2={right} y1={y(t)} y2={y(t)}/><text x={left-6} y={y(t)+4} textAnchor="end">{format.format(t)}</text></g>)}
    {xTicks.map((t,i)=><text key={t} x={x(t)} y={bottom+16} textAnchor={i===0?"start":i===xTicks.length-1?"end":"middle"}>{format.format(t)}</text>)}
    <text x={left} y={height-3}>{xLabel}{log?" · log scale":""}</text>
    <path className="local-cloud" d={points.map(p=>`M${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}h.1`).join("")}/>
    <polyline className="local-frontier-line" points={frontier.map(p=>x(p.x)+","+y(p.y)).join(" ")}/>
    {frontier.map(p=><circle key={p.key} cx={x(p.x)} cy={y(p.y)} r="3" className="local-efficient"/>)}
    {active && <circle className="local-selected" cx={x(active.x)} cy={y(active.y)} r="6"/>}
  </svg>;
}
