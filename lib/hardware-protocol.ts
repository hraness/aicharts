type ProtocolRun = {model: string; config: string; protocol?: string; note?: string; platform: string};

/** Some sources put execution settings in notes instead of their configuration column. */
export function protocolKey(suite: string, metric: string, run: ProtocolRun) {
  let conditions = run.protocol ?? run.note ?? "";
  if (suite.startsWith("wk-")) conditions = conditions.match(/\bbuild ([a-f0-9]+)/i)?.[1] ?? conditions;
  // The Pi board revision and storage are part of the tested hardware; keep the common
  // pinned llama.cpp recipe comparable. Other differing source notes stay distinct.
  if (suite === "pi-llama") conditions = "";
  if (suite === "moi" && ["peak","memoryMB","meanRss"].includes(metric)) conditions += " " + run.platform;
  return JSON.stringify([suite, metric, run.model, run.config, conditions]);
}
