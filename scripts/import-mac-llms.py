"""Read pinned upstream Mac benchmark checkouts; supply their directories in argument order."""
import csv
import json
import math
import sys
from pathlib import Path
from urllib.parse import quote

coding, macbench, tasks = map(Path, sys.argv[1:])
def url(repo, revision, path):
    return f"https://github.com/{repo}/blob/{revision}/" + quote(str(path), safe="/")

coding_source = ("weklund/mlx-coding-bench", "5ae9b491f7a0539d5abef949eded6bd57785a981")
mac_source = ("enescingoz/mac-llm-bench", "5e9194811173ce32a2be067f781a67da153af734")
task_source = ("andyast/local-llm-benchmark", "f871b7566c3e2c568e6bb7f533ff508fedc081bf")
def suite(id, title, source, description, metrics):
    return dict(id=id, task="Language", title=title, source=source, description=description, metrics=metrics, runs=[])

speed = suite("mac-llm-context", "Language models by prompt length on Mac", url(*coding_source, "measurements/llm_benchmarks"),
              "Whole-model benchmarks. Each row identifies the tested Mac, runtime, precision, batch and token counts. Generation excludes prompt processing. Output counts can be averages. Repeated configurations use the latest dated CSV. Peak memory is reported by the runtime and can cover different allocations across engines.",
              ["generation","prompt","runtimePeakGiB"])
latest = {}
for path in sorted(coding.glob("measurements/llm_benchmarks/*/*/benchmark_results.csv")):
    settings = json.loads(path.with_name("settings.json").read_text())
    h = settings["hardware_info"]
    for r in csv.DictReader(path.open()):
        model = r["name"]
        generated = float(r["num_generated_tokens"])
        config = " · ".join(filter(None, [
            f"{h['model_name']} {h['memory']} GB, {h['gpu_cores']} GPU cores",
            f"{r['framework']} / {r['backend']}", r["dtype"], f"batch {r['batch_size']}",
            f"{r['num_prompt_tokens']} in / {generated:g} out",
            r.get("optimization"),r.get("optimization_detail"),r.get("prompt_profile")]))
        values = dict(prompt=float(r["prompt_tps"]), generation=float(r["generation_tps"]))
        if r.get("peak_memory_gib") and float(r["peak_memory_gib"]) > 0:
            values["runtimePeakGiB"] = float(r["peak_memory_gib"])
        assert all(math.isfinite(v) and v > 0 for v in values.values())
        latest[(h["chip"],model,config)] = dict(device=h["chip"],platform="Apple silicon Macs",model=model,
            config=config,values=values,source=url(*coding_source,path.relative_to(coding)),note=settings["datetime"])
assert latest
speed["runs"] = sorted(latest.values(),key=lambda r:(r["device"],r["model"].casefold(),r["config"]))

mac = suite("mac-llm-bench", "Mac LLM Bench prompt and generation speeds",url(*mac_source,"results"),
            "The publisher runs prompt processing and generation separately. These rows use the 512-token prompt test and 128-token generation test. Runtime follows the upstream result directory. GGUF resident memory comes from a separate memory probe.",
            ["generation","prompt","peakResidentMiB"])
for path in sorted(macbench.glob("results/**/raw/**/*.json")):
    r=json.loads(path.read_text())
    h,m=r["hardware"],r["model"]
    runtime=path.parent.name
    values=dict(generation=r["speed"]["tg128"],prompt=r["speed"]["pp512"])
    assert all(math.isfinite(v) and v>0 for v in values.values())
    mem=r["memory"].get("peak_rss_gb",0)
    if runtime=="gguf" and mem>0:
        values["peakResidentMiB"]=mem*1024
    mac["runs"].append(dict(device=h["chip"], platform="Apple silicon Macs",model=m["name"],
        config=f"{h['model']} {h['total_ram_gb']} GB, {h['gpu_cores']} GPU cores · {runtime.upper()} · {m['quant']} · pp512 / tg128 · {path.stem.split('_')[-1]}",
        source=url(*mac_source,path.relative_to(macbench)),values=values,note=r["timestamp"]))

work = suite("m4-pro-task-time","Time to finish a prompt on M4 Pro",url(*task_source,"docs/data/m4-pro-speed.csv"),
             "Three runs per prompt on a 48 GB M4 Pro MacBook Pro. Wall time includes the whole request. Output rate uses the server’s completion-token count divided by elapsed time. DiffusionGemma sometimes reports more tokens than the request cap.",
             ["latency","answerRate"])
for r in csv.DictReader(tasks.open()):
    work["runs"].append(dict(device="Apple M4 Pro",platform="Apple silicon Macs",model=r["model"],
        config=f"MacBook Pro 48 GB · {r['runtime']} · {r['quant']} · {r['prompt'].replace('_',' ')}",
        values=dict(latency=float(r["wall_s"]),answerRate=float(r["wall_tok_s"]))))
assert mac["runs"] and work["runs"]
out=Path("data/local-hardware-mac-llms.json")
with out.open("w") as f:
    json.dump(dict(suites=[speed,mac,work]),f,ensure_ascii=False,separators=(",",":"))
    f.write("\n")
