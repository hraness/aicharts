import { expect, test } from "bun:test";
import { matchDevice } from "./device-match";
import { protocolKey } from "./hardware-protocol";

const devices = [
  ["iPhone & iPad","iPhone 17 Pro"], ["iPhone & iPad","iPad Pro"],
  ["Apple silicon Macs","Apple M2 Pro"], ["Apple silicon Macs","Apple M2 Max"],
  ["Android","Samsung Galaxy S25"], ["NVIDIA GPUs","RTX 4090 D"],
  ["NVIDIA GPUs","RTX 4090 Laptop"], ["NVIDIA GPUs","RTX 4090"],
  ["Web browsers","GTX 1650 Laptop · Windows 11"]
].map(([platform,device]) => ({platform:platform!,device:device!,value:device!}));

test("browsers that withhold hardware details get a labeled reference on their platform", () => {
  for (const [platform,agent,touch,device] of [
    ["MacIntel","Safari",0,"Apple M2 Pro"], ["MacIntel","Safari",5,"iPad Pro"],
    ["iPhone","iPhone Safari",5,"iPhone 17 Pro"], ["Win32","Chromium",0,"GTX 1650 Laptop · Windows 11"],
  ] as const) {
    const found = matchDevice({platform,agent,touch},devices);
    expect(found.entry?.device).toBe(device);
    expect(found.reason).toMatch(/reference|same operating system/i);
  }
});

test("device hints keep GPU variants distinct and identify published Android models", () => {
  for (const gpu of ["RTX 4090", "RTX 4090 D", "RTX 4090 Laptop"]) {
    const found = matchDevice({platform:"Win32",agent:"Chrome",touch:0,gpu},devices);
    expect(found.entry?.device).toBe(gpu);
    expect(found.reason).toMatch(/Same GPU model/);
  }
  const found = matchDevice({platform:"Android",agent:"Android Chrome",model:"Samsung Galaxy S25",touch:5},devices);
  expect(found.reason).toMatch(/reported model/);
  expect(matchDevice({platform:"Mac",agent:"Safari",touch:0,gpu:"Apple M3 Max"},devices).entry?.device).toBe("Apple M2 Max");
});

test("device rankings distinguish timing boundaries, corpus builds and memory instruments", () => {
  const run = {model:"Janus",config:"384",platform:"iPhone",note:"Baseline"};
  const other = {...run,platform:"Android"};
  expect(protocolKey("moi","latency",run)).not.toBe(protocolKey("moi","latency",{...other,note:"Excludes prompt preparation"}));
  expect(protocolKey("moi","peak",run)).not.toBe(protocolKey("moi","peak",other));
  expect(protocolKey("wk-earnings22","audio",{...run,note:"macOS · build aaaa"})).toBe(protocolKey("wk-earnings22","audio",{...other,note:"iOS · build aaaa"}));
});
