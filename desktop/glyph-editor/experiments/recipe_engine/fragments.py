"""Typed source-fragment alternatives; no expression evaluator or resampling.

Repeated scanlines are the only elastic material. Unique corners, bars and
stroke runs survive compression, otherwise the recipe remains unavailable.
"""

from .bitmap import Bitmap
from .synthesis import ConstructionError, _counter_count, _local_flip, _touches


def repeat_fit(bitmap, width, height, protect_x=1, protect_y=1):
    box = bitmap.bbox()
    if box is None:
        raise ConstructionError("Cannot fit a blank fragment")
    left, top, right, bottom = box
    matrix = bitmap.crop(left, top, right - left, bottom - top).to_matrix()

    def shrink(lines, target, protect):
        if target > len(lines) or target < 2 * protect + 1:
            raise ConstructionError(
                "Fragment cannot fit without changing protected strokes"
            )
        while len(lines) > target:
            options = [
                i
                for i in range(protect, len(lines) - protect)
                if lines[i] == lines[i - 1] or lines[i] == lines[i + 1]
            ]
            if not options:
                raise ConstructionError(
                    "No repeated scanlines remain; no lossy fallback applied"
                )
            centre = (len(lines) - 1) / 2
            lines.pop(min(options, key=lambda i: (abs(i - centre), i)))
        return lines

    matrix = shrink(matrix, height, protect_y)
    columns = shrink(list(map(list, zip(*matrix))), width, protect_x)
    return Bitmap.from_matrix(list(map(list, zip(*columns))))


