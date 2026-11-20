export const deviceTerms = {
  phone:"phone smartphone handset mobile", tablet:"tablet ipad mobile", gpu:"graphics card accelerator discrete gpu",
  cpu:"processor cpu desktop", laptop:"laptop notebook portable", desktop:"desktop workstation computer",
  board:"edge board embedded sbc", browser:"web browser webgpu",
} as const;
export type DeviceKind = keyof typeof deviceTerms;
export function deviceKind(device:string, platform:string):DeviceKind {
  const text = device.toLowerCase();
  if (/chipsets/i.test(platform)) return "cpu";
  if (/npus/i.test(platform)) return "board";
  if (/ipad|tablet|\btab\b|\bpad \d|lenovo tb\d/.test(text)) return "tablet";
  if (/iphone|android|reference phones/i.test(platform)) return "phone";
  if (/browser/i.test(platform)) return "browser";
  if (/laptop|macbook|notebook|stealth|snapdragon x/.test(text)) return "laptop";
  if (/board|edge|automotive/i.test(platform)) return "board";
  if (/gpu|graphics/i.test(platform)) return "gpu";
  if (/cpu/i.test(platform)) return "cpu";
  return "desktop";
}

export function deviceKeywords(device:string, platform:string) {
  const name=device.toLowerCase();
  const words=[deviceTerms[deviceKind(device,platform)],platform];
  if(/iphone|ipad/.test(platform.toLowerCase()))words.push("Apple iOS iPadOS");
  if(/apple silicon/i.test(platform))words.push("Apple Mac macOS");
  if(/galaxy/.test(name))words.push("Samsung Android");
  if(/pixel/.test(name))words.push("Google Android");
  if(/snapdragon/.test(name))words.push("Qualcomm");
  if(/geforce|rtx|gtx/.test(name))words.push("NVIDIA");
  if(/radeon|ryzen/.test(name))words.push("AMD");
  return words;
}
