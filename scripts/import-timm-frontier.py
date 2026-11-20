"""Regenerate the local vision explorer. Optional argument: directory of pinned source CSVs."""
import csv
import io
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen

REV = "b4f423c19f778672f875e0948f296322c775f24b"
REPO = "huggingface/pytorch-image-models"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/benchmarks/timm"
DEVICES = {"rtx3090": "RTX 3090", "rtx4090": "RTX 4090", "4090": "RTX 4090", "5090": "RTX 5090",
           "pro6000maxq": "RTX PRO 6000 Blackwell Max-Q", "i9_10940x": "Core i9-10940X", "i7_12700h": "Core i7-12700H"}
VERSIONS = {"113": "1.13", "210": "2.1.0", "221": "2.2.1", "240": "2.4.0", "291": "2.9.1"}

def source(name):
    if len(sys.argv) > 1:
        return (Path(sys.argv[1]) / name).read_text()
    return urlopen(f"https://raw.githubusercontent.com/{REPO}/{REV}/results/{name}", timeout=30).read().decode()

def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")

scores = defaultdict(list)
for row in csv.DictReader(io.StringIO(source("results-imagenet.csv"))):
    key = (row["model"].split(".")[0], int(row["img_size"]), float(row["param_count"].replace(",", "")))
    scores[key].append((row["model"], float(row["top1"])))
if len(sys.argv) > 1:
    files = [p.name for p in Path(sys.argv[1]).glob("benchmark-infer-*.csv")]
else:
    listing = json.load(urlopen(f"https://api.github.com/repos/{REPO}/contents/results?ref={REV}", timeout=30))
    files = [entry["name"] for entry in listing if entry["name"].startswith("benchmark-infer-") and entry["name"].endswith(".csv")]
assert len(files) == 20, "Incomplete pinned inference tables"
manifest = []
OUT.mkdir(parents=True, exist_ok=True)
for file in sorted(files):
    slug = file.removeprefix("benchmark-infer-").removesuffix(".csv")
    precision, layout, pt, backend, chip, compiled = re.fullmatch(r"([a-z0-9_]+)-(nchw|nhwc)-pt(\d+)-(cpu|cu\d+)-([a-z0-9_]+)(-dynamo)?", slug).groups()
    hardware = DEVICES[chip]
    rows = []
    seen = set()
    for r in csv.DictReader(io.StringIO(source(file))):
        if not all(r[k] for k in ["infer_samples_per_sec","infer_img_size","param_count","infer_batch_size","infer_step_time"]): continue
        model, size, params = r["model"], int(float(r["infer_img_size"])), float(r["param_count"].replace(",", ""))
        speed, batch, step = float(r["infer_samples_per_sec"]), int(float(r["infer_batch_size"])), float(r["infer_step_time"])
        if min(speed,batch,step) <= 0 or not all(map(math.isfinite,[speed,step,params])): continue
        assert (model,size,batch) not in seen
        seen.add((model,size,batch))
        score = scores.get((model,size,params),[])
        rows.append([model,size,params,speed,batch,step,*(score[0] if len(score)==1 else [None,None])])
    path = f"/benchmarks/timm/{slug}.json"
    save(ROOT / "public" / path.lstrip("/"), rows)
    manifest.append(dict(slug=slug,device=hardware,platform="Intel CPUs" if backend=="cpu" else "NVIDIA GPUs",
                         settings=f"PyTorch {VERSIONS[pt]} · {backend.upper()} · {precision.upper()} · {layout.upper()} · {'compiled' if compiled else 'eager'}",
                         path=path,count=len(rows),matched=sum(row[-1] is not None for row in rows),
                         source=f"https://github.com/{REPO}/blob/{REV}/results/{file}"))
save(ROOT/"data/timm-index.json",manifest)
print(len(manifest), "experiments,", sum(e["count"] for e in manifest), "timings,", sum(e["matched"] for e in manifest), "unique checkpoint matches")
