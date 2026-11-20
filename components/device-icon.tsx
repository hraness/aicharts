import type { DeviceKind } from "@/lib/device-kind";

const paths:Record<DeviceKind,string> = {
  phone:"M7 2h10v20H7z M10 5h4 M11 19h2",
  tablet:"M4 3h16v18H4z M10 18h4",
  gpu:"M2 5h2v13h17V7H4 M7 18v2h6v-2 M17 10h2m-2 3h2 M13 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  cpu:"M6 6h12v12H6z M9 9h6v6H9z M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3",
  laptop:"M4 4h16v13H4z M4 17l-3 3h22l-3-3",
  desktop:"M2 3h20v14H2z M12 17v4m-5 0h10",
  board:"M3 4h18v16H3z M7 8h6v6H7z M16 8h2m-2 3h2 M6 17h1m2 0h1m2 0h1",
  browser:"M2 4h20v16H2z M2 9h20 M5 6.5h1m2 0h1",
};
export function DeviceIcon({kind}:{kind:DeviceKind}) {
  return <svg className="device-glyph" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg>;
}
