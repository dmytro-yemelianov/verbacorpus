"""Deterministic measurements of a small upright, one-bit source font.

These are deliberately inspectable measurements, not a font classifier.  The
generator records weak fallbacks and individual recipes still require donors.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from statistics import median_low

from .bitmap import Bitmap
from .model import Font, Metrics


def _mode(values: list[int], default: int) -> int:
    if not values:
        return default
    counts = Counter(values)
    return min(counts, key=lambda value: (-counts[value], value))


def _runs(values: list[int]) -> list[int]:
    result: list[int] = []
    length = 0
    for bit in values + [0]:
        if bit:
            length += 1
        elif length:
            result.append(length)
            length = 0
    return result


def _available(font: Font, chars: str) -> list[tuple[str, Bitmap]]:
    return [
        (char, font.glyphs[char])
        for char in chars
        if char in font.glyphs and font.glyphs[char].bbox() is not None
    ]


@dataclass(frozen=True)
class CurveProfile:
    """Outer contour insets in pixel rows, from a donor's four corners.

    Only the rows before the straight side are stored.  An empty tuple means
    a square corner.  New small bowls keep these integer corner steps; they
    never interpolate grey pixels or uniformly shrink stroke thickness.
    """

    top_left: tuple[int, ...] = ()
    top_right: tuple[int, ...] = ()
    bottom_left: tuple[int, ...] = ()
    bottom_right: tuple[int, ...] = ()
    donor: str | None = None

    def report(self) -> dict:
        return {
            "donor": self.donor,
            "top_left": list(self.top_left),
            "top_right": list(self.top_right),
            "bottom_left": list(self.bottom_left),
            "bottom_right": list(self.bottom_right),
        }


def curve_profile(bitmap: Bitmap, donor: str | None = None) -> CurveProfile:
    bounds = bitmap.bbox()
    if bounds is None:
        return CurveProfile(donor=donor)
    x0, y0, x1, y1 = bounds
    depth = max(1, (y1 - y0) // 2)

    def read(bottom: bool, right: bool) -> tuple[int, ...]:
        result: list[int] = []
        for offset in range(depth):
            y = y1 - 1 - offset if bottom else y0 + offset
            occupied = [x for x in range(x0, x1) if bitmap.get(x, y)]
            if not occupied:
                break
            inset = x1 - 1 - max(occupied) if right else min(occupied) - x0
            if inset <= 0:
                break
            result.append(inset)
        return tuple(result)

    return CurveProfile(
        read(False, False),
        read(False, True),
        read(True, False),
        read(True, True),
        donor,
    )


@dataclass(frozen=True)
class Style:
    metrics: Metrics
    metrics_source: str
    vertical_stroke: int
    horizontal_stroke: int
    stroke_donors: tuple[str, ...]
    cap_bounds: tuple[int, int]
    lower_bounds: tuple[int, int]
    cap_bound_donors: tuple[str, ...]
    lower_bound_donors: tuple[str, ...]
    cap_curve: CurveProfile
    lower_curve: CurveProfile
    warnings: tuple[str, ...]
    cap_waist: int
    lower_waist: int
    waist_donors: tuple[str, ...]

    def report(self) -> dict:
        return {
            "metrics": {
                "baseline": self.metrics.baseline,
                "cap_top": self.metrics.cap_top,
                "x_top": self.metrics.x_top,
                "source": self.metrics_source,
            },
            "vertical_stroke": self.vertical_stroke,
            "horizontal_stroke": self.horizontal_stroke,
            "stroke_donors": list(self.stroke_donors),
            "cap_ink_bounds": list(self.cap_bounds),
            "lower_ink_bounds": list(self.lower_bounds),
            "cap_bound_donors": list(self.cap_bound_donors),
            "lower_bound_donors": list(self.lower_bound_donors),
            "cap_curve": self.cap_curve.report(),
            "lower_curve": self.lower_curve.report(),
            "warnings": list(self.warnings),
            "cap_waist": self.cap_waist,
            "lower_waist": self.lower_waist,
            "waist_donors": list(self.waist_donors),
            "scope": "upright one-bit construction; no automatic italic or optical classification",
        }


def estimate_style(font: Font) -> Style:
    warnings: list[str] = []
    cap_sources = _available(font, "HINEMFTLKRPBOAXVCUSYZ")
    lower_sources = _available(font, "nxoeacumsvwzr")
    any_sources = [
        (char, bmp)
        for char, bmp in sorted(font.glyphs.items())
        if bmp.bbox() is not None
    ]

    if font.metrics is not None:
        metrics = font.metrics
        metric_source = "input"
    else:
        baseline_sources = cap_sources + lower_sources
        if baseline_sources:
            baseline = _mode(
                [bmp.bbox()[3] for _, bmp in baseline_sources], font.height - 1
            )
        elif any_sources:
            baseline = _mode([bmp.bbox()[3] for _, bmp in any_sources], font.height - 1)
            warnings.append(
                "Baseline inferred from unclassified glyph bounds; verify manually."
            )
        else:
            baseline = max(1, font.height - 1)
            warnings.append(
                "No ink to measure baseline; provisional metric used only for unresolved reporting."
            )
        if cap_sources:
            cap_top = _mode([bmp.bbox()[1] for _, bmp in cap_sources], 0)
        elif lower_sources:
            cap_top = min(bmp.bbox()[1] for _, bmp in lower_sources)
            warnings.append(
                "No capital donor; cap top provisionally follows lowercase bounds."
            )
        else:
            cap_top = min((bmp.bbox()[1] for _, bmp in any_sources), default=0)
            warnings.append("No standard capital donor for cap-top estimation.")
        cap_top = max(0, min(cap_top, baseline - 1))
        if lower_sources:
            x_top = _mode([bmp.bbox()[1] for _, bmp in lower_sources], cap_top)
        else:
            x_top = cap_top + max(0, (baseline - cap_top) // 3)
            warnings.append(
                "No x-height donor; x top is a declared provisional one-third cap-height offset."
            )
        x_top = max(cap_top, min(x_top, baseline - 1))
        metrics = Metrics(baseline=baseline, cap_top=cap_top, x_top=x_top)
        metric_source = "inferred from source bitmap bounds"

    # Multiple separate runs isolate stems from long bars, and horizontal
    # strokes from long vertical stems.  O/o and H are particularly useful.
    measured = _available(font, "HOnoUEFBIu")
    vertical: list[int] = []
    horizontal: list[int] = []
    used: list[str] = []
    for char, bmp in measured:
        x0, y0, x1, y1 = bmp.bbox()
        own_v: list[int] = []
        own_h: list[int] = []
        for y in range(y0, y1):
            runs = _runs([bmp.get(x, y) for x in range(x0, x1)])
            if len(runs) >= 2:
                own_v.extend(runs)
        for x in range(x0, x1):
            runs = _runs([bmp.get(x, y) for y in range(y0, y1)])
            if len(runs) >= 2:
                own_h.extend(runs)
        if own_v or own_h:
            used.append(char)
            vertical.extend(own_v)
            horizontal.extend(own_h)
    if not vertical:
        for _, bmp in any_sources:
            for row in bmp.to_matrix():
                vertical.extend(_runs(row))
        warnings.append(
            "Vertical stroke estimate has no isolated-stem evidence; uses minimum observed horizontal ink run."
        )
        v = min(vertical, default=1)
    else:
        v = _mode(vertical, 1)
    if not horizontal:
        for _, bmp in any_sources:
            for x in range(bmp.width):
                horizontal.extend(_runs([bmp.get(x, y) for y in range(bmp.height)]))
        warnings.append(
            "Horizontal stroke estimate has no isolated-bar evidence; uses minimum observed vertical ink run."
        )
        h = min(horizontal, default=1)
    else:
        h = _mode(horizontal, 1)

    def bounds(
        sources: list[tuple[str, Bitmap]], kind: str
    ) -> tuple[tuple[int, int], tuple[str, ...]]:
        selected = sources or cap_sources or lower_sources or any_sources
        if not sources:
            warnings.append(
                f"No standard {kind} width donor; shared ink bounds are provisional."
            )
        if selected:
            left = median_low(sorted(bmp.bbox()[0] for _, bmp in selected))
            right = median_low(sorted(bmp.bbox()[2] for _, bmp in selected))
            if right > left:
                return (left, right), tuple(char for char, _ in selected)
        return (1, font.width - 1), ()

    cap_bounds, cap_bound_donors = bounds(_available(font, "HNOABEKMPRX"), "capital")
    lower_bounds, lower_bound_donors = bounds(
        _available(font, "noaexucmp"), "lowercase"
    )

    def profile(chars: str, kind: str) -> CurveProfile:
        candidates = _available(font, chars)
        if not candidates:
            warnings.append(
                f"No curved {kind} donor; square corners are an explicit fallback for structural recipes only."
            )
            return CurveProfile()
        char, bmp = candidates[0]
        return curve_profile(bmp, char)

    cap_curve = profile("OoQCcBP", "capital")
    lower_curve = profile("oOcCQbpB", "lowercase")
    waist_donors = []

    def waist(chars, top):
        for char, bmp in _available(font, chars):
            box = bmp.bbox()
            candidates = list(
                range(max(top + h, box[1] + h), min(metrics.baseline - h, box[3] - h))
            )
            if candidates:
                centre = top + (metrics.baseline - top - h) // 2
                # H/E/e probe: densest interior source scanline, stable centre tie-break.
                row = min(
                    candidates,
                    key=lambda y: (-bin(bmp.rows[y]).count("1"), abs(y - centre), y),  # noqa: FURB161 - Python 3.9 runtime
                )
                waist_donors.append(char)
                return row
        return top + (metrics.baseline - top - h) // 2

    cap_waist, lower_waist = waist("HE", metrics.cap_top), waist("e", metrics.x_top)
    return Style(
        metrics,
        metric_source,
        v,
        h,
        tuple(used),
        cap_bounds,
        lower_bounds,
        cap_bound_donors,
        lower_bound_donors,
        cap_curve,
        lower_curve,
        tuple(warnings),
        cap_waist,
        lower_waist,
        tuple(waist_donors),
    )
