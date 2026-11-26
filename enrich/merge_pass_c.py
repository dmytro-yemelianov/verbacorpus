#!/usr/bin/env python3
"""Merge validated Pass C hooks into the corpus source and public app data."""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import Any

from enrich.pass_c import fallback_hook, validate_hook


ROOT = Path(__file__).resolve().parents[1]
PASS_C = ROOT / "enrich" / "pass_c"


def read_batch(path: Path) -> list[dict[str, str]]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        proverb_id, separator, text = line.partition("\t")
        if not separator or not proverb_id or not text:
            raise ValueError(f"Malformed row {line_number} in {path}")
        rows.append({"id": proverb_id, "text": text})
    return rows


def load_pass_c() -> dict[str, dict[str, str]]:
    output: dict[str, dict[str, str]] = {}
    done_files = sorted((PASS_C / "done").glob("batch_*.json"))
    if len(done_files) != 488:
        raise ValueError(f"Expected 488 enrichment batches; found {len(done_files)}")

    for done_path in done_files:
        batch_id = int(done_path.stem.split("_")[-1])
        records = read_batch(PASS_C / "batches" / f"batch_{batch_id:04d}.txt")
        done = json.loads(done_path.read_text(encoding="utf-8"))
        raw_hooks = done.get("hooks", {})
        repair_path = PASS_C / "repaired" / f"batch_{batch_id:04d}.json"
        repair = json.loads(repair_path.read_text(encoding="utf-8")) if repair_path.exists() else {}
        repaired_hooks = repair.get("hooks", {})
        repaired_sources = repair.get("hook_source", {})

        for row in records:
            proverb_id, text = row["id"], row["text"]
            if proverb_id in output:
                raise ValueError(f"Duplicate Pass C ID {proverb_id}")
            hook = raw_hooks.get(proverb_id) if isinstance(raw_hooks, dict) else None
            reason = validate_hook(text, hook)
            source = "model"
            if reason is not None:
                if proverb_id not in repaired_hooks:
                    raise ValueError(f"No repaired hook for {proverb_id}; original validation: {reason}")
                hook = repaired_hooks[proverb_id]
                source = repaired_sources.get(proverb_id, "rule")
                # Earlier repair output used "none" for the explicitly allowed
                # empty result when the proverb has no valid non-stopword span.
                if hook == "" and source == "none" and fallback_hook(text) == "":
                    source = "rule"
                if hook == "" and source == "rule" and fallback_hook(text) == "":
                    pass
                elif validate_hook(text, hook) is not None:
                    raise ValueError(f"Invalid repaired hook for {proverb_id}: {validate_hook(text, hook)}")
                if source not in ("model", "rule"):
                    raise ValueError(f"Invalid hook_source {source!r} for {proverb_id}")

            output[proverb_id] = {"hook": hook, "hook_source": source}

    return output


def write_json_atomic(path: Path, data: Any) -> None:
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temp.open("w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def write_csv_atomic(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = list(rows[0]) + ["hook", "hook_source"]
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temp.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def attach(rows: list[dict[str, Any]], hooks: dict[str, dict[str, str]], path: Path) -> list[dict[str, Any]]:
    row_ids = {row["id"] for row in rows}
    if row_ids != set(hooks):
        raise ValueError(f"ID coverage mismatch for {path}: rows={len(row_ids)}, hooks={len(hooks)}")
    enriched = []
    for row in rows:
        enriched.append({**row, **hooks[row["id"]]})
    return enriched


def main() -> int:
    hooks = load_pass_c()

    csv_path = ROOT / "corpus.csv"
    with csv_path.open(encoding="utf-8", newline="") as stream:
        corpus_csv = list(csv.DictReader(stream))
    if corpus_csv and {"hook", "hook_source"} & set(corpus_csv[0]):
        corpus_csv = [{k: v for k, v in row.items() if k not in ("hook", "hook_source")} for row in corpus_csv]
    enriched_csv = attach(corpus_csv, hooks, csv_path)
    write_csv_atomic(csv_path, enriched_csv)

    for relative in ("corpus.json", "app/public/data/proverbs.json"):
        path = ROOT / relative
        rows = json.loads(path.read_text(encoding="utf-8"))
        enriched_rows = attach(rows, hooks, path)
        write_json_atomic(path, enriched_rows)

    print(f"merged hooks for {len(hooks)} proverbs into corpus.csv, corpus.json, and app/public/data/proverbs.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
