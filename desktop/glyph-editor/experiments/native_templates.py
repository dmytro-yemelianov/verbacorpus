"""Curated native-pixel Cyrillic recipes. No neural raster or antialiasing.

Transform the ink bounds, preserving the source's padding/baseline. Every
proposal remains editable and records its source glyphs and operation.
"""

import copy

import numpy as np

from data import pixels, rows

TRANSFORMS = {
    "И": [("N", "mirror-x")],
    "Я": [("R", "mirror-x")],
    "Г": [("L", "mirror-y")],
    "Л": [("V", "mirror-y"), ("V", "rotate-180")],
    "П": [("U", "mirror-y")],
    "Ь": [("P", "mirror-y")],
    "л": [("v", "mirror-y")],
    "п": [("u", "mirror-y")],
    "ь": [("p", "mirror-y")],
    "ч": [("h", "rotate-180")],
}


def bounds(bits):
    points = np.argwhere(bits)
    if not len(points):
        return None
    y0, x0 = points.min(axis=0)
    y1, x1 = points.max(axis=0) + 1
    return int(y0), int(y1), int(x0), int(x1)


def transform_glyph(glyph, operation):
    bitmap = pixels(glyph)
    box = bounds(bitmap)
    if box is None:
        return None
    y0, y1, x0, x1 = box
    ink = bitmap[y0:y1, x0:x1]
    transformed = {
        "mirror-x": lambda: np.fliplr(ink),
        "mirror-y": lambda: np.flipud(ink),
        "rotate-180": lambda: np.rot90(ink, 2),
    }[operation]()
    bitmap[y0:y1, x0:x1] = transformed
    result = copy.deepcopy(glyph)
    result["rows"] = rows(bitmap)
    return result


def fit_row(row, width):
    if not len(row) or width < 1:
        return np.zeros(max(0, width), np.uint8)
    positions = np.rint(np.linspace(0, len(row) - 1, width)).astype(int)
    result = row[positions].copy()
    if not result.any():
        for x in np.flatnonzero(row):
            result[round(x * (width - 1) / max(1, len(row) - 1))] = 1
    return result


def stem(bits, box):
    y0, y1, x0, x1 = box
    counts = bits[y0:y1].sum(axis=0)
    middle = (x0 + x1 - 1) // 2
    left = x0 + int(counts[x0 : middle + 1].argmax())
    right = left + 1
    while right <= middle and counts[right] == counts[left]:
        right += 1
    return left, right


def compositions(character, provided, align):
    """Yield (bitmap, source characters, operation) in native target space."""
    if character in "Жж":
        key = "K" if character == "Ж" else "k"
        if key not in provided:
            return
        bits = align(provided[key])
        box = bounds(bits)
        if box is None:
            return
        y0, y1, _, x1 = box
        left, right = stem(bits, box)
        side = (bits.shape[1] - (right - left)) // 2
        if side < 1 or x1 <= right:
            return
        # Lowercase k's ascender is not part of ж's body.
        branch_box = bounds(bits[:, right:x1])
        if branch_box is None:
            return
        y0, y1 = branch_box[:2]
        out = np.zeros_like(bits)
        start = (bits.shape[1] - (side * 2 + right - left)) // 2
        for y in range(y0, y1):
            wing = fit_row(bits[y, right:x1], side)
            out[y, start : start + side] = wing[::-1]
            out[y, start + side : start + side + right - left] = bits[y, left:right]
            out[y, start + side + right - left : start + side * 2 + right - left] = wing
        yield out, [key], "compose-k-mirror"
    elif character in "Юю":
        key, ring = ("H", "O") if character == "Ю" else ("h", "o")
        if key not in provided or ring not in provided:
            return
        bits, circle = align(provided[key]), align(provided[ring])
        box, oval = bounds(bits), bounds(circle)
        if box is None or oval is None:
            return
        _, _, x0, x1 = box
        oy0, oy1, ox0, ox1 = oval
        left, right = stem(bits, box)
        sw = right - left
        gap = max(1, sw // 2)
        available = bits.shape[1] - x0 - sw - gap
        if available < 3:
            return
        out = np.zeros_like(bits)
        connector = (right + x1 - 1) // 2
        for y in range(oy0, oy1):
            out[y, x0 : x0 + sw] = bits[y, left:right]
            out[y, x0 + sw : x0 + sw + gap] = bits[y, connector]
            out[y, x0 + sw + gap : x0 + sw + gap + available] = fit_row(
                circle[y, ox0:ox1], available
            )
        yield out, [key, ring], "compose-stem-oval"
    elif character in "Єє":
        key, bar = ("C", "E") if character == "Є" else ("c", "e")
        if key not in provided or bar not in provided:
            return
        bits, bars = align(provided[key]), align(provided[bar])
        box = bounds(bits)
        if box is None:
            return
        y0, y1, x0, x1 = box
        middle = (y0 + y1 - 1) / 2
        candidates = range(y0 + (y1 - y0) // 3, max(y0 + 1, y1 - (y1 - y0) // 3))
        y = max(candidates, key=lambda y: (int(bars[y].sum()), -abs(y - middle)))
        if bars[y].sum() < 2:
            return
        out = bits.copy()
        out[y, x0 : max(x0 + 1, x1 - 1)] |= bars[y, x0 : max(x0 + 1, x1 - 1)]
        yield out, [key, bar], "compose-open-bowl-bar"


def templates(character, provided, align):
    for key, operation in TRANSFORMS.get(character, []):
        if key in provided:
            glyph = transform_glyph(provided[key], operation)
            if glyph:
                yield align(glyph), [key], operation
    yield from compositions(character, provided, align)
