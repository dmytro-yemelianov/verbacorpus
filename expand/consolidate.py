from __future__ import annotations

import csv
import glob
import os


def consolidate(pages_dir: str) -> list[dict]:
    rows: list[dict] = []
    for path in sorted(glob.glob(os.path.join(pages_dir, "*.csv"))):
        ref = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as f:
            for rec in csv.DictReader(f):
                text = (rec.get("text") or "").strip()
                if text:
                    rows.append({"ref": ref, "text": text})
    return rows
