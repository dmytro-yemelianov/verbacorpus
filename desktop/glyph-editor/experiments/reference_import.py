"""Local reference font import; explicit Unicode maps, bounded 1-bit rasters."""

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from request import validate_glyph

from data import atomic_json, load_json, rows


def glyph(char, ordinal, width, height, advance, left, shift, bitmap):
    return {
        "id": f"g{ordinal:06d}",
        "character": char,
        "codepoint": f"U+{ord(char):04X}",
        "labels": [{"kind": "unicode", "value": char}],
        "width": width,
        "height": height,
        "rowBytes": (width + 7) // 8,
        "advanceX": advance,
        "metrics": {
            "leftBearing": left,
            "rightBearing": advance - left - width,
            "shiftUp": shift,
        },
        "rows": bitmap,
        "sourceCode": None,
    }


def bdf(data, characters):
    text = data.decode("utf-8")
    lines = text.splitlines()
    registry = next((l for l in lines if l.startswith("CHARSET_REGISTRY ")), "")
    if "ISO10646" not in registry.upper():
        raise ValueError(
            "BDF requires explicit ISO10646 Unicode encoding; use Para JSON for other encodings"
        )
    box = next(l for l in lines if l.startswith("FONTBOUNDINGBOX ")).split()
    w, h, _, y = map(int, box[1:])
    baseline = h + y
    result = []
    current = None
    bitmap = False
    raw = []
    for line in lines:
        fields = line.split()
        if not fields:
            continue
        if fields[0] == "STARTCHAR":
            current = {}
            raw = []
            bitmap = False
        elif current is not None:
            if fields[0] == "ENDCHAR":
                cp = current.get("encoding", -1)
                if (
                    0 <= cp <= 0x10FFFF
                    and chr(cp) in characters
                    and all(k in current for k in ["box", "advance"])
                ):
                    gw, gh, gx, gy = current["box"]
                    result.append(
                        glyph(
                            chr(cp),
                            len(result),
                            gw,
                            gh,
                            current["advance"],
                            gx,
                            gy,
                            raw,
                        )
                    )
                current = None
                bitmap = False
            elif fields[0] == "ENCODING":
                current["encoding"] = int(fields[1])
            elif fields[0] == "DWIDTH":
                current["advance"] = int(fields[1])
            elif fields[0] == "BBX":
                current["box"] = list(map(int, fields[1:5]))
            elif fields[0] == "BITMAP":
                bitmap = True
            elif bitmap:
                raw.append(line.strip().upper())
    return (
        {"width": w, "height": h},
        {"baseline": baseline, "advanceX": w},
        result,
        {"id": "NOASSERTION", "name": "Imported BDF; source license not inferred"},
    )


def truetype(data, characters, size):
    from fontTools.ttLib import TTFont

    tt = TTFont(io.BytesIO(data), lazy=True)
    cmap = tt.getBestCmap() or {}
    face = ImageFont.truetype(io.BytesIO(data), size=size)
    ascent, descent = face.getmetrics()
    result = []
    for char in characters:
        if ord(char) not in cmap:
            continue
        left, top, right, bottom = face.getbbox(char, anchor="ls")
        w = right - left
        h = bottom - top
        if w <= 0 or h <= 0:
            continue
        if w > 32 or h > 32:
            raise ValueError("Reference glyph exceeds 32 px; reduce raster size")
        image = Image.new("1", (w, h))
        ImageDraw.Draw(image).text((-left, -top), char, font=face, fill=1, anchor="ls")
        result.append(
            glyph(
                char,
                len(result),
                w,
                h,
                round(face.getlength(char)),
                left,
                -bottom,
                rows(np.asarray(image, dtype=np.uint8)),
            )
        )
    width = max([round(face.getlength(c)) for c in characters if ord(c) in cmap] + [1])
    height = ascent + descent
    tt.close()
    return (
        {"width": width, "height": height},
        {"baseline": ascent, "advanceX": width},
        result,
        {
            "id": "NOASSERTION",
            "name": "Imported outline font; source license not inferred",
        },
    )


