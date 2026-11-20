"""Import device-level language measurements from three immutable primary sources.

python3 scripts/import-local-llm-extra.py [--check] [--mirror DIR]
A mirror contains a directory named after each upstream repository.
"""
import argparse
import csv
import html
import io
import json
import math
import re
import statistics
import urllib.request
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

pins = {
    "john-rocky/edge-llm-bench": "6742038a9eff3ddff61934da570ab52b1e3fa7a7",
    "QwenLM/Qwen3": "7a2f61ffc7a20d47efcd2bf97f6f2bf52729042e",
    "MMeffert/intel-llm-bench": "12b8719025929c046e62142edb9f12e4b0891335",
}
edge_repo = "john-rocky/edge-llm-bench"
qwen_repo = "QwenLM/Qwen3"
intel_repo = "MMeffert/intel-llm-bench"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
parser.add_argument("--mirror", type=Path)
options = parser.parse_args()


def source(repo, path):
    if options.mirror:
        return (options.mirror / repo.split("/")[-1] / path).read_text()
    url = f"https://raw.githubusercontent.com/{repo}/{pins[repo]}/{quote(path)}"
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode()


def url(repo, path, kind="blob"):
    return f"https://github.com/{repo}/{kind}/{pins[repo]}/{quote(path)}"


def suite(id_, title, repo, document, description, metrics):
    return dict(id=id_, task="Language", title=title, source=url(repo, document),
                description=description, metrics=metrics, runs=[])


def positive(value):
    if value in (None, "", "-"):
        return None
    n = float(value)
    return n if n > 0 and math.isfinite(n) else None


def edge():
    tasks = {"short-chat": "Short chat", "long-context-1024-gen256": "1K passage",
             "long-context-2048-gen256": "2K passage", "long-context-2048-gen256-noref": "2K passage, revised prompt"}
    devices = {"Mac16,9": "Mac Studio · M4 Max (40 GPU cores)", "iPhone18,1": "iPhone 17 Pro",
               "iPhone19,2": "iPhone 18 Pro", "SM-S942Q": "Samsung Galaxy S26",
               "Pixel 11 Pro": "Google Pixel 11 Pro", "Pixel 8a": "Google Pixel 8a"}
    platforms = {"android": "Android", "mac": "Apple silicon Macs", "ios": "iPhone & iPad", "windows": "Windows laptops"}
    suites = {task: suite("edge-llm-" + task, "Edge LLM Bench · " + label,
              edge_repo, "results/summary/README.md",
              "Median of at least three output-checked runs in one session, with the same artifact, runtime, prompt length and output length. Cold and warm runs are separate. Apple reports sampled process footprint during generation. Android reports peak resident memory including load.",
              ["generation", "prompt", "firstToken", "peak", "peakResidentMiB"]) for task, label in tasks.items()}
    # Keep a single physical setup, prompt and output length per pool.
    dimensions = ("device", "model_id", "model_file", "runtime", "engine_version", "engine_artifact",
                  "harness_stamp", "campaign", "task", "prompt_version", "cold_run", "context_tokens",
                  "prompt_tokens", "gen_tokens", "os_version", "battery_state", "thermal_initial", "thermal_final",
                  "quantization")
    pools = defaultdict(list)
    records = csv.DictReader(io.StringIO(source(edge_repo, "results/summary/device-runs.csv")))
    for r in records:
        if (r["task"] not in tasks or not r["text_check"].startswith("PASS") or r["first_ever"] == "True"
                or r["cpu_capped"] == "true" or r["backend_registered"] == "false"
                or r["cold_run"] not in ("True", "False") or not r["engine_version"] or not r["model_file"]
                or not positive(r["prompt_tokens"]) or not positive(r["gen_tokens"])
                or not positive(r["decode_tps"]) or r["thermal_initial"] not in ("", "nominal")
                or r["thermal_final"] not in ("", "nominal", "fair", "light")):
            continue
        pools[tuple(r[k] for k in dimensions)].append(r)
    newest = {}
    for records in pools.values():
        if len(records) < 3:
            continue
        r = records[0]
        # Runtime reports corrected engine_version; the file name identifies the exact
        # model artifact even when an early record carried an outdated quantization label.
        cold = "cold" if r["cold_run"] == "True" else "warm"
        config = f"{r['runtime']} {r['engine_version']} · {r['prompt_tokens']} in / {r['gen_tokens']} out · {cold}"
        if r["context_tokens"]:
            config += f" · ctx {r['context_tokens']}"
        if "d720copy" in r["model_file"]:
            config += " · D720 model variant"
        # Keep the most recent reproducible session for each setup. Never mix trials
        # across sessions. Different file variants and prompt versions stay separate.
        protocol = " · ".join(filter(None, [r["model_file"], r["harness_stamp"], r["prompt_version"]]))
        label = devices.get(r["device"], r["device"])
        identity = (r["task"], label, r["model_id"], config, protocol)
        stamp = max(x["timestamp"] for x in records)
        if identity in newest and stamp <= newest[identity][0]:
            continue
        metrics = {"generation": "decode_tps", "prompt": "prefill_tps", "firstToken": "ttft_ms"}
        if r["platform"] in ("ios", "mac"):
            metrics["peak"] = "mem_footprint_peak_mb"
        elif r["platform"] == "android":
            metrics["peakResidentMiB"] = "mem_resident_peak_mb"
        values = {}
        for key, col in metrics.items():
            series = [positive(x[col]) for x in records]
            if all(v is not None for v in series):
                values[key] = round(statistics.median(series), 4)
        os_label = {"android": "Android", "ios": "iOS", "mac": "macOS", "windows": "Windows"}[r["platform"]]
        trial_note = f"Median of {len(records)} runs · {os_label} {r['os_version']} · power {r['battery_state'] or 'unreported'}"
        if r["thermal_initial"]:
            trial_note += f" · thermal {r['thermal_initial']} to {r['thermal_final']}"
        results = dict(device=label, platform=platforms[r["platform"]], model=r["model_id"], config=config,
                       protocol=protocol, values=values, note=trial_note, source=url(edge_repo, r["campaign"], "tree"))
        capacity = {"Mac16,9": "128 GB unified memory", "SM-S942Q": "12 GB RAM",
                    "Pixel 8a": "8 GB RAM", "Pixel 11 Pro": "16 GB RAM",
                    "iPhone19,2": "12 GB RAM", "iPhone18,1": "12 GB RAM"}.get(r["device"])
        if capacity:
            results["capacity"] = capacity
        newest[identity] = (stamp, results)
    for (task, *_), (_, record) in sorted(newest.items()):
        suites[task]["runs"].append(record)
    return [s for s in suites.values() if s["runs"]]


