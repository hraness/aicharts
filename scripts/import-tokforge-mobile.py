"""Import a public TokForge board snapshot with retail names from Google Play.

Inputs: https://leaderboard.tokforge.ai/v1/board?limit=1000 and
https://storage.googleapis.com/play_public/supported_devices.csv
Usage: python3 scripts/import-tokforge-mobile.py board.json supported_devices.csv
"""
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

names = defaultdict(set)
with open(sys.argv[2], encoding="utf-16", newline="") as catalog:
    for row in csv.DictReader(catalog):
        if row["Marketing Name"].strip():
            names[row["Model"].casefold()].add(row["Marketing Name"].strip())

apple = {"iPhone15,3": "iPhone 14 Pro Max", "iPhone15,4": "iPhone 15",
         "iPhone16,2": "iPhone 15 Pro Max", "iPhone18,2": "iPhone 17 Pro Max"}


def device_name(brand, model):
    if brand == "Apple":
        return apple.get(model, model)
    matches = names[model.casefold()]
    name = next(iter(matches)) if len(matches) == 1 else model
    brand = {"samsung": "Samsung", "google": "Google", "motorola": "Motorola"}.get(brand, brand)
    return name if name.casefold().startswith(brand.casefold()) else f"{brand} {name}"


runs = []
for row in json.loads(Path(sys.argv[1]).read_text())["entries"]:
    if row["unsigned"] or row["decode_tok_per_sec"] <= 0:
        continue
    device = device_name(row["device_brand"], row["device_model"])
    values = {"generation": row["decode_tok_per_sec"]}
    for field, metric in [("prefill_tok_per_sec", "prompt"), ("ttft_ms", "firstToken"),
                          ("peak_mem_mb", "memoryMB")]:
        if row.get(field) and row[field] > 0:
            values[metric] = row[field]
    date = datetime.fromtimestamp(row["updated_at"], timezone.utc).date().isoformat()
    settings = [row["backend"], row["quantization"], row.get("compute_backend"), row["methodology"]]
    if row.get("context_length"):
        settings.append(f'{row["context_length"]} context')
    config = " · ".join(dict.fromkeys(str(v) for v in settings if v))
    protocol = " · ".join(str(v) for v in [row["app_version"], row.get("engine_lib"),
                                            row.get("attention_mode"), row.get("thermal")] if v is not None)
    note = " · ".join(str(v) for v in [row["device_model"], row["soc_model"], row["os_version"], date] if v)
    runs.append(dict(device=device, platform="iPhone & iPad" if row["device_brand"] == "Apple" else "Android",
                     model=row["model_name"], config=config, values=values, protocol=protocol, note=note))
runs.sort(key=lambda r: (r["device"].casefold(), r["model"].casefold(), r["config"]))
assert runs
suite = dict(id="tokforge-mobile", task="Language", title="Community phone reply speeds",
             source="https://tokforge.ai/leaderboard/", metrics=["generation", "prompt", "firstToken", "memoryMB"],
             description="Signed TokForge app submissions. The board retains the best submitted score by chip, model, backend and quantization. A configuration can report its best pass or its median. Prompt rates, first-token delays and app-reported peak memory appear where available. Device RAM capacity is separate. Hardware conditions and app versions vary across submissions.",
             runs=runs)
Path("data/local-hardware-tokforge.json").write_text(json.dumps({"suites": [suite]}, ensure_ascii=False, indent=2) + "\n")
