from __future__ import annotations

import csv
import json
import os
import sys
from collections import Counter
from xml.sax.saxutils import escape

# Allow importing from repo root (core package) when run as a script from app/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core.references import render_citation, to_bibtex, to_csl


def _read_version(corpus_path):
    vpath = os.path.join(os.path.dirname(os.path.abspath(corpus_path)), "VERSION")
    try:
        with open(vpath, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None


def _load_taxonomy(path):
    with open(path, encoding="utf-8") as f:
        return {r["key"]: r["ukrainian_label"] for r in csv.DictReader(f)}


def _load_sources(path):
    with open(path, encoding="utf-8") as f:
        out = []
        for r in csv.DictReader(f):
            r = {k.lstrip("﻿"): v for k, v in r.items()}
            out.append({
                "key": r.get("Citationkey", ""),
                "title": r.get("Title", ""),
                "year": r.get("Year", ""),
                "author": r.get("Author", ""),
                "citation": render_citation(r),
                "isbn": (r.get("ISBN") or ""),
                "url": (r.get("URL") or ""),
            })
    return out


def build(corpus_path, taxonomy_path, sources_path, out_dir, xml_path):
    os.makedirs(out_dir, exist_ok=True)
    with open(corpus_path, encoding="utf-8") as f:
        rows = sorted(csv.DictReader(f), key=lambda r: r["id"])

    proverbs, explanations = [], {}
    per_cat = Counter()
    for r in rows:
        cats = [c for c in r["category"].split(";") if c]
        proverbs.append({
            "id": r["id"], "text": r["text"], "modern_text": r["modern_text"],
            "category": cats, "sources": [s for s in r["sources"].split(";") if s],
            "variant_group": r["variant_group"],
        })
        for c in cats:
            per_cat[c] += 1
        if r["explanation"].strip():
            explanations[r["id"]] = r["explanation"]

    with open(os.path.join(out_dir, "proverbs.json"), "w", encoding="utf-8") as f:
        json.dump(proverbs, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "explanations.json"), "w", encoding="utf-8") as f:
        json.dump(explanations, f, ensure_ascii=False, separators=(",", ":"))

    meta = {
        "version": _read_version(corpus_path),
        "count": len(proverbs),
        "with_explanation": len(explanations),
        "taxonomy": _load_taxonomy(taxonomy_path),
        "sources": _load_sources(sources_path),
        "per_category": dict(per_cat.most_common()),
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # Write reference files into the public/ dir (parent of out_dir)
    public_dir = os.path.dirname(os.path.abspath(out_dir))
    with open(sources_path, encoding="utf-8") as _sf:
        src_rows = [{k.lstrip("﻿"): v for k, v in r.items()} for r in csv.DictReader(_sf)]
    with open(os.path.join(public_dir, "references.bib"), "w", encoding="utf-8") as f:
        f.write(to_bibtex(src_rows))
    with open(os.path.join(public_dir, "references.csl.json"), "w", encoding="utf-8") as f:
        json.dump(to_csl(src_rows), f, ensure_ascii=False, indent=2)

    with open(xml_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<corpus>\n')
        for p in proverbs:
            f.write(f'  <proverb id="{p["id"]}">')
            f.write(f'<text>{escape(p["text"])}</text>')
            f.write(f'<modern_text>{escape(p["modern_text"])}</modern_text>')
            f.write(f'<category>{escape(";".join(p["category"]))}</category>')
            f.write(f'<sources>{escape(";".join(p["sources"]))}</sources>')
            f.write("</proverb>\n")
        f.write("</corpus>\n")
    return meta


if __name__ == "__main__":
    # CLI: build_data.py <corpus.csv> <taxonomy.csv> <sources.csv> <out_dir> <xml_path>
    print(build(*sys.argv[1:6]))