def qwen():
    path = "docs/source/getting_started/speed_benchmark.md"
    page = source(qwen_repo, path)
    result = suite("qwen3-h20", "Qwen3 context and quantization on H20", qwen_repo, path,
                   "Qwen’s batch-one benchmark generates 2,048 tokens. Throughput includes both prompt and output tokens divided by elapsed time. Transformers reports GPU memory in MB. SGLang reserves memory in advance and omits it.",
                   ["combinedTokens", "memoryMB"])
    for heading, body in re.findall(r"^### (Qwen3-[^\n]+)\n(.*?)(?=^### |\Z)", page, re.M | re.S):
        match = re.fullmatch(r"(Qwen3-[\w.-]+)\s+\((SGLang|Transformers)\)\s*", heading)
        model, engine = match.groups()
        table = re.search(r"<tbody>(.*?)</tbody>", body, re.S)[1]
        for cells_html in re.findall(r"<tr>(.*?)</tr>", table, re.S):
            cells = [html.unescape(re.sub(r"<[^>]+>", " ", v)).strip() for v in re.findall(r"<td[^>]*>(.*?)</td>", cells_html, re.S)]
            if cells[0].startswith("Qwen3-"):
                assert cells.pop(0).casefold() == model.casefold()
            if cells[0].isdigit():
                length = int(cells.pop(0))
            quant, gpus, speed, aux, *extra = cells
            assert len(extra) <= 1, cells
            # Some model tables show 129042 where the protocol states 129024.
            # Do not report profiles with ambiguous prompt lengths or missing speeds.
            if length not in (1, 6144, 14336, 30720, 63488, 129024) or not positive(speed):
                continue
            values = {"combinedTokens": float(speed)}
            if engine == "Transformers" and positive(aux):
                values["memoryMB"] = float(aux)
            config = f"{engine} · {quant} · {length:,} input tokens"
            if engine == "SGLang" and aux not in ("", "-"):
                config += " · " + aux
            if extra and extra[0]:
                config += " · " + extra[0]
            d = "NVIDIA H20 · 96 GB" if gpus == "1" else f"{gpus} × NVIDIA H20 · 96 GB each"
            result["runs"].append(dict(device=d, platform="NVIDIA GPUs", model=model, config=config, values=values))
    return result


def intel():
    suites = []
    for sweep, file in [(False, "results.jsonl"), (True, "moe-tune-results.jsonl")]:
        name = "Intel Arc expert offload sweep" if sweep else "Intel Arc Vulkan inference"
        result = suite("intel-arc-" + ("offload" if sweep else "vulkan"), name, intel_repo, file,
                       "Independent one-host llama-bench measurements. Mean over three runs, 512-token prompt and 128-token generation. The host used a Core Ultra 9 285K and 128 GB DDR5. The discrete Arc A770 has 16 GB VRAM.",
                       ["prompt", "generation"])
        for line in source(intel_repo, file).splitlines():
            row = json.loads(line)
            if row["status"] != "ok":
                continue
            model = row["model"] if sweep else row["name"]
            if model == "qwen3.6-27b" and not sweep:
                continue  # Author reports likely silent CPU fallback.
            device = "Core Ultra 9 285K · integrated graphics" if row.get("device") == "igpu" else "Intel Arc A770"
            config = (row.get("quant") or "UD-Q4_K_M") + " · Vulkan"
            if sweep or row.get("device") == "cpu_offload":
                config += f" · -ncmoe {row.get('ncmoe', 999)}"
            values = {"prompt": row["pp_tok_s"], "generation": row["tg_tok_s"]}
            run = dict(device=device, platform="Intel graphics", model=model, config=config, values=values)
            if device == "Intel Arc A770":
                run["capacity"] = "16 GB VRAM"
            result["runs"].append(run)
        suites.append(result)
    return suites


data = {"suites": [*edge(), qwen(), *intel()]}
for s in data["suites"]:
    identities = set()
    for r in s["runs"]:
        identity = (r["device"], r["model"], r["config"])
        assert identity not in identities, identity
        identities.add(identity)
        assert all(k in s["metrics"] and math.isfinite(v) and v > 0 for k, v in r["values"].items())
    print(s["id"], len(s["runs"]))
out = Path(__file__).resolve().parents[1] / "data/local-hardware-llm-extra.json"
serialized = '{ "suites": [\n' + ',\n'.join(json.dumps({k:v for k,v in s.items() if k != "runs"}, ensure_ascii=False)[:-1]
    + ', "runs": [\n' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in s["runs"]) + '\n]}' for s in data["suites"]) + '\n]}\n'
assert json.loads(serialized) == data
if options.check:
    assert serialized == out.read_text(), "Snapshot differs"
else:
    out.write_text(serialized)
