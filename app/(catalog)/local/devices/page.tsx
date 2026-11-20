import { reports } from "@/lib/device-reports";
import { DeviceDirectoryList } from "@/components/device-directory";
import { pageMetadata } from "@/journal/content";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import "../local.css";
export const metadata=pageMetadata("Local AI benchmarks by device","Find published local model speeds, memory measurements and test settings for phones, GPUs, CPUs and edge devices.","/local/devices");
export default function DeviceDirectory(){
  const devices=reports.map(({device,platform,slug,profiles,workloads})=>({device,platform,slug,profiles,workloads:[...workloads]}));
  return <article className="catalog-page"><Breadcrumbs trail={[{name:"Local benchmarks",href:"/local"},{name:"Devices",href:"/local/devices"}]}/>
    <h1>Local AI benchmarks by device</h1><DeviceDirectoryList devices={devices}/>
  </article>;
}
