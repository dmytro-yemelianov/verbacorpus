"""Repeatable native-recipe timing and nearest-pixel proof, without editing fonts."""

import argparse
import copy
import hashlib
import json
import statistics
import time
from pathlib import Path

from infer import Generator
from PIL import Image, ImageDraw
from recipe_engine.model import UK_ALPHABET

from data import pixels

REFERENCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz36ÏïĂăĞğÖöÄä"


def benchmark(corpus, output, ids):
    catalog = json.loads((corpus / "font-corpus/catalog.json").read_text())
    engine = Generator(native_only=True)
    report, panels = [], []
    for font_id in ids:
        font = next(f for f in catalog["fonts"] if f["id"] == font_id)
        path = corpus / "public" / font["url"].lstrip("/")
        content = path.read_bytes()
        record = json.loads(content)
        by = {
            label["value"]: g
            for g in record["glyphs"]
            for label in g["labels"]
            if label["kind"] == "unicode"
            and len(label["value"]) == 1
            and any(int(r, 16) for r in g["rows"])
        }
        refs = list({by[c]["id"]: by[c] for c in REFERENCE_CHARS if c in by}.values())[
            :64
        ]
        width, height = font["cell"]["width"], font["cell"]["height"]
        target = {
            "id": "g999999",
            "width": width,
            "height": height,
            "rowBytes": (width + 7) // 8,
            "rows": ["00" * ((width + 7) // 8)] * height,
            "metrics": dict(by["H"]["metrics"]),
            "labels": [],
        }
        results, durations = [], []
        base = {
            "snapshot": catalog["snapshot"],
            "font": font,
            "referenceFont": font,
            "references": refs,
            "target": target,
            "targetSignature": "proof",
            "revision": 0,
            "count": 8,
            "mode": "native",
            "preferLatin": True,
            "recipeMode": "strict",
        }
        original = copy.deepcopy(base)
        started = time.perf_counter()
        for char in UK_ALPHABET:
            result = engine.candidates({**base, "character": char})
            durations.append(result["seconds"])
            results.append(result)
        total = time.perf_counter() - started
        assert original == base and path.read_bytes() == content
        available = sum(bool(r["candidates"]) for r in results)
        report.append(
            {
                "fontId": font_id,
                "cell": [width, height],
                "available": available,
                "unresolved": [
                    {"character": r["character"], **r.get("recipeStatus", {})}
                    for r in results
                    if not r["candidates"]
                ],
                "seconds": total,
                "firstMs": durations[0] * 1000,
                "warmMedianMs": statistics.median(durations[1:]) * 1000,
                "warmP95Ms": sorted(durations[1:])[int(len(durations[1:]) * 0.95)]
                * 1000,
                "sourceSha256": hashlib.sha256(content).hexdigest(),
            }
        )
        # Proof includes actual Latin sources followed by every generated glyph.
        sequence = [(c, by.get(c)) for c in "HNAOBRLIiknopx"]
        sequence += [
            (r["character"], r["candidates"][0] if r["candidates"] else None)
            for r in results
        ]
        columns, cw, ch = 20, max(42, width * 3 + 6), height * 3 + 23
        panel = Image.new(
            "RGB",
            (columns * cw, ((len(sequence) + columns - 1) // columns) * ch + 25),
            "#171d19",
        )
        draw = ImageDraw.Draw(panel)
        draw.text(
            (5, 5),
            f"{font_id} {width}x{height}: {available}/66 (strict)",
            fill="#d4b76e",
        )
        for i, (char, g) in enumerate(sequence):
            x, y = i % columns * cw, i // columns * ch + 25
            # Portable ASCII codepoint labels; native bitmaps remain untouched.
            draw.text((x + 2, y + height * 3 + 4), f"{ord(char):04X}", fill="#a3ae97")
            if g:
                for py, row in enumerate(pixels(g)):
                    for px, value in enumerate(row):
                        if value:
                            draw.rectangle(
                                (
                                    x + px * 3 + 2,
                                    y + py * 3,
                                    x + px * 3 + 4,
                                    y + py * 3 + 2,
                                ),
                                fill="#eee9d7",
                            )
            else:
                draw.rectangle(
                    (x + 2, y, x + width * 3, y + height * 3), outline="#c66f6f"
                )
        panels.append(panel)
    output.mkdir(parents=True, exist_ok=True)
    proof = Image.new(
        "RGB", (max(p.width for p in panels), sum(p.height for p in panels)), "#171d19"
    )
    y = 0
    for panel in panels:
        proof.paste(panel, (0, y))
        y += panel.height
    proof.save(output / "native-recipes.png")
    (output / "native-recipes.json").write_text(
        json.dumps(
            {
                "policy": "strict",
                "cacheBuilds": engine.recipes.builds,
                "sourceFilesUnchanged": True,
                "fonts": report,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--corpus", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument(
        "--fonts",
        nargs="+",
        default=["acer-vga-8x8", "acm-vga-8x14", "acer-vga-8x8-2y", "cozette-13x15"],
    )
    a = p.parse_args()
    benchmark(a.corpus, a.output, a.fonts)