def alternatives(char, font, style, generated=None):
    """Yield bitmap, direct donors, recipe ID and explicit adaptations."""
    m = style.metrics
    accented = {"Ї": "Ï", "ї": "ï"}.get(char)
    if accented in font.glyphs:
        yield font.glyphs[accented], [accented], "native-latin-diaeresis", []
    if char in ("Й", "й") and generated:
        base_char = "И" if char == "Й" else "и"
        base = generated.glyphs.get(base_char)
        cutoff = m.cap_top if char == "Й" else m.x_top
        for donor in "ĂĞŬ" if char == "Й" else "ăğŭ":
            source = font.glyphs.get(donor)
            if not source or not base:
                continue
            mark = Bitmap(
                font.width,
                font.height,
                tuple(row if y < cutoff else 0 for y, row in enumerate(source.rows)),
            )
            if mark.bbox() and not _touches(mark, base):
                yield (
                    base.union(mark),
                    [base_char, donor],
                    "native-latin-breve",
                    [
                        "Separated breve copied from an explicitly mapped Latin accented donor."
                    ],
                )
                break
    if char in ("Ю", "ю"):
        stem_char, oval_char = ("H", "O") if char == "Ю" else ("n", "o")
        stem, oval = font.glyphs.get(stem_char), font.glyphs.get(oval_char)
        if stem and oval and stem.bbox() and oval.bbox():
            sl, st, _sr, sb = stem.bbox()
            ol, ot, ore, ob = oval.bbox()
            desired = min(ore - ol, font.width - sl - style.vertical_stroke - 1)
            try:
                fitted = repeat_fit(
                    oval,
                    desired,
                    ob - ot,
                    style.vertical_stroke,
                    style.horizontal_stroke,
                )
                left = sl + style.vertical_stroke + 1
                bowl = fitted.place(font.width, font.height, left, ot)
                matrix = bowl.to_matrix()
                for y in range(st, sb):
                    for x in range(sl, sl + style.vertical_stroke):
                        matrix[y][x] |= stem.get(x, y)
                waist = style.cap_waist if char == "Ю" else style.lower_waist
                for y in range(waist, min(sb, waist + style.horizontal_stroke)):
                    for x in range(
                        sl + style.vertical_stroke, left + style.vertical_stroke
                    ):
                        matrix[y][x] = 1
                result = Bitmap.from_matrix(matrix)
                if _counter_count(result) == 1:
                    yield (
                        result,
                        [stem_char, oval_char],
                        "source-stem-and-oval-reflow",
                        [
                            "Only duplicate oval columns removed; source corner rows and stroke widths retained."
                        ],
                    )
            except ConstructionError:
                pass
    # Gemini's W/m probe: retain three actual source stem positions, including
    # a narrower middle stem when that is already part of the donor's design.
    if char in ("Ш", "ш", "Щ", "щ"):
        donor = "W" if char.isupper() else "m"
        source = font.glyphs.get(donor)
        if source and source.bbox():
            top = m.cap_top if char.isupper() else m.x_top
            candidates = []
            for row in source.rows:
                runs = []
                for x in range(font.width):
                    if row & (1 << (font.width - 1 - x)) and (
                        x == 0 or not row & (1 << (font.width - x))
                    ):
                        runs.append(x)
                if len(runs) == 3:
                    candidates.append(row)
            if candidates:
                from collections import Counter

                counts = Counter(candidates)
                pattern = min(counts, key=lambda row: (-counts[row], row))
                left = font.width - pattern.bit_length()
                right = font.width - (pattern & -pattern).bit_length() + 1
                bar = ((1 << (right - left)) - 1) << (font.width - right)
                result_rows = [
                    pattern
                    if top <= y < m.baseline - style.horizontal_stroke
                    else bar
                    if m.baseline - style.horizontal_stroke <= y < m.baseline
                    else 0
                    for y in range(font.height)
                ]
                tail = char in ("Щ", "щ")
                if not tail or m.baseline + style.horizontal_stroke <= font.height:
                    if tail:
                        tail_mask = ((1 << style.vertical_stroke) - 1) << (
                            font.width - right
                        )
                        for y in range(
                            m.baseline, m.baseline + style.horizontal_stroke
                        ):
                            result_rows[y] = tail_mask
                    yield (
                        Bitmap(font.width, font.height, tuple(result_rows)),
                        [donor],
                        "source-three-stem-layout",
                        [
                            "Three stem positions/widths measured directly from W/m; no synthetic column mask."
                        ],
                    )
    # Claude's lower(capital), restricted to repeat-only reflow. This retains
    # actual serifs and diagonal phase instead of uniformly redrawing strokes.
    source = {"в": "B", "н": "H", "м": "M", "т": "T", "я": "R"}.get(char)
    if source and source in font.glyphs:
        bmp = font.glyphs[source]
        box = bmp.bbox()
        if box:
            try:
                fitted = repeat_fit(
                    bmp,
                    box[2] - box[0],
                    m.x_height,
                    style.vertical_stroke,
                    style.horizontal_stroke,
                )
                if char == "я":
                    fitted = fitted.mirror_lr()
                yield (
                    fitted.place(font.width, font.height, box[0], m.x_top),
                    [source],
                    "source-capital-reflow",
                    [
                        "Only duplicate interior rows removed; original unique strokes and serifs retained."
                    ],
                )
            except ConstructionError:
                pass
    # H stems and a real E/F/T top bar keep platform-specific terminal shapes.
    if char in ("П", "п") and "H" in font.glyphs:
        bmp = font.glyphs["H"]
        box = bmp.bbox()
        if not box:
            return
        left, top, right, bottom = box
        if char == "п":
            try:
                bmp = repeat_fit(
                    bmp,
                    right - left,
                    m.x_height,
                    style.vertical_stroke,
                    style.horizontal_stroke,
                ).place(font.width, font.height, left, m.x_top)
            except ConstructionError:
                return
            top, bottom = m.x_top, m.baseline
        for bar_source in ("E", "F", "T"):
            bar = font.glyphs.get(bar_source)
            if not bar or not bar.bbox():
                continue
            bt = bar.bbox()[1]
            band = [
                bar.rows[y]
                for y in range(bt, min(bar.height, bt + style.horizontal_stroke))
            ]
            mask = ((1 << (right - left)) - 1) << (font.width - right)
            if not band or any(row & mask != mask for row in band):
                continue
            matrix = bmp.to_matrix()
            for y in range(top, bottom):
                for x in range(
                    left + style.vertical_stroke, right - style.vertical_stroke
                ):
                    matrix[y][x] = 0
            for dy, row in enumerate(band):
                if top + dy >= bottom:
                    break
                for x in range(left, right):
                    matrix[top + dy][x] |= (row >> (font.width - 1 - x)) & 1
            yield (
                Bitmap.from_matrix(matrix),
                ["H", bar_source],
                "source-stems-and-bar",
                [
                    "H outer stems/terminals and a source top bar retained; middle bridge removed."
                ],
            )
            break
    # Independent source reflection, useful when the geometry builder cannot
    # find an A donor for its triangular El policy.
    if char == "Л" and "V" in font.glyphs:
        yield (
            _local_flip(font.glyphs["V"], "top-bottom"),
            ["V"],
            "reflected-ve-el-alternate",
            ["V reflected vertically; alternate El requires visual review."],
        )
