/** Browser signals stay in this tab. Platform and GPU often identify a family only. */
type DeviceSignals = { platform: string; agent: string; touch: number; model?: string; gpu?: string };
export type DeviceEntry = { device: string; platform: string; value: string };
export type DeviceMatch = { detected: string; entry?: DeviceEntry; reason: string };
const tidy = (text: string) => text.toLowerCase().replace(/[®™]/g, "").replace(/[^a-z0-9+]+/g, " ").trim();
const appleChip = (text: string) => text.match(/\bm(\d+)(?: (pro|max|ultra))?\b/i);
const graphicsChip = (text: string) => text.match(/\b(?:rtx|gtx|rx|arc) (?:pro |[ab] ?)?\d{3,4}(?: (?:ti super|xtx|super|ti|xt|gre|d))?\b/i)?.[0];
const mobileGpu = (text: string) => /\b(?:laptop|mobile|max q)\b/i.test(text);

export function matchDevice(signals: DeviceSignals, devices: readonly DeviceEntry[]): DeviceMatch {
  const ua = signals.agent;
  const ipad = /iPad/i.test(ua) || (/mac/i.test(signals.platform) && signals.touch > 1);
  const family = ipad ? "iPad" : /iPhone|iPod/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android" :
    /mac/i.test(signals.platform) ? "Mac" : /win/i.test(signals.platform) ? "Windows" :
    /linux/i.test(signals.platform) ? "Linux" : "Unknown platform";
  const model = signals.model?.trim() || (family === "Android" ? ua.match(/;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;()]+?) Build\//i)?.[1]?.trim() : undefined);
  const gpu = tidy(signals.gpu ?? "");
  const chip = appleChip(gpu);
  const gpuName = graphicsChip(gpu);
  const appleMac = family === "Mac" && (chip || /apple/.test(gpu));
  let category = family === "Android" ? "Android" : ["iPhone", "iPad"].includes(family) ? "iPhone & iPad" :
    appleMac ? "Apple silicon Macs" : gpuName?.startsWith("rx") || /amd|radeon/.test(gpu) ? "AMD graphics" :
    gpuName?.startsWith("arc") || /intel/.test(gpu) ? "Intel graphics" : /nvidia|rtx|gtx/.test(gpu) ? "NVIDIA GPUs" : undefined;
  if (!category && family === "Mac") category = "Apple silicon Macs";
  const reported = model && model !== "K" ? model : undefined;
  // Samsung's published product/model list covers these market identifiers:
  // https://www.samsung.com/global/sustainability/policy-file/AYVhR1k6BicAIx95/LCA%20Results%20for%20Smartphones.pdf
  const galaxyModels: Record<string,string> = {
    "921":"S24", "926":"S24+", "928":"S24 Ultra", "931":"S25", "936":"S25+",
    "938":"S25 Ultra", "942":"S26", "947":"S26+", "948":"S26 Ultra",
  };
  const code = reported?.match(/^SM-S(\d{3})[A-Z][A-Z0-9]*(?:\/DS)?$/i)?.[1];
  const name = code && galaxyModels[code] ? "Samsung Galaxy " + galaxyModels[code] : reported;
  const graphics = chip?.[0] ?? gpuName ?? (appleMac ? "Apple GPU" : gpu.match(/nvidia|intel|amd|radeon/i)?.[0]);
  const detected = [family, reported ?? graphics?.toUpperCase()].filter(Boolean).join(" · ");
  const candidates = devices.filter(e => !/^\d+\s*[×x]/i.test(e.device) && e.platform === category && (family !== "iPhone" && family !== "iPad" || e.device.startsWith(family)));
  if (name) {
    const exact = candidates.find(e => tidy(e.device).replace(/^(samsung|google) /,"") === tidy(name).replace(/^(samsung|google) /,""));
    if (exact) return {detected,entry:exact,reason:"Published measurements for the reported model. Regional chips and memory can vary."};
  }
  if (appleMac && chip) {
    const matching = candidates.filter(e => appleChip(tidy(e.device))?.[0] === chip[0]);
    if (matching.length) return {detected,entry:matching.find(e => tidy(e.device).replace(/^apple /,"") === chip[0]) ?? matching[0],
      reason:"Same chip. The tested Mac’s memory and GPU core count may differ."};
    const related = candidates.filter(e => {
      const c = appleChip(tidy(e.device));
      return c && c[2] === chip[2];
    }).sort((a,b) => Math.abs(Number(appleChip(a.device)![1]) - Number(chip[1])) - Math.abs(Number(appleChip(b.device)![1]) - Number(chip[1])));
    if (related[0]) return {detected,entry:related[0],reason:"Closest listed generation in the same Apple chip tier. Its speeds are a reference."};
  }
  if (gpuName) {
    const match = candidates.find(e => graphicsChip(tidy(e.device)) === gpuName && mobileGpu(e.device) === mobileGpu(gpu));
    if (match) return {detected,entry:match,reason:"Same GPU model. Power limits, host hardware and drivers can differ."};
  }
  if (gpuName) {
    // Prefer the same series/tier across generations, and preserve desktop vs laptop.
    // This identifies a related product, without predicting a performance ratio.
    const segment = (label: string) => graphicsChip(tidy(label))?.match(/^(rtx|gtx|rx) (\d{1,2})(\d{2})(.*)$/);
    const target = segment(gpuName);
    if (target) {
      const related = candidates.flatMap(entry => {
        const other = segment(entry.device);
        if (!other || other[1] !== target[1] || other[3] !== target[3] ||
          other[4] !== target[4] || mobileGpu(entry.device) !== mobileGpu(gpu)) return [];
        return [{entry,distance:Math.abs(Number(other[2]) - Number(target[2]))}];
      }).sort((a,b) => a.distance - b.distance);
      if (related[0]) return {detected, entry:related[0].entry, reason:"Related GPU in the same product tier. Speeds are for the listed card."};
    }
  }
  if (name && family === "Android") {
    const series = (label: string) => tidy(label).match(/galaxy s(\d+)(\+| ultra)?(?:\s|$)/);
    const galaxy = series(name);
    if (galaxy) {
      const ranked = candidates.flatMap(entry => {
        const tested = series(entry.device);
        return tested ? [{entry, tier:tested[2] === galaxy[2], distance:Math.abs(Number(tested[1]) - Number(galaxy[1]))}] : [];
      }).sort((a,b) => Number(b.tier) - Number(a.tier) || a.distance - b.distance);
      if (ranked[0]) return {detected,entry:ranked[0].entry,reason:"Related Galaxy S model. The chart shows the tested phone’s measurements."};
    }
    const line = tidy(name).match(/^(google pixel|pixel|samsung galaxy|galaxy|xiaomi|oneplus)\b/)?.[1];
    const sibling = line && candidates.find(e => tidy(e.device).includes(line.replace(/^(samsung|google) /,"")));
    if (sibling) return {detected,entry:sibling,reason:"Measured example from the same phone family. Select the exact model if available."};
  }
  if (!category && (family === "Windows" || family === "Linux")) {
    const os = family === "Windows" ? /Windows/i : /Linux|Ubuntu|Fedora/i;
    const entry = devices.find(e => e.platform === "Web browsers" && os.test(e.device));
    if (entry) return {detected, entry, reason:"Browser benchmark on the same operating system. Choose your GPU for a closer match."};
  }
  if (candidates[0]) return {detected,entry:candidates[0],reason:"Platform reference with published results. The browser did not identify a matching configuration."};
  return {detected,reason:"Choose your hardware to see its results. The chart starts with a measured example."};
}

export async function browserSignals(): Promise<DeviceSignals> {
  const n = navigator as Navigator & {
    userAgentData?: { platform?: string; getHighEntropyValues?(keys: string[]): Promise<{model?:string}> };
    gpu?: {requestAdapter(): Promise<{info?:{description?:string;vendor?:string;isFallbackAdapter?:boolean}} | null>};
  };
  const base = {platform:n.userAgentData?.platform || n.platform, agent:n.userAgent,touch:n.maxTouchPoints};
  async function withinBudget<T>(request: Promise<T> | undefined) {
    if (!request) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([request, new Promise<undefined>(resolve => {
        timeout = setTimeout(() => resolve(undefined), 1200);
      })]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
  const [hint, adapter] = await Promise.all([
    withinBudget(n.userAgentData?.getHighEntropyValues?.(["model"])),
    withinBudget(n.gpu?.requestAdapter()),
  ]);
  const info = adapter?.info;
  return {...base,model:hint?.model,gpu:info && !info.isFallbackAdapter ? [info.vendor,info.description].filter(Boolean).join(" ") : undefined};
}
