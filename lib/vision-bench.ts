import index from "@/data/timm-index.json";
export const visionExperiments = index;
export function hardwareSlug(platform:string,device:string) {
  return [platform,device].map(s => s.toLowerCase().replaceAll("+"," plus ").replaceAll("×"," x ").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")).join("/");
}
