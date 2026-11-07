"""Native source-part recipes for decorative, serif and tiny bitmap fonts.

Keep source corners and diagonal phase. Any fitting removes duplicate scanlines
only; widening inserts a centre column and is explicit in the provenance.
"""

from .bitmap import Bitmap
from .fragments import repeat_fit
from .synthesis import ConstructionError, _counter_count


def spine(bitmap):
    left, top, right, bottom = bitmap.bbox()
    counts = [
        sum(bitmap.get(x, y) for y in range(top, bottom)) for x in range(left, right)
    ]
    best = max(counts)
    x = left + counts.index(best)
    end = x + 1
    while end < right and counts[end - left] == best:
        end += 1
    return x, end


def widen(bitmap, width):
    """Insert centre columns without dropping a source pixel or thinning a run."""
    if width < bitmap.width:
        raise ConstructionError("Widening cannot shrink a source")
    matrix = bitmap.to_matrix()
    while len(matrix[0]) < width:
        middle = len(matrix[0]) // 2
        for row in matrix:
            row.insert(middle, row[middle])
    return Bitmap.from_matrix(matrix)


def runs(row):
    return sum(v and (i == 0 or not row[i - 1]) for i, v in enumerate(row))


def alternatives(char, font, style):
    m = style.metrics
    upper = char.isupper()
    top, bottom = (m.cap_top if upper else m.x_top), m.baseline
    if char in ("Г", "г") and "F" in font.glyphs:
        source = font.glyphs["F"]
        left, st, right, sb = source.bbox()
        sx, se = spine(source)
        # The first rows containing only the stem terminate the top bar.
        top_end = st
        while top_end < sb and any(source.get(x, top_end) for x in range(se, right)):
            top_end += 1
        if st < top_end < sb:
            matrix = source.to_matrix()
            for y in range(top_end, max(top_end, sb - style.horizontal_stroke)):
                for x in range(se, right):
                    matrix[y][x] = 0
            result = Bitmap.from_matrix(matrix)
            if not upper:
                try:
                    result = repeat_fit(
                        result,
                        result.bbox()[2] - result.bbox()[0],
                        bottom - top,
                        1,
                        style.horizontal_stroke,
                    ).place(font.width, font.height, left, top)
                except ConstructionError:
                    result = None
            if result:
                yield (
                    result,
                    ["F"],
                    "source-f-without-middle-bar",
                    [
                        "Source F stem, top bar and bottom serif retained; middle arm removed."
                    ],
                )
    if char in ("Д", "д") and "A" in font.glyphs:
        source = font.glyphs["A"]
        left, st, right, sb = source.bbox()
        matrix = source.to_matrix()
        candidates = list(
            range(st + style.horizontal_stroke, sb - style.horizontal_stroke)
        )
        if candidates:
            waist = max(
                candidates,
                key=lambda y: (sum(matrix[y][left:right]), -abs(y - style.cap_waist)),
            )
            # Remove only the interior crossbar; source outer diagonal pixels survive.
            for y in range(
                waist,
                min(sb - style.horizontal_stroke, waist + style.horizontal_stroke),
            ):
                occupied = [x for x in range(left, right) if matrix[y][x]]
                if len(occupied) > 2 * style.vertical_stroke:
                    for x in occupied[style.vertical_stroke : -style.vertical_stroke]:
                        matrix[y][x] = 0
            result = Bitmap.from_matrix(matrix)
            if not upper:
                try:
                    result = repeat_fit(result, right - left, bottom - top, 1, 1).place(
                        font.width, font.height, left, top
                    )
                except ConstructionError:
                    result = None
            if result and _counter_count(result) == 0:
                if char in ("Д", "д"):
                    if bottom + style.horizontal_stroke > font.height:
                        result = None
                    else:
                        matrix = result.to_matrix()
                        pl, pr = max(0, left - 1), min(font.width, right + 1)
                        for y in range(bottom - style.horizontal_stroke, bottom):
                            for x in range(pl, pr):
                                matrix[y][x] = 1
                        for y in range(bottom, bottom + style.horizontal_stroke):
                            for x in list(range(pl, pl + style.vertical_stroke)) + list(
                                range(pr - style.vertical_stroke, pr)
                            ):
                                matrix[y][x] = 1
                        result = Bitmap.from_matrix(matrix)
                if result:
                    yield (
                        result,
                        ["A"],
                        "source-a-without-crossbar",
                        [
                            "A source outer strokes retained; crossbar opened; De platform/feet use the measured stroke weight."
                        ],
                    )
    if char == "ь" and "b" in font.glyphs:
        source = font.glyphs["b"]
        result = Bitmap(
            font.width,
            font.height,
            tuple(row if top <= y < bottom else 0 for y, row in enumerate(source.rows)),
        )
        if result.count() and _counter_count(result) == 1:
            yield (
                result,
                ["b"],
                "source-b-without-ascender",
                [
                    "Only source b ascender above x-height removed; original bowl retained."
                ],
            )
    if char in ("Ч", "ч"):
        donor = "U" if upper else "u"
        source = font.glyphs.get(donor)
        if source and source.bbox():
            left, st, right, sb = source.bbox()
            width = right - left
            matrix = [[0] * font.width for _ in range(font.height)]
            waist = max(
                top + 1,
                min(bottom - 2, style.cap_waist if upper else style.lower_waist),
            )
            bowl_depth = min(2 * style.horizontal_stroke, waist - top + 1)
            shift = waist + 1 - sb
            for y in range(top, waist + 1 - bowl_depth):
                matrix[y] = [source.get(x, y) for x in range(font.width)]
            for y in range(sb - bowl_depth, sb):
                dy = y + shift
                if 0 <= dy < font.height:
                    matrix[dy] = [source.get(x, y) for x in range(font.width)]
            # Actual right source stem columns, with the source's upper terminal.
            counts = [
                sum(source.get(x, y) for y in range(st, sb))
                for x in range(left + width // 2, right)
            ]
            rx = left + width // 2 + max(range(len(counts)), key=lambda i: counts[i])
            for y in range(top, bottom):
                for x in range(max(left, rx - style.vertical_stroke + 1), rx + 1):
                    matrix[y][x] = 1
            result = Bitmap.from_matrix(matrix)
            if result.count() and result != source:
                yield (
                    result,
                    [donor],
                    "source-cup-and-right-stem",
                    [
                        "Native U/u bottom cup moved to the waist; right stem continues to baseline."
                    ],
                )
    if char in ("Ж", "ж", "Ф", "ф"):
        donor = (
            ("X" if upper else "x") if char in ("Ж", "ж") else ("O" if upper else "o")
        )
        source = font.glyphs.get(donor)
        if not source or not source.bbox():
            return
        sl, st, sr, sb = source.bbox()
        part = source.crop(sl, st, sr - sl, sb - st)
        stem_donor = "I" if upper else ("b" if "b" in font.glyphs else "p")
        stem_source = font.glyphs.get(stem_donor)
        if not stem_source or not stem_source.bbox():
            return
        sx, se = spine(stem_source)
        stem_width = se - sx
        # Do not infer stem thickness from a full-row bar/serif spanning the cell.
        if stem_width > max(1, (sr - sl) // 2):
            return
        minimum = 3 * stem_width + 2
        if char in ("Ж", "ж"):
            # Actual X terminals can be much wider than the spine (slab serifs).
            # Reserve both native terminal widths, the spine and two gaps.
            for row in (part.to_matrix()[0], part.to_matrix()[-1]):
                positions = [i for i, v in enumerate(row) if v]
                groups = []
                for x in positions:
                    if not groups or x != groups[-1][-1] + 1:
                        groups.append([x])
                    else:
                        groups[-1].append(x)
                if len(groups) == 2:
                    minimum = max(
                        minimum, len(groups[0]) + len(groups[1]) + stem_width + 2
                    )
        desired = min(font.width, max(part.width, minimum))
        if desired < minimum:
            return
        part = widen(part, desired)
        left = max(0, min(font.width - desired, (sl + sr - desired) // 2))
        pt, pb = st, sb
        if char == "Ф":
            pt, pb = top + style.horizontal_stroke, bottom - style.horizontal_stroke
            try:
                part = repeat_fit(part, part.width, pb - pt, 1, 1)
            except ConstructionError:
                return
        result = part.place(font.width, font.height, left, pt)
        matrix = result.to_matrix()
        centre = left + (desired - stem_width) // 2
        stem_top, stem_bottom = (
            (top, bottom)
            if upper
            else (min(top, stem_source.bbox()[1]), max(bottom, stem_source.bbox()[3]))
        )
        if char == "ф" and "p" in font.glyphs:
            stem_bottom = max(stem_bottom, font.glyphs["p"].bbox()[3])
        for y in range(stem_top, stem_bottom):
            for x in range(centre, centre + stem_width):
                matrix[y][x] = 1
        result = Bitmap.from_matrix(matrix)
        if char in ("Ф", "ф") and _counter_count(result) != 2:
            return
        if char in ("Ж", "ж") and not (
            runs(matrix[top]) == 3 and runs(matrix[bottom - 1]) == 3
        ):
            return
        yield (
            result,
            [donor, stem_donor],
            "source-arms-or-oval-with-stem",
            [
                "Actual source X/x arms or O/o corners retained; source stem width measured independently.",
                "Centre columns inserted to reserve counters/arm gaps; advance and cell unchanged."
                if desired > sr - sl
                else "Native source width retained.",
            ],
        )
