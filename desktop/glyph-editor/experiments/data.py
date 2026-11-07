"""Local, source-pinned bitmap dataset. No web downloads or source writes."""

import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

CHARS = list(
    dict.fromkeys(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя"
    )
)
REFS = [("H", "Н"), ("x", "х"), ("o", "о"), ("n", "п"), ("k", "к"), ("p", "р")]
ALLOWED = {"MIT", "BSD-2-Clause", "OFL-1.1", "CC0-1.0", "CC-BY-SA-4.0"}
SIZE = 32


def load_json(path):
    return json.loads(Path(path).read_text())


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False))
    temporary.replace(path)


def pixels(g):
    w, h = g["width"], g["height"]
    return np.array(
        [
            [
                int(row[x // 8 * 2 : x // 8 * 2 + 2], 16) >> (7 - x % 8) & 1
                for x in range(w)
            ]
            for row in g["rows"]
        ],
        dtype=np.uint8,
    ).reshape(h, w)


def rows(bits):
    return [
        "".join(
            f"{sum(int(row[x + j]) << (7 - j) for j in range(min(8, len(row) - x))):02X}"
            for x in range(0, len(row), 8)
        )
        for row in bits
    ]


def normalize(g, font):
    w, h = font["cell"]["width"], font["cell"]["height"]
    canvas = Image.new("L", (w, h))
    bitmap = Image.fromarray(pixels(g) * 255)
    canvas.paste(
        bitmap,
        (
            round(g["metrics"]["leftBearing"]),
            round(font["metrics"]["baseline"] - g["height"] - g["metrics"]["shiftUp"]),
        ),
    )
    return (
        np.asarray(canvas.resize((SIZE, SIZE), Image.Resampling.NEAREST)) > 0
    ).astype(np.uint8)


def denormalize(grid, target, font):
    # Sample the canonical cell at destination pixel centers; keep all metrics/mapping.
    w, h = font["cell"]["width"], font["cell"]["height"]
    top = font["metrics"]["baseline"] - target["height"] - target["metrics"]["shiftUp"]
    out = np.zeros((target["height"], target["width"]), np.uint8)
    for y in range(target["height"]):
        for x in range(target["width"]):
            cx = x + target["metrics"]["leftBearing"] + 0.5
            cy = y + top + 0.5
            if 0 <= cx < w and 0 <= cy < h:
                out[y, x] = grid[
                    min(SIZE - 1, int(cy / h * SIZE)), min(SIZE - 1, int(cx / w * SIZE))
                ]
    return out


def structurally_usable(bits, structure):
    retained = np.logical_and(bits, structure).sum() / max(1, structure.sum())
    return bool(retained >= 0.6 and bits.sum() <= max(2, structure.sum() * 1.8))


def family_key(font):
    # Variants and sizes of a family stay together. Exact cross-family duplicates are unioned below.
    return re.sub(
        r"[^a-zа-яіїєґ0-9]+",
        "-",
        re.sub(
            r"(?i)(?:-?\d+[xy]|bold|italic|regular|\d+\s*[x×]\s*\d+)",
            "",
            font["family"],
        ).lower(),
    ).strip("-")


def prepare(corpus, output):
    corpus = Path(corpus)
    output = Path(output)
    catalog = load_json(corpus / "font-corpus/catalog.json")
    fonts = []
    data = []
    parents = []
    signatures = {}
    families = {}

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    def union(a, b):
        parents[root(a)] = root(b)

    for summary in catalog["fonts"]:
        if not (
            summary["licenseStatus"] == "verified"
            and summary["licenseId"] in ALLOWED
            and 0 < summary["cell"]["width"] <= 32
            and 0 < summary["cell"]["height"] <= 32
        ):
            continue
        path = corpus / "public" / summary["url"].lstrip("/")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != summary["sha256"]:
            raise ValueError("Source hash mismatch: " + summary["id"])
        record = json.loads(raw)
        by = {}
        for g in record["glyphs"]:
            for label in g["labels"]:
                if (
                    label["kind"] == "unicode"
                    and label["value"] in CHARS
                    and label["value"] not in by
                ):
                    by[label["value"]] = g
        images = np.zeros((len(CHARS), SIZE, SIZE), np.uint8)
        for ci, c in enumerate(CHARS):
            if c in by:
                images[ci] = normalize(by[c], summary)
        if sum(bool(x.any()) for x in images[:52]) < 24:
            continue
        i = len(fonts)
        parents.append(i)
        family = family_key(summary)
        if family in families:
            union(i, families[family])
        families[family] = i
        signature = hashlib.sha256(images[:52].tobytes()).hexdigest()
        if signature in signatures:
            union(i, signatures[signature])
        signatures[signature] = i
        fonts.append(
            {
                **{
                    k: summary[k]
                    for k in [
                        "id",
                        "family",
                        "sha256",
                        "cell",
                        "metrics",
                        "url",
                        "licenseId",
                    ]
                },
                "license": record["license"],
                "source": record["source"],
                "familyKey": family,
                "glyphIds": {c: g["id"] for c, g in by.items()},
            }
        )
        data.append(images)
    groups = {}
    for i, f in enumerate(fonts):
        groups.setdefault(root(i), []).append(f["familyKey"])
    for i, f in enumerate(fonts):
        f["group"] = min(groups[root(i)])
    # Explicit held-out Ukrainian families. No checkpoint selection on these test fonts.
    test_groups = {f["group"] for f in fonts if f["familyKey"] in {"cozette", "spleen"}}
    for f in fonts:
        f["split"] = "test" if f["group"] in test_groups else "train"
    output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(output / "dataset.npz", images=np.stack(data))
    atomic_json(
        output / "manifest.json",
        {
            "schemaVersion": 1,
            "snapshot": catalog["snapshot"],
            "chars": CHARS,
            "references": REFS,
            "fonts": fonts,
            "normalization": "32x32 nearest cell, font baseline + glyph bearings; output resampled at native pixel centers",
            "testPolicy": "Cozette/Spleen families + exact normalized Latin duplicates held out; no test-based checkpoint selection",
        },
    )
    print(
        json.dumps(
            {
                "fonts": len(fonts),
                "train": sum(f["split"] == "train" for f in fonts),
                "test": sum(f["split"] == "test" for f in fonts),
                "groups": len({f["group"] for f in fonts}),
            }
        ),
        flush=True,
    )


class Dataset:
    def __init__(self, path):
        self.path = Path(path)
        self.meta = load_json(self.path / "manifest.json")
        self.images = np.load(self.path / "dataset.npz")["images"]
        self.fonts = self.meta["fonts"]
        self.chars = self.meta["chars"]
        self.char_index = {c: i for i, c in enumerate(self.chars)}
        self.present = self.images.any(axis=(2, 3))
        self.train = [i for i, f in enumerate(self.fonts) if f["split"] == "train"]
        self.test = [i for i, f in enumerate(self.fonts) if f["split"] == "test"]

    def references(self, fi, excluded):
        refs = np.zeros((12, SIZE, SIZE), np.float32)
        for k, choices in enumerate(REFS):
            for c in choices:
                ci = self.char_index[c]
                if c != excluded and self.present[fi, ci]:
                    refs[k] = self.images[fi, ci]
                    refs[k + 6] = 1
                    break
        return refs

    def rank_custom(self, references, character, exclude_group=None):
        ci = self.char_index.get(character) if character is not None else None
        if character is not None and ci is None:
            return []
        usable = {
            self.char_index[c]: image
            for c, image in references.items()
            if c in self.char_index and image.any()
        }
        if not usable:
            raise ValueError("No mapped reference characters overlap the donor corpus")
        ranked = []
        for i, font in enumerate(self.fonts):
            if font["group"] == exclude_group or (
                ci is not None and not self.present[i, ci]
            ):
                continue
            distances = [
                float(np.mean((image.astype(np.float32) - self.images[i, j]) ** 2))
                for j, image in usable.items()
                if self.present[i, j]
            ]
            if not distances:
                continue
            score = float(np.mean(distances)) + 0.1 * (1 - len(distances) / len(usable))
            ranked.append((score, i))
        return sorted(ranked)

    def rank(self, refs, character, exclude_group=None, pool=None):
        ci = self.char_index.get(character)
        if ci is None:
            return []
        ranked = []
        for i in self.train if pool is None else pool:
            if not self.present[i, ci] or self.fonts[i]["group"] == exclude_group:
                continue
            other = self.references(i, character)
            valid = (refs[6:, 0, 0] * other[6:, 0, 0]) > 0
            if valid.sum() < 2:
                continue
            score = float(np.mean((refs[:6][valid] - other[:6][valid]) ** 2))
            ranked.append((score, i))
        return sorted(ranked)


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--corpus", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    prepare(a.corpus, a.output)
