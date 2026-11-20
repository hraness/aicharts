import index from "@/data/timm-index.json";
export const visionExperiments = index;
export type Experiment = typeof index[number];
// Column sequence in the published JSON shards. Nulls denote an unmatched checkpoint.
export type VisionRow = [model:string, resolution:number, parametersM:number, imagesPerSecond:number, batch:number, batchMs:number, checkpoint:string|null, top1:number|null];
export const defaultVision = index.find(e => e.slug === "amp-nchw-pt291-cu128-4090")!;
export const validationSource = index[0]!.source.replace(/[^/]+$/, "results-imagenet.csv");
export function hardwareSlug(platform:string,device:string) {
  return [platform,device].map(s => s.toLowerCase().replaceAll("+"," plus ").replaceAll("×"," x ").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")).join("/");
}
