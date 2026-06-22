from __future__ import annotations

import copy
import csv
import json

_COLUMNS = ["id", "text", "normalized_text", "modern_text", "keyword",
            "explanation", "category", "sources", "source_refs", "variant_group"]


def write_enriched_csv(rows: list[dict], path: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=_COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({c: r[c] for c in _COLUMNS})


def enrich_json(base_json: list[dict], rows_by_id: dict[str, dict]) -> list[dict]:
    out = []
    for obj in base_json:
        o = copy.deepcopy(obj)
        row = rows_by_id[o["id"]]
        o["modern_text"] = row["modern_text"]
        o["category"] = row["category"].split(";") if row["category"] else []
        clean = row["explanation"]
        for ann in o.get("annotations", []):
            if ann.get("explanation"):
                ann["explanation"] = clean
                break
        out.append(o)
    return out


def write_json(objs: list[dict], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(objs, f, ensure_ascii=False, indent=2)
        f.write("\n")
