export const deviceTerms = {
  phone:"phone smartphone handset mobile", tablet:"tablet ipad mobile", gpu:"graphics card accelerator discrete gpu",
  cpu:"processor cpu desktop", laptop:"laptop notebook portable", desktop:"desktop workstation computer",
  board:"edge board embedded sbc", browser:"web browser webgpu",
} as const;
export type DeviceKind = keyof typeof deviceTerms;
export function deviceKind(device:string, platform:string):DeviceKind {
  const text = device.toLowerCase();
  if (/ipad|tablet/.test(text)) return "tablet";
  if (/iphone|android|reference phones/i.test(platform)) return "phone";
  if (/browser/i.test(platform)) return "browser";
  if (/laptop|macbook|notebook|stealth|snapdragon x/.test(text)) return "laptop";
  if (/board|edge|automotive/i.test(platform)) return "board";
  if (/gpu|graphics/i.test(platform)) return "gpu";
  if (/cpu/i.test(platform)) return "cpu";
  return "desktop";
}
