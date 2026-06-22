from __future__ import annotations

import csv
import json
import os


def make_batches(corpus_path: str, out_dir: str, fields: list[str], size: int) -> list[str]:
    if size < 1:
        raise ValueError("size must be >= 1")
    cols = list(fields)
    if "id" not in cols:
        cols = ["id"] + cols
    os.makedirs(out_dir, exist_ok=True)
    with open(corpus_path, encoding="utf-8") as f:
        rows = [{c: r[c] for c in cols} for r in csv.DictReader(f)]
    paths: list[str] = []
    for i in range(0, len(rows), size):
        chunk = rows[i:i + size]
        p = os.path.join(out_dir, f"batch_{i // size:04d}.json")
        with open(p, "w", encoding="utf-8") as out:
            json.dump(chunk, out, ensure_ascii=False)
        paths.append(p)
    return paths
