import { deviceBenchmarks } from "./local-hardware-data";
import { hardwareSlug } from "./vision-bench";
import { tasks, type Suite, type Run } from "./local-hardware-format";
export type DeviceReport = {platform:string;device:string;slug:string;profiles:number; groups:Map<Suite,Run[]>;workloads:Set<string>};
const index=new Map<string,DeviceReport>();
function entry(platform:string,device:string) {
  const slug=hardwareSlug(platform,device);
  const found=index.get(slug);
  if(found && (found.device!==device || found.platform!==platform))throw Error("Ambiguous hardware URL: "+slug);
  const report=found ?? {platform,device,slug,profiles:0,groups:new Map<Suite,Run[]>(),workloads:new Set<string>()};
  index.set(slug,report);return report;
}
for(const suite of deviceBenchmarks.suites as Suite[]) for(const run of suite.runs) {
  const report=entry(run.platform,run.device);
  report.profiles++;
  report.workloads.add(suite.task ?? tasks[suite.id]!);
  if(!report.groups.has(suite))report.groups.set(suite,[]);
  report.groups.get(suite)!.push(run);
}
export const reports=[...index.values()].filter(r=>r.profiles>=4).sort((a,b)=>a.platform.localeCompare(b.platform)||a.device.localeCompare(b.device,"en",{numeric:true}));
export function reportFor(slug:string){return reports.find(report=>report.slug===slug);}
