"""Deterministic, donor-based construction of the 66 Ukrainian letters.

The prototype is deliberately conservative about absent donors and geometry.
Every drawing operation checks its bounds.  It does not load outline fonts,
neural models, hand-authored complete Cyrillic bitmaps, or external resources.
"""

from __future__ import annotations

from collections import Counter

from .bitmap import Bitmap
from .model import UK_ALPHABET, UK_LOWER, UK_UPPER, Font
from .recipes import COPY_MAP, DONOR_GROUPS, FLIP_MAP, RECIPE_NAMES
from .style import CurveProfile, Style, curve_profile, estimate_style


class ConstructionError(ValueError):
    """A reported missing donor or unsatisfiable pixel-space constraint."""


class Canvas:
    def __init__(self, width: int, height: int, initial: Bitmap | None = None):
        self.width, self.height = width, height
        self.pixels = (
            initial.to_matrix() if initial else [[0] * width for _ in range(height)]
        )

    def rect(self, x0: int, y0: int, x1: int, y1: int) -> None:
        if x1 <= x0 or y1 <= y0:
            return
        if x0 < 0 or y0 < 0 or x1 > self.width or y1 > self.height:
            raise ConstructionError(
                f"Drawing would clip ink: rectangle {(x0, y0, x1, y1)} outside {self.width}x{self.height}."
            )
        for y in range(y0, y1):
            for x in range(x0, x1):
                self.pixels[y][x] = 1

    def line(self, x0: int, y0: int, x1: int, y1: int, v: int = 1, h: int = 1) -> None:
        """Integer Bresenham centre path with an explicit v by h pixel brush."""
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        error = dx + dy
        while True:
            self.rect(x0, y0, x0 + v, y0 + h)
            if x0 == x1 and y0 == y1:
                break
            doubled = 2 * error
            if doubled >= dy:
                error += dy
                x0 += sx
            if doubled <= dx:
                error += dx
                y0 += sy

    def bitmap(self) -> Bitmap:
        return Bitmap.from_matrix(self.pixels)


def _body_mask(bitmap: Bitmap, top: int, bottom: int) -> Bitmap:
    return Bitmap(
        bitmap.width,
        bitmap.height,
        tuple(row if top <= y < bottom else 0 for y, row in enumerate(bitmap.rows)),
    )


def _local_flip(bitmap: Bitmap, direction: str) -> Bitmap:
    box = bitmap.bbox()
    if box is None:
        raise ConstructionError("Cannot reflect a blank donor.")
    x0, y0, x1, y1 = box
    cropped = bitmap.crop(x0, y0, x1 - x0, y1 - y0)
    flipped = cropped.mirror_lr() if direction == "left-right" else cropped.mirror_tb()
    return flipped.place(bitmap.width, bitmap.height, x0, y0)