def json_font(data, characters):
    record = json.loads(data)
    if isinstance(record, list):
        record = {"glyphs": record}
    if record.get("format") == "para-glyph-region":
        origin = record.get("origin", {})
        char = origin.get("char") or (characters[0] if len(characters) == 1 else None)
        if not char:
            raise ValueError("For an unlabeled region, specify one reference character")
        w, h = record.get("width"), record.get("height")
        raw = record.get("rows", [])
        mask = record.get("maskRows")
        if mask:
            raw = [
                f"{int(a, 16) & int(b, 16):0{((w + 7) // 8) * 2}X}"
                for a, b in zip(raw, mask)
            ]
        g = glyph(
            char,
            0,
            w,
            h,
            origin.get("advanceX", w),
            0,
            origin.get("baseline", h) - h,
            raw,
        )
        record = {
            "glyphs": [g],
            "cell": {"width": w, "height": h},
            "metrics": {"baseline": origin.get("baseline", h), "advanceX": w},
        }
    if "glyphs" not in record:
        record = {"glyphs": [record]}
    result = []
    for raw in record["glyphs"]:
        labels = raw.get("labels") or (
            [{"kind": "unicode", "value": raw["character"]}]
            if raw.get("character")
            else []
        )
        mapped = [
            l["value"]
            for l in labels
            if l.get("kind") == "unicode" and l.get("value") in characters
        ]
        if not mapped:
            continue
        g = {**raw, "labels": labels, "id": raw.get("id", f"g{len(result):06d}")}
        validate_glyph(g)
        result.append(g)
    cell = record.get("cell") or {
        "width": max([g["width"] for g in result] + [1]),
        "height": max([g["height"] for g in result] + [1]),
    }
    metrics = record.get("metrics") or {
        "baseline": max(
            [g["height"] + g["metrics"]["shiftUp"] for g in result] + [cell["height"]]
        ),
        "advanceX": cell["width"],
    }
    return (
        cell,
        metrics,
        result,
        record.get("license", {"id": "NOASSERTION", "name": "User-provided reference"}),
    )


def import_reference(request):
    data = base64.b64decode(request["data"], validate=True)
    if not data or len(data) > 8 * 1024 * 1024:
        raise ValueError("Reference file must be at most 8 MiB")
    characters = list(
        dict.fromkeys(c for c in request.get("characters", "Hxonkp") if not c.isspace())
    )
    if not 1 <= len(characters) <= 64:
        raise ValueError("Choose 1–64 reference characters")
    extension = Path(request["name"]).suffix.lower()
    if extension == ".json":
        cell, metrics, glyphs, license = json_font(data, characters)
    elif extension == ".bdf":
        cell, metrics, glyphs, license = bdf(data, characters)
    elif extension in [".ttf", ".otf"]:
        size = request.get("size", 16)
        if type(size) is not int or not 6 <= size <= 24:
            raise ValueError("Outline raster size: 6–24 px")
        cell, metrics, glyphs, license = truetype(data, characters, size)
    else:
        raise ValueError(
            "Supported reference files: Para/glyph JSON, Unicode BDF, TTF, OTF"
        )
    if not glyphs:
        raise ValueError("No requested Unicode glyphs in this reference")
    if not all(
        type(cell.get(k)) is int and 1 <= cell[k] <= 32 for k in ["width", "height"]
    ):
        raise ValueError("Reference cell must be 1–32 px; reduce outline size")
    for g in glyphs:
        validate_glyph(g)
    digest = hashlib.sha256(data).hexdigest()
    return {
        "font": {
            "id": "reference-" + digest[:16],
            "sha256": digest,
            "name": Path(request["name"]).name,
            "cell": cell,
            "metrics": metrics,
            "licenseId": license.get("id", "NOASSERTION"),
            "license": license,
            "source": {"fileSha256": digest, "fileName": Path(request["name"]).name},
        },
        "glyphs": glyphs,
        "missing": [
            c
            for c in characters
            if not any(
                any(l["kind"] == "unicode" and l["value"] == c for l in g["labels"])
                for g in glyphs
            )
        ],
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--request", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    atomic_json(a.output, import_reference(load_json(a.request)))
