"""Bounded interchange validation shared by CLI and the native job transport."""

import math
import re


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def metric(v):
    return type(v) in (float, int) and math.isfinite(v) and abs(v) <= 16384


def validate_glyph(glyph):
    w, h = glyph.get("width"), glyph.get("height")
    if (
        not integer(w, 1, 256)
        or not integer(h, 1, 256)
        or glyph.get("rowBytes") != (w + 7) // 8
    ):
        raise ValueError("Invalid glyph dimensions")
    rows = glyph.get("rows", [])
    if (
        not isinstance(rows, list)
        or len(rows) != h
        or not all(
            isinstance(r, str)
            and re.fullmatch("[0-9A-Fa-f]{" + str(((w + 7) // 8) * 2) + "}", r)
            for r in rows
        )
    ):
        raise ValueError("Invalid bitmap rows")
    mask = (1 << (8 - w % 8)) - 1 if w % 8 else 0
    if any(int(r[-2:], 16) & mask for r in rows):
        raise ValueError("Invalid bitmap padding")
    if not re.fullmatch("g[0-9]{6}", str(glyph.get("id", ""))):
        raise ValueError("Invalid glyph ID")
    metrics = glyph.get("metrics", {})
    if not all(metric(metrics.get(k)) for k in ["leftBearing", "shiftUp"]):
        raise ValueError("Invalid glyph metrics")
    labels = glyph.get("labels", [])
    if (
        not isinstance(labels, list)
        or len(labels) > 32
        or not all(
            isinstance(l, dict)
            and isinstance(l.get("value"), str)
            and len(l["value"]) <= 64
            for l in labels
        )
    ):
        raise ValueError("Invalid glyph labels")


def validate_request(request):
    if not isinstance(request, dict):
        raise TypeError("Expected a candidate request")
    for key in ["snapshot"]:
        if not re.fullmatch("[0-9a-f]{64}", str(request.get(key, ""))):
            raise ValueError("Invalid corpus snapshot")
    font = request.get("font", {})
    cell = font.get("cell", {})
    if not re.fullmatch(
        "[a-z0-9][a-z0-9._-]{0,159}", str(font.get("id", ""))
    ) or not re.fullmatch("[a-f0-9]{64}", str(font.get("sha256", ""))):
        raise ValueError("Invalid source font identity")
    if not all(integer(cell.get(k), 1, 256) for k in ["width", "height"]):
        raise ValueError("Prototype supports 1–256 px font cells")

    if not metric(font.get("metrics", {}).get("baseline")):
        raise ValueError("Invalid font baseline")
    reference_font = request.get("referenceFont", font)
    if not all(
        integer(reference_font.get("cell", {}).get(k), 1, 256)
        for k in ["width", "height"]
    ) or not metric(reference_font.get("metrics", {}).get("baseline")):
        raise ValueError("Invalid reference font metrics")
    refs = request.get("references", [])
    if not isinstance(refs, list) or not 1 <= len(refs) <= 64:
        raise ValueError("Need 1–64 reference glyphs")
    for glyph in [request.get("target", {})] + refs:
        validate_glyph(glyph)
    if not integer(request.get("revision"), 0, 2**53 - 1) or not integer(
        request.get("count", 8), 1, 8
    ):
        raise ValueError("Invalid revision or candidate count")
    if (
        not isinstance(request.get("targetSignature"), str)
        or len(request["targetSignature"]) > 65536
    ):
        raise ValueError("Invalid target signature")
    if not isinstance(request.get("character"), str) or len(request["character"]) != 1:
        raise ValueError("Invalid target character")
    return request
