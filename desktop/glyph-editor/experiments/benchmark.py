"""Fixed unseen-family holdout; target images are used only for scoring, never inference."""

import argparse
import base64
import html
import io
import json
from pathlib import Path

import numpy as np
from infer import Generator
from PIL import Image

from data import atomic_json, load_json, pixels

TARGETS = "ҐЄІЇЖЮЯґєіїжюя"


def preview(g):
    im = Image.fromarray((1 - pixels(g)) * 255).convert("RGB")
    im = im.resize(
        (max(1, g["width"]) * 5, max(1, g["height"]) * 5), Image.Resampling.NEAREST
    )
    b = io.BytesIO()
    im.save(b, format="PNG")
    return (
        '<img src="data:image/png;base64,'
        + base64.b64encode(b.getvalue()).decode()
        + '">'
    )


def run(corpus, data):
    generator = Generator(data)
    ds = generator.ds
    results = []
    cards = []
    for fi in ds.test:
        font = ds.fonts[fi]
        record = load_json(Path(corpus) / "public" / font["url"].lstrip("/"))
        by = {}
        for g in record["glyphs"]:
            for l in g["labels"]:
                if l["kind"] == "unicode" and len(l["value"]) == 1:
                    by.setdefault(l["value"], g)
        references = [by[c] for c in "Hxonkp" if c in by]
        for character in TARGETS:
            if character not in by:
                continue
            target = by[character]
            blank = {**target, "rows": ["00" * target["rowBytes"]] * target["height"]}
            request = {
                "snapshot": ds.meta["snapshot"],
                "font": font,
                "target": blank,
                "references": references,
                "character": character,
                "count": 8,
                "revision": 0,
                "targetSignature": "benchmark-hidden",
            }
            response = generator.candidates(request, evaluation=True)
            truth = pixels(target)
            metrics = []
            items = []
            for candidate in response["candidates"]:
                bits = pixels(candidate)
                intersection = int(np.logical_and(bits, truth).sum())
                union = int(np.logical_or(bits, truth).sum())
                edits = int(np.not_equal(bits, truth).sum())
                iou = intersection / union if union else 1
                metrics.append(
                    {"method": candidate["method"], "pixelEdits": edits, "iou": iou}
                )
                items.append(
                    "<figure>"
                    + preview(candidate)
                    + "<figcaption>"
                    + candidate["method"]
                    + " · "
                    + str(edits)
                    + " px edits</figcaption></figure>"
                )
            results.append(
                {
                    "fontId": font["id"],
                    "group": font["group"],
                    "character": character,
                    "width": target["width"],
                    "height": target["height"],
                    "seconds": response["seconds"],
                    "candidates": metrics,
                }
            )
            cards.append(
                "<section><h3>"
                + html.escape(font["id"] + " · " + character)
                + "</h3><div><figure>"
                + preview(target)
                + "<figcaption>Hidden ground truth</figcaption></figure>"
                + "".join(items)
                + "</div></section>"
            )
    summary = {}
    for method in ["retrieval", "cnn"]:
        scored = [
            min(
                (c["pixelEdits"] for c in r["candidates"] if c["method"] == method),
                default=None,
            )
            for r in results
        ]
        valid = [x for x in scored if x is not None]
        summary[method] = {
            "casesWithCandidates": len(valid),
            "meanBestPixelEdits": float(np.mean(valid)) if valid else None,
            "exactBest": sum(x == 0 for x in valid),
        }
    report = {
        "format": "para-style-benchmark",
        "schemaVersion": 1,
        "snapshot": ds.meta["snapshot"],
        "training": generator.training,
        "normalization": ds.meta["normalization"],
        "testPolicy": ds.meta["testPolicy"],
        "cases": results,
        "summary": summary,
        "humanAcceptability": "Not yet rated; pixel distance is not a legibility/style score",
        "topK": "Best-of-returned, up to 8 total interleaved CNN/retrieval candidates; deduplication may reduce counts. No test-based model/threshold tuning.",
    }
    atomic_json(ds.path / "benchmark.json", report)
    (ds.path / "benchmark.html").write_text(
        '<!doctype html><meta charset="utf-8"><title>Glyph style holdout</title><style>body{font:14px system-ui;background:#171d19;color:#eee9d7;padding:24px}section{border-top:1px solid #52604e}section>div{display:flex;gap:16px;overflow:auto}figure{margin:10px 0;flex:none}img{image-rendering:pixelated;background:white}figcaption{font-size:11px}pre{white-space:pre-wrap}</style><h1>Unseen-family glyph reconstruction</h1><p>Ground truth is hidden from the generator. CNN is experimental; human acceptance is not rated.</p><pre>'
        + html.escape(json.dumps(summary, indent=2))
        + "</pre>"
        + "".join(cards)
    )
    print(
        json.dumps(
            {
                "cases": len(results),
                "summary": summary,
                "report": str(ds.path / "benchmark.html"),
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--corpus", required=True)
    p.add_argument("--data", required=True)
    a = p.parse_args()
    run(a.corpus, a.data)