def _has_diagonal(bitmap: Bitmap, stroke: int, horizontal: int) -> bool:
    """Require a moving interior stroke, not just a Latin N Unicode label.

    Uncial N can be an arch. Reflecting that arch is not Cyrillic И.
    Ignore outer spines, top connectors and bottom serifs while probing.
    """
    left, top, right, bottom = bitmap.bbox()
    counts = [
        sum(bitmap.get(x, y) for y in range(top, bottom)) for x in range(left, right)
    ]
    half = max(1, len(counts) // 2)
    lx = left + max(range(half), key=lambda i: counts[i])
    rx = left + half + max(range(len(counts) - half), key=lambda i: counts[i + half])
    samples = []
    for y in range(top + horizontal, bottom - horizontal):
        xs = [x for x in range(lx + stroke, rx) if bitmap.get(x, y)]
        if xs:
            samples.append((y, sum(xs) / len(xs)))
    return (
        len(samples) >= 2
        and max(x for _, x in samples) - min(x for _, x in samples) >= 1
    )


def _touches(first: Bitmap, second: Bitmap) -> bool:
    """Whether the two masks touch under eight-neighbour foreground topology."""
    for y in range(first.height):
        for x in range(first.width):
            if first.get(x, y):
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if second.get(x + dx, y + dy):
                            return True
    return False


def _counter_count(bitmap: Bitmap) -> int:
    """Count enclosed four-connected white regions (eight-connected ink)."""
    visited: set[tuple[int, int]] = set()
    count = 0
    for y in range(bitmap.height):
        for x in range(bitmap.width):
            if bitmap.get(x, y) or (x, y) in visited:
                continue
            stack = [(x, y)]
            visited.add((x, y))
            touches_edge = False
            while stack:
                px, py = stack.pop()
                if px in (0, bitmap.width - 1) or py in (0, bitmap.height - 1):
                    touches_edge = True
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if (
                        0 <= nx < bitmap.width
                        and 0 <= ny < bitmap.height
                        and (nx, ny) not in visited
                        and not bitmap.get(nx, ny)
                    ):
                        visited.add((nx, ny))
                        stack.append((nx, ny))
            if not touches_edge:
                count += 1
    return count


def _retarget_repeated_rows(
    bitmap: Bitmap, new_top: int, bottom: int, h: int
) -> Bitmap:
    """Shorten straight elastic zones without downsampling any stroke.

    This is used for compact capital I. Only an interior row identical to its
    neighbour may be removed; protected top/bottom horizontal strokes remain.
    """
    box = bitmap.bbox()
    if box is None:
        raise ConstructionError("Cannot reflow an empty base.")
    x0, old_top, x1, old_bottom = box
    if old_bottom != bottom:
        raise ConstructionError(
            "Capital I donor does not end at the declared baseline; compact reflow needs manual metrics."
        )
    rows = list(bitmap.crop(x0, old_top, x1 - x0, old_bottom - old_top).rows)
    target_height = bottom - new_top
    if target_height < 2 * h + 1:
        raise ConstructionError(
            "Insufficient height for compact capital I without losing its top/bottom stroke or stem."
        )
    while len(rows) > target_height:
        candidates = [
            i
            for i in range(h, len(rows) - h)
            if (i > 0 and rows[i] == rows[i - 1])
            or (i + 1 < len(rows) and rows[i] == rows[i + 1])
        ]
        if not candidates:
            raise ConstructionError(
                "Capital I cannot be shortened using repeated interior rows without altering stroke pixels."
            )
        middle = (len(rows) - 1) / 2
        index = min(candidates, key=lambda i: (abs(i - middle), i))
        rows.pop(index)
    if len(rows) != target_height:
        raise ConstructionError(
            "Compact reflow would require unrequested vertical expansion."
        )
    return Bitmap(x1 - x0, target_height, tuple(rows)).place(
        bitmap.width, bitmap.height, x0, new_top
    )


class Builder:
    def __init__(self, font: Font, glyphs: dict[str, Bitmap], style: Style, mode: str):
        self.font, self.glyphs, self.style, self.mode = font, glyphs, style, mode
        self.metrics = style.metrics
        self.v, self.h = style.vertical_stroke, style.horizontal_stroke
        self.adaptations: list[str] = []
        self.warnings: list[str] = []
        self.donors: list[str] = []
        self.target = ""

    def note(self, text: str) -> None:
        if text not in self.adaptations:
            self.adaptations.append(text)

    def use(self, char: str) -> Bitmap:
        bitmap = self.glyphs.get(char)
        if bitmap is None or bitmap.bbox() is None:
            raise ConstructionError(f"Required donor {char!r} is missing or blank.")
        if char not in self.donors:
            self.donors.append(char)
        return bitmap

    def choose(self, choices: tuple[str, ...]) -> tuple[str, Bitmap]:
        for char in choices:
            bitmap = self.glyphs.get(char)
            if bitmap is not None and bitmap.bbox() is not None:
                return char, self.use(char)
        raise ConstructionError(
            "Missing nonblank donor; need one of: "
            + ", ".join(repr(c) for c in choices)
            + "."
        )

    def canvas(self, initial: Bitmap | None = None) -> Canvas:
        return Canvas(self.font.width, self.font.height, initial)

    def dimensions(self, upper: bool) -> tuple[int, int, int, int]:
        left, right = self.style.cap_bounds if upper else self.style.lower_bounds
        top = self.metrics.cap_top if upper else self.metrics.x_top
        return left, top, right, self.metrics.baseline

    def wide_dimensions(
        self, box: tuple[int, int, int, int]
    ) -> tuple[int, int, int, int]:
        """Use sidebearing budget for intrinsically wide constructions.

        Fixed advance is preserved. At least one cell column remains outside
        the new ink box when the source already provides that spacing budget.
        The donor ink centre, not an assumed symmetrical cell, is the anchor.
        """
        left, top, right, bottom = box
        old_width = right - left
        desired = max(old_width, min(self.font.width - 1, old_width + 2))
        if desired == old_width:
            return box
        centre_twice = left + right - 1
        new_left = (centre_twice - (desired - 1)) // 2
        new_left = max(0, min(self.font.width - desired, new_left))
        new_right = new_left + desired
        self.note(
            f"Wide-letter ink bounds expanded [{left},{right}) -> [{new_left},{new_right}); width {old_width}->{desired}, fixed cell advance {self.font.width} retained."
        )
        return new_left, top, new_right, bottom

    def require_size(
        self, box: tuple[int, int, int, int], width: int, height: int, what: str
    ) -> None:
        left, top, right, bottom = box
        if right - left < width or bottom - top < height:
            raise ConstructionError(
                f"{what} needs at least {width}x{height} ink pixels at measured strokes {self.v}x{self.h}; available {right - left}x{bottom - top}."
            )

    def curve(self, upper: bool, preferred: str | None = None) -> CurveProfile:
        if preferred and preferred in self.glyphs and self.glyphs[preferred].bbox():
            self.use(preferred)
            return curve_profile(self.glyphs[preferred], preferred)
        profile = self.style.cap_curve if upper else self.style.lower_curve
        if profile.donor:
            self.use(profile.donor)
        else:
            self.warnings.append(
                "No curved style donor: square corners used as the explicitly reported structural fallback."
            )
        return profile

    def oval(
        self,
        canvas: Canvas,
        box: tuple[int, int, int, int],
        profile: CurveProfile,
        kind: str = "ring",
    ) -> None:
        x0, y0, x1, y1 = box
        self.require_size(box, 2 * self.v + 1, 2 * self.h + 1, "An open oval counter")
        max_inset = max(0, (x1 - x0 - 1) // 2)
        for y in range(y0, y1):
            t, b = y - y0, y1 - 1 - y
            li = max(
                profile.top_left[t] if t < len(profile.top_left) else 0,
                profile.bottom_left[b] if b < len(profile.bottom_left) else 0,
            )
            ri = max(
                profile.top_right[t] if t < len(profile.top_right) else 0,
                profile.bottom_right[b] if b < len(profile.bottom_right) else 0,
            )
            if li > max_inset or ri > max_inset:
                self.note(
                    "Corner inset shortened to fit the new bowl width; stroke thickness retained."
                )
            li, ri = min(li, max_inset), min(ri, max_inset)
            left, right = x0 + li, x1 - ri
            if right <= left:
                raise ConstructionError(
                    "Donor corner contour leaves no ink in the fitted oval."
                )
            if t < self.h or b < self.h:
                canvas.rect(left, y, right, y + 1)
            else:
                if right - left < 2 * self.v + 1:
                    # A corner transition can briefly meet at the apex, but
                    # an interior full-height overlap would destroy the hole.
                    raise ConstructionError(
                        "Donor corner contour closes the fitted oval counter; no stroke thinning applied."
                    )
                if kind != "open-right-bowl":
                    canvas.rect(left, y, left + self.v, y + 1)
                canvas.rect(right - self.v, y, right, y + 1)

    def right_bowl(
        self,
        canvas: Canvas,
        box: tuple[int, int, int, int],
        profile: CurveProfile,
        open_left: bool = False,
    ) -> None:
        contour = (
            profile
            if open_left
            else CurveProfile(
                (), profile.top_right, (), profile.bottom_right, profile.donor
            )
        )
        self.oval(canvas, box, contour, "open-right-bowl" if open_left else "ring")

    def stem(self, canvas: Canvas, x: int, top: int, bottom: int) -> None:
        canvas.rect(x, top, x + self.v, bottom)

    def bar(self, canvas: Canvas, left: int, right: int, y: int) -> None:
        canvas.rect(left, y, right, y + self.h)

    def diagonal(self, canvas: Canvas, x0: int, y0: int, x1: int, y1: int) -> None:
        canvas.line(x0, y0, x1, y1, self.v, self.h)

    def ghe(self, box: tuple[int, int, int, int]) -> Bitmap:
        self.require_size(box, 2 * self.v + 1, 2 * self.h + 1, "Ghe")
        left, top, right, bottom = box
        canvas = self.canvas()
        self.stem(canvas, left, top, bottom)
        self.bar(canvas, left, right, top)
        return canvas.bitmap()

    def reversed_n(self, box: tuple[int, int, int, int]) -> Bitmap:
        self.require_size(box, 2 * self.v + 1, 2 * self.h + 1, "Reversed N")
        left, top, right, bottom = box
        canvas = self.canvas()
        self.stem(canvas, left, top, bottom)
        self.stem(canvas, right - self.v, top, bottom)
        self.diagonal(canvas, left, bottom - self.h, right - self.v, top)
        return canvas.bitmap()

    def descender(self, canvas: Canvas, x: int) -> None:
        if self.metrics.baseline + self.h > self.font.height:
            raise ConstructionError(
                "No room for the required descender below baseline at the measured stroke thickness."
            )
        self.stem(canvas, x, self.metrics.baseline, self.metrics.baseline + self.h)

    def dot(self, source: str) -> Bitmap:
        bitmap = self.use(source)
        if source in ("i", "і", "j"):
            mask = _body_mask(bitmap, 0, self.metrics.x_top)
            box = mask.bbox()
            if box is None:
                raise ConstructionError(
                    "Dotted donor has no ink above x-height; its dot cannot be extracted."
                )
            if _touches(mask, _body_mask(bitmap, self.metrics.x_top, self.font.height)):
                raise ConstructionError(
                    "Source dot touches its stem; a separate dot mask cannot be inferred safely."
                )
        else:
            mask = bitmap
            box = mask.bbox()
        if box is None:
            raise ConstructionError("Dot source is blank.")
        x0, y0, x1, y1 = box
        return mask.crop(x0, y0, x1 - x0, y1 - y0)

    def diaeresis(self, upper: bool, selected: list[str]) -> Bitmap:
        base_name = selected[0]
        source = self.use(base_name)
        dot_name = selected[1] if upper else base_name
        dot = self.dot(dot_name)
        body = (
            source
            if upper
            else _body_mask(source, self.metrics.x_top, self.font.height)
        )
        bounds = body.bbox()
        if bounds is None:
            raise ConstructionError("Yi base body is empty after dot removal.")
        body_top = bounds[1]
        required_top = dot.height + 1
        if body_top < required_top:
            if not upper or self.mode == "strict":
                raise ConstructionError(
                    "Insufficient room for two source dots and one blank separating row above the unchanged body."
                )
            old_height = self.metrics.baseline - body_top
            body = _retarget_repeated_rows(
                body, required_top, self.metrics.baseline, self.h
            )
            self.note(
                f"Compact capital body shortened from {old_height} to {self.metrics.baseline - required_top} rows; top {body_top}->{required_top}, baseline unchanged."
            )
            body_top = required_top
        left, right = self.style.cap_bounds if upper else self.style.lower_bounds
        pair_width = 2 * dot.width + 1
        if pair_width > right - left:
            raise ConstructionError(
                "Two source dot masks with a one-pixel gap do not fit the measured ink width; dots were not thinned."
            )
        mark_left = left + ((right - left) - pair_width) // 2
        mark_top = body_top - 1 - dot.height
        first = dot.place(self.font.width, self.font.height, mark_left, mark_top)
        second = dot.place(
            self.font.width, self.font.height, mark_left + dot.width + 1, mark_top
        )
        marks = first.union(second)
        if _touches(marks, body) or _touches(first, second):
            raise ConstructionError(
                "Diaeresis masks touch the body or each other under eight-neighbour connectivity."
            )
        if not upper:
            self.note(
                "Original i dot removed; two unchanged copies of its dot mask placed over the original stem."
            )
        return body.union(marks)

    def breve(self, upper: bool, selected: list[str]) -> Bitmap:
        base_name = selected[0]
        source = self.use(base_name)
        if base_name == "N":
            body = (
                _local_flip(source, "left-right")
                if upper
                else self.reversed_n(self.dimensions(False))
            )
        else:
            body = source
        bounds = body.bbox()
        if bounds is None:
            raise ConstructionError("Short-I base is empty.")
        left, top, right, bottom = bounds
        mark_height = 2 * self.h
        mark_width = 2 * self.v + 1
        if right - left < mark_width:
            raise ConstructionError(
                "The minimum two-row breve does not fit the base width."
            )
        required_top = mark_height + 1
        no_blank_gap = False

        def make_mark(body_top: int, blank_gap: bool) -> Bitmap:
            mark_top = body_top - mark_height - (1 if blank_gap else 0)
            mark_left = left + ((right - left) - mark_width) // 2
            mark = self.canvas()
            # Minimal cup: two shoulders above a centre floor. This partial
            # mark is a primitive, not a pre-authored full glyph bitmap.
            mark.rect(mark_left, mark_top, mark_left + self.v, mark_top + self.h)
            mark.rect(
                mark_left + mark_width - self.v,
                mark_top,
                mark_left + mark_width,
                mark_top + self.h,
            )
            mark.rect(
                mark_left + self.v,
                mark_top + self.h,
                mark_left + mark_width - self.v,
                mark_top + mark_height,
            )
            return mark.bitmap()

        if top < required_top:
            if self.mode == "strict":
                raise ConstructionError(
                    "Insufficient room for a two-row breve and a blank separating row above the unchanged body."
                )
            if upper:
                old_height = bottom - top
                # First spend only the mark rows. In small grids a global
                # empty row needlessly destroys the N diagonal even when
                # the centre mark and outer top stems remain disconnected.
                candidate_top = max(top, mark_height)
                try:
                    candidate = (
                        body
                        if candidate_top == top
                        else self.reversed_n((left, candidate_top, right, bottom))
                    )
                    candidate_mark = make_mark(candidate_top, False)
                    candidate_fits = not _touches(candidate_mark, candidate)
                except ConstructionError:
                    candidate_fits = False
                if candidate_fits:
                    body = candidate
                    no_blank_gap = True
                    self.note(
                        "Compact capital breve has no full blank separating row; eight-neighbour separation verified."
                    )
                    if candidate_top == top:
                        self.note(
                            "Original capital I body retained pixel-for-pixel beneath the compact breve."
                        )
                    else:
                        self.note(
                            f"Compact capital body rebuilt from {old_height} to {bottom - candidate_top} rows; top {top}->{candidate_top}, baseline and stroke thickness unchanged."
                        )
                    top = candidate_top
                else:
                    body = self.reversed_n((left, required_top, right, bottom))
                    self.note(
                        f"Compact capital body rebuilt from {old_height} to {bottom - required_top} rows; top {top}->{required_top}, baseline and stroke thickness unchanged."
                    )
                    top = required_top
            elif top >= mark_height:
                no_blank_gap = True
                self.note(
                    "Compact lowercase breve has no full blank separating row; original lowercase body retained and eight-neighbour separation verified."
                )
            else:
                raise ConstructionError(
                    "No space for a true two-row lowercase breve; lowercase body was not shortened."
                )
        mask = make_mark(top, not no_blank_gap)
        if _touches(mask, body):
            raise ConstructionError(
                "Breve would touch the unchanged lowercase body; no clipping or body compaction applied."
            )
        self.warnings.append(
            "Breve is the minimum discrete cup construction; a source breve was not supplied for exact accent-style copying."
        )
        return body.union(mask)

    def upturn(self, upper: bool, selected: list[str]) -> Bitmap:
        source_name = selected[0]
        if source_name in ("Г", "г"):
            body = self.use(source_name)
        elif source_name == "L" and upper:
            body = _local_flip(self.use(source_name), "top-bottom")
        else:
            body = self.ghe(self.dimensions(upper))
        left, top, right, bottom = body.bbox()
        extension = self.h
        if top < extension:
            if self.mode != "compact" or not upper:
                raise ConstructionError(
                    "No row above Ghe for its attached upturn; unchanged body required by this mode."
                )
            old_top = top
            top = extension
            body = self.ghe((left, top, right, bottom))
            self.note(
                f"Compact capital Ghe body top lowered {old_top}->{top} to reserve {extension} upturn row(s); baseline and stroke thickness unchanged."
            )
        canvas = self.canvas(body)
        self.stem(canvas, right - self.v, top - extension, top + self.h)
        return canvas.bitmap()

    def build(self, target: str) -> tuple[Bitmap, str, str]:
        self.target = target
        upper = target in UK_UPPER
        if target in COPY_MAP:
            donor = COPY_MAP[target]
            return self.use(donor), "copied", f"exact bitmap alias from Latin {donor}"
        if target == "Ї" and "Ï" in self.glyphs and self.glyphs["Ï"].bbox():
            return (
                self.use("Ï"),
                "copied",
                "exact bitmap alias from Latin I with diaeresis",
            )
        if target == "ї" and "ï" in self.glyphs and self.glyphs["ï"].bbox():
            return (
                self.use("ï"),
                "copied",
                "exact bitmap alias from Latin i with diaeresis",
            )
        if target in FLIP_MAP:
            donor, direction = FLIP_MAP[target]
            if donor in self.glyphs and self.glyphs[donor].bbox():
                if target == "И" and not _has_diagonal(
                    self.glyphs[donor], self.v, self.h
                ):
                    self.use(donor)
                    if "H" in self.glyphs:
                        self.use("H")
                    self.note(
                        "Latin N has no diagonal (e.g. uncial arch); Cyrillic И constructed from measured stems and a diagonal instead of reflecting an arch."
                    )
                    return (
                        self.reversed_n(self.dimensions(True)),
                        "generated",
                        "diagonal Cyrillic I from measured source stems",
                    )
                return (
                    _local_flip(self.use(donor), direction),
                    "generated",
                    f"local {direction} reflection of {donor}; original ink-box origin retained",
                )
            if target == "Г" and "F" in self.glyphs and self.glyphs["F"].bbox():
                self.use("F")
                self.warnings.append(
                    "L unavailable; Ghe rebuilt from F-style stem and top bar."
                )
                return (
                    self.ghe(self.dimensions(True)),
                    "generated",
                    "F structure without its middle bar",
                )
            if target == "Ь" and "B" in self.glyphs and self.glyphs["B"].bbox():
                self.use("B")
                # Continue to the structural lower-bowl implementation.
            else:
                self.use(donor)  # raises the uniform, explicit missing-donor error
        selected = [self.choose(group)[0] for group in DONOR_GROUPS.get(target, ())]
        recipe = RECIPE_NAMES.get(target, "upper_soft_sign: stem and lower B bowl")
        box = self.dimensions(upper)
        if target in ("Д", "д", "Ж", "ж", "Ю", "ю"):
            box = self.wide_dimensions(box)
        left, top, right, bottom = box
        width, height = right - left, bottom - top
        middle = max(
            top,
            min(
                bottom - self.h,
                self.style.cap_waist if upper else self.style.lower_waist,
            ),
        )
        centre = left + (width - self.v) // 2
        canvas = self.canvas()

        if target in ("Ї", "ї"):
            return self.diaeresis(upper, selected), "generated", recipe
        if target in ("Й", "й"):
            return self.breve(upper, selected), "generated", recipe
        if target in ("Ґ", "ґ"):
            return self.upturn(upper, selected), "generated", recipe
        if target == "к":
            donor = self.use("k")
            body = _body_mask(donor, self.metrics.x_top, self.font.height)
            if body.bbox() is None:
                raise ConstructionError("Source k has no body at or below x-height.")
            self.note(
                "Only source k pixels above x_top removed; all remaining pixels retained exactly."
            )
            return body, "generated", recipe
        if target in ("Є", "є"):
            donor = self.use("C" if upper else "c")
            canvas = self.canvas(donor)
            dl, dt, dr, db = donor.bbox()
            bar_y = max(dt, min(db - self.h, middle))
            self.bar(canvas, dl, dr, bar_y)
            return canvas.bitmap(), "generated", recipe
        if target == "г":
            return self.ghe(box), "generated", recipe
        if target == "и":
            return self.reversed_n(box), "generated", recipe
        if target in ("Л", "л", "Д", "д"):
            is_de = target in ("Д", "д")
            self.require_size(box, 2 * self.v + 1, 3 * self.h + 1, "Triangular El/De")
            if is_de:
                # Side pixels for the platform/feet are reserved inside the
                # existing advance, rather than increasing glyph width.
                leg_left, leg_right = left + 1, right - self.v - 1
                if leg_right < leg_left:
                    raise ConstructionError(
                        "No room for De feet around the triangular body."
                    )
                apex = (leg_left + leg_right) // 2
                self.diagonal(canvas, apex, top, leg_left, bottom - self.h)
                self.diagonal(canvas, apex, top, leg_right, bottom - self.h)
                self.bar(canvas, left, right, bottom - self.h)
                self.descender(canvas, left)
                self.descender(canvas, right - self.v)
                self.note(
                    "Triangular De construction selected; platform and feet fitted within the fixed ink width."
                )
            else:
                self.diagonal(canvas, centre, top, left, bottom - self.h)
                self.diagonal(canvas, centre, top, right - self.v, bottom - self.h)
                self.note(
                    "Triangular El construction selected; A crossbar is not reproduced."
                )
        elif target in ("Б", "в", "З", "з", "ь", "Ь"):
            if target == "З" and "3" in self.glyphs and self.glyphs["3"].bbox():
                digit = self.use("3")
                db = digit.bbox()
                if db[1] == top and db[3] == bottom:
                    self.warnings.append(
                        "Digit 3 form adopted as the Ze candidate; terminals may need typographic review."
                    )
                    return (
                        digit,
                        "copied",
                        "digit 3 bitmap adopted at matching capital anchors",
                    )
            profile_donor = (
                selected[0]
                if target in ("З", "з") and selected
                else ("B" if "B" in self.glyphs else None)
            )
            profile = self.curve(upper, profile_donor)
            if target in ("в", "З", "з"):
                self.require_size(
                    box, 2 * self.v + 1, 3 * self.h + 2, "Two distinct bowl counters"
                )
                self.right_bowl(
                    canvas,
                    (left, top, right, middle + self.h),
                    profile,
                    open_left=target in ("З", "з"),
                )
                self.right_bowl(
                    canvas,
                    (left, middle, right, bottom),
                    profile,
                    open_left=target in ("З", "з"),
                )
                if target in ("З", "з"):
                    indent = max(self.v, (width - self.v) // 2)
                    if selected and selected[0] == "3":
                        digit = self.use("3")
                        sl, st, sr, sb = digit.bbox()
                        waist_y = st + (sb - st - self.h) // 2
                        occupied = [x for x in range(sl, sr) if digit.get(x, waist_y)]
                        if occupied and min(occupied) > sl:
                            indent = max(
                                self.v, (min(occupied) - sl) * width // (sr - sl)
                            )
                    indent = min(indent, max(self.v, width - 2 * self.v))
                    for y in range(middle, middle + self.h):
                        for x in range(left, left + indent):
                            canvas.pixels[y][x] = 0
                    self.note(
                        f"Open Ze waist shortened by {indent} left pixels, retaining the digit-3-style right-hand join."
                    )
            else:
                self.require_size(
                    box, 2 * self.v + 1, 3 * self.h + 2, "Stem and lower bowl"
                )
                bowl_top = max(
                    top + self.h + 1,
                    bottom - max(2 * self.h + 1, (height + self.h) // 2),
                )
                self.stem(canvas, left, top, bottom)
                self.right_bowl(canvas, (left, bowl_top, right, bottom), profile)
                if target == "Б":
                    self.bar(canvas, left, right, top)
        elif target == "б":
            donor = self.use("o")
            dl, dt, dr, db = donor.bbox()
            if dt - self.metrics.cap_top < self.h + 1:
                raise ConstructionError(
                    "No ascender band for the lowercase Be hook above its unchanged o body."
                )
            canvas = self.canvas(donor)
            profile = self.curve(False, "o")
            cut = 1 if profile.top_left else 0
            self.bar(canvas, dl + cut, dr, self.metrics.cap_top)
            self.stem(
                canvas,
                dl,
                self.metrics.cap_top + (self.h if cut else 0),
                dt + self.h + 1,
            )
            self.note(
                "Source o body retained; added ascender hook occupies the source ascender band."
            )
        elif target in ("Ж", "ж"):
            self.require_size(box, 3 * self.v + 2, 3 * self.h + 2, "Four-arm Zhe")
            self.stem(canvas, centre, top, bottom)
            left_port, right_port = centre - self.v, centre + self.v
            self.bar(canvas, left_port, right_port + self.v, middle)
            for port, endpoint in ((left_port, left), (right_port, right - self.v)):
                self.diagonal(canvas, port, middle, endpoint, top)
                self.diagonal(canvas, port, middle, endpoint, bottom - self.h)
            self.note(
                "K arms rebuilt to adjacent edge ports of a shared central stem; no full-bitmap overlay or overloaded centre pixel."
            )
        elif target in ("П", "п", "н", "Ц", "ц", "Ш", "ш", "Щ", "щ"):
            three = target in ("Ш", "ш", "Щ", "щ")
            self.require_size(
                box,
                (3 * self.v + 2) if three else (2 * self.v + 1),
                2 * self.h + 1,
                "Stem and bar construction",
            )
            self.stem(canvas, left, top, bottom)
            self.stem(canvas, right - self.v, top, bottom)
            if three:
                self.stem(canvas, centre, top, bottom)
            if target in ("П", "п"):
                self.bar(canvas, left, right, top)
            elif target == "н":
                self.bar(canvas, left, right, middle)
            else:
                self.bar(canvas, left, right, bottom - self.h)
            if target in ("Ц", "ц", "Щ", "щ"):
                self.descender(canvas, right - self.v)
        elif target == "м":
            self.require_size(
                box, 3 * self.v + 2, 3 * self.h + 1, "Lowercase M construction"
            )
            self.stem(canvas, left, top, bottom)
            self.stem(canvas, right - self.v, top, bottom)
            self.diagonal(canvas, left, top, centre, middle)
            self.diagonal(canvas, right - self.v, top, centre, middle)
        elif target == "т":
            self.require_size(
                box, 2 * self.v + 1, 2 * self.h + 1, "Lowercase T construction"
            )
            self.bar(canvas, left, right, top)
            self.stem(canvas, centre, top, bottom)
        elif target in ("Ч", "ч"):
            self.require_size(
                box, 2 * self.v + 1, 3 * self.h + 2, "Che cup and right stem"
            )
            profile = self.curve(upper, "U" if upper else "u")
            cup_bottom = max(top + 2 * self.h + 1, middle + self.h)
            # Open top U-shaped cup: preserve the donor bottom corner steps.
            for y in range(top, cup_bottom):
                offset = cup_bottom - 1 - y
                li = (
                    profile.bottom_left[offset]
                    if offset < len(profile.bottom_left)
                    else 0
                )
                ri = (
                    profile.bottom_right[offset]
                    if offset < len(profile.bottom_right)
                    else 0
                )
                if y >= cup_bottom - self.h:
                    self.bar(canvas, left + li, right - ri, y)
                else:
                    self.stem(canvas, left + li, y, y + 1)
                    self.stem(canvas, right - self.v - ri, y, y + 1)
            self.stem(canvas, right - self.v, top, bottom)
        elif target == "У":
            self.require_size(
                box, 2 * self.v + 1, 3 * self.h + 1, "Sloping-tail uppercase U"
            )
            self.diagonal(canvas, left, top, centre, middle)
            self.diagonal(canvas, right - self.v, top, centre, middle)
            self.diagonal(canvas, centre, middle, left, bottom - self.h)
            self.note(
                "Uppercase Y lower stem replaced by a sloping y-style tail; Latin U was not used."
            )
        elif target in ("Ф", "ф"):
            if upper:
                self.require_size(
                    box,
                    3 * self.v + 2,
                    4 * self.h + 1,
                    "Ef oval with two counters and two stem protrusions",
                )
                self.oval(
                    canvas,
                    (left, top + self.h, right, bottom - self.h),
                    self.curve(True, "O"),
                )
                self.stem(canvas, centre, top, bottom)
            else:
                donor = self.use("o")
                dl, dt, dr, db = donor.bbox()
                self.require_size(
                    (dl, dt, dr, db),
                    3 * self.v + 2,
                    2 * self.h + 1,
                    "Lowercase Ef oval with two counters around its central stem",
                )
                if dt <= self.metrics.cap_top:
                    raise ConstructionError(
                        "No ascender room above the lowercase Ef oval."
                    )
                if self.metrics.baseline + self.h > self.font.height:
                    raise ConstructionError(
                        "No descender room below the lowercase Ef oval."
                    )
                canvas = self.canvas(donor)
                self.stem(
                    canvas,
                    dl + (dr - dl - self.v) // 2,
                    self.metrics.cap_top,
                    self.metrics.baseline + self.h,
                )
                self.note(
                    "Source o body retained; centre stem uses both ascender and descender bands."
                )
            counters = _counter_count(canvas.bitmap())
            if counters != 2:
                raise ConstructionError(
                    f"Ef needs two separated counters; the fitted oval and central stem produce {counters}. No filled-counter fallback applied."
                )
        elif target in ("Ю", "ю"):
            self.require_size(
                box, 3 * self.v + 2, 2 * self.h + 1, "Yu stem, gap and oval counter"
            )
            oval_left = left + self.v + 1
            self.stem(canvas, left, top, bottom)
            self.oval(
                canvas,
                (oval_left, top, right, bottom),
                self.curve(upper, "O" if upper else "o"),
            )
            self.bar(canvas, left + self.v, oval_left + self.v, middle)
            self.note(
                "O/o oval rebuilt narrower without thinning strokes; only the left H/n stem and bridge are retained."
            )
        elif target == "я":
            self.require_size(
                box, 2 * self.v + 1, 3 * self.h + 2, "Reversed R bowl and leg"
            )
            bowl_bottom = max(top + 2 * self.h + 1, middle + self.h)
            right_profile = self.curve(False, "R")
            profile = CurveProfile(
                right_profile.top_right, (), right_profile.bottom_right, (), "R"
            )
            self.oval(canvas, (left, top, right, bowl_bottom), profile)
            self.stem(canvas, right - self.v, top, bottom)
            self.diagonal(
                canvas, right - self.v, bowl_bottom - self.h, left, bottom - self.h
            )
        else:
            raise ConstructionError(f"No structural recipe registered for {target!r}.")
        result = canvas.bitmap()
        if not result.count():
            raise ConstructionError("Recipe produced no ink.")
        return result, "generated", recipe


def generate(
    font: Font, mode: str = "compact", overwrite: bool = False
) -> tuple[Font, dict]:
    """Return a new font and deterministic, JSON-serializable provenance report."""
    if mode not in ("compact", "strict"):
        raise ValueError("mode must be 'compact' or 'strict'")
    font.validate()
    output = dict(font.glyphs)
    entries: dict[str, dict] = {}
    all_preserved = not overwrite and all(char in output for char in UK_ALPHABET)
    style = None if all_preserved else estimate_style(font)
    for char in UK_ALPHABET:
        entry = {
            "status": "unresolved",
            "recipe": "",
            "donors": [],
            "adaptations": [],
            "warnings": [],
            "errors": [],
        }
        if char in output and not overwrite:
            entry.update(status="preserved", recipe="existing target bitmap retained")
            if not output[char].count():
                entry["warnings"].append(
                    "Existing target is blank; preservation does not certify its visual quality."
                )
            entries[char] = entry
            continue
        if overwrite:
            output.pop(char, None)
        builder = Builder(font, output, style, mode)
        try:
            bitmap, status, recipe = builder.build(char)
            if bitmap.width != font.width or bitmap.height != font.height:
                raise ConstructionError("Recipe changed fixed cell dimensions.")
            output[char] = bitmap
            entry.update(status=status, recipe=recipe)
        except (ConstructionError, ValueError) as exc:
            entry["recipe"] = RECIPE_NAMES.get(char, "exact alias or local reflection")
            entry["errors"].append(str(exc))
        entry["donors"] = list(builder.donors)
        entry["adaptations"] = list(builder.adaptations)
        entry["warnings"] = list(builder.warnings)
        entries[char] = entry
    for upper, lower in zip(UK_UPPER, UK_LOWER):
        if (
            upper in output
            and lower in output
            and output[upper] == output[lower]
            and (
                entries[upper]["status"] != "preserved"
                or entries[lower]["status"] != "preserved"
            )
        ):
            warning = f"Uppercase/lowercase pair {upper}/{lower} converges to the same bitmap at this grid; inspect the reported compact adaptations."
            entries[upper]["warnings"].append(warning)
            entries[lower]["warnings"].append(warning)
    counts = Counter(entry["status"] for entry in entries.values())
    report = {
        "mode": mode,
        "overwrite": overwrite,
        "metrics": (
            {
                "baseline": style.metrics.baseline,
                "cap_top": style.metrics.cap_top,
                "x_top": style.metrics.x_top,
            }
            if style
            else (
                {
                    "baseline": font.metrics.baseline,
                    "cap_top": font.metrics.cap_top,
                    "x_top": font.metrics.x_top,
                }
                if font.metrics
                else None
            )
        ),
        "style": style.report()
        if style
        else {"not_estimated": "all Ukrainian targets already present and preserved"},
        "glyphs": entries,
        "summary": {
            status: counts.get(status, 0)
            for status in ("preserved", "copied", "generated", "unresolved")
        },
        "complete": counts.get("unresolved", 0) == 0,
        "limitations": [
            "Copy/reflection recipes preserve donor pixels; structural recipes preserve measured strokes, anchors and discrete corner profiles, not every optical detail.",
            "Triangular El/De and upright lowercase forms are the implemented construction policy; cursive and language-local alternates are outside v0.1.",
            "Diagonal paths use deterministic integer rasterization and measured stroke brush; donor-specific diagonal phase and optical compensation are not inferred.",
            "Metric and width estimation is heuristic when input metrics are absent; inspect the reported measurements.",
        ],
    }
    result = Font(
        font.width,
        font.height,
        output,
        style.metrics if style else font.metrics,
        font.name,
        notes=list(getattr(font, "notes", [])),
    )
    result.validate()
    return result, report
