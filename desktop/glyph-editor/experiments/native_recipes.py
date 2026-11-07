"""Native PFI adapter with bounded per-font recipe cache and Latin-only lineage."""

import hashlib
import json
from collections import OrderedDict

import numpy as np
from recipe_engine.bitmap import Bitmap
from recipe_engine.fragments import alternatives
from recipe_engine.model import UK_ALPHABET, Font, Metrics
from recipe_engine.style import estimate_style
from recipe_engine.synthesis import generate

from data import pixels

VERSION = "native-recipes-v1"
# Explicit Unicode labels only: no guessing code pages or borrowing hidden targets.
DONORS = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.ÏïËëÜüÖöÄäÿĂăĞğŬŭ"
)


class NativeRecipes:
    def __init__(self, capacity=4):
        self.capacity = capacity
        self.cache = OrderedDict()
        self.builds = 0

    def prepare(self, request, provided):
        target = request["target"]
        width, height = target["width"], target["height"]
        policy = request.get("recipeMode", "strict")
        if policy not in ("strict", "compact"):
            raise ValueError("Recipe mode must be strict or compact")
        if not 3 <= width <= 64 or not 5 <= height <= 64:
            return (
                None,
                "Рецепти підтримують сітки 3–64 × 5–64 px; доступний retrieval.",
            )
        style = request.get("referenceFont", request["font"])
        if (style["cell"]["width"], style["cell"]["height"]) != (width, height):
            return (
                None,
                "Рецепти потребують однакової сітки референсу й цілі, без масштабування.",
            )
        source = {c: g for c, g in provided.items() if c in DONORS}
        frame = {"width": width, "height": height, "metrics": target["metrics"]}
        key = hashlib.sha256(
            json.dumps(
                [
                    source,
                    frame,
                    style.get("metrics"),
                    policy,
                    request.get("recipeUseGuides", False),
                ],
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key], None
        glyphs, rejected = {}, []
        for c, g in source.items():
            dx = g["metrics"]["leftBearing"] - target["metrics"]["leftBearing"]
            dy = (
                height
                + target["metrics"]["shiftUp"]
                - g["height"]
                - g["metrics"]["shiftUp"]
            )
            if dx != round(dx) or dy != round(dy):
                rejected.append(c + ": fractional alignment")
                continue
            dx, dy = round(dx), round(dy)
            matrix = pixels(g)
            coords = np.argwhere(matrix)
            if not len(coords):
                continue
            if any(
                not (0 <= x + dx < width and 0 <= y + dy < height) for y, x in coords
            ):
                rejected.append(c + ": alignment would clip ink")
                continue
            aligned = np.zeros((height, width), np.uint8)
            for y, x in coords:
                aligned[y + dy, x + dx] = 1
            glyphs[c] = Bitmap.from_matrix(aligned.tolist())
        if not glyphs:
            return None, "Немає придатних латинських донорів без обрізання растра."
        metrics = style.get("metrics", {})
        baseline = metrics.get("baseline")
        cap = metrics.get("capHeight")
        xheight = metrics.get("xHeight")
        # PFI metrics are cell boundaries; only complete integer guides can be
        # transferred without inventing rounding. Other cases infer from ink.
        guides = None
        if request.get("recipeUseGuides") and all(
            type(n) in (int, float) and n == int(n) for n in (baseline, cap, xheight)
        ):
            aligned_base = baseline
            if aligned_base != int(aligned_base):
                return None, "Гайди не вирівняно до цілих пікселів."
            aligned_base = int(aligned_base)
            if 0 < xheight <= cap <= aligned_base <= height:
                guides = Metrics(
                    aligned_base, aligned_base - int(cap), aligned_base - int(xheight)
                )
        font = Font(width, height, glyphs, metrics=guides)
        output, report = generate(font, mode=policy)
        measured = estimate_style(font)
        # Include every actual input measurement donor in lineage, also when
        # a generated intermediate (e.g. И -> Й) is used by a later recipe.
        profile_donors = set(
            measured.stroke_donors
            + measured.cap_bound_donors
            + measured.lower_bound_donors
            + measured.waist_donors
        )
        profile_donors.update(
            c for c in (measured.cap_curve.donor, measured.lower_curve.donor) if c
        )

        def resolve(chars, visited=None):
            visited = set() if visited is None else visited
            result = set()
            for c in chars:
                if c in visited:
                    continue
                visited.add(c)
                if c in glyphs:
                    result.add(c)
                elif c in report["glyphs"]:
                    result.update(resolve(report["glyphs"][c]["donors"], visited))
            return sorted(result)

        choices = {}
        for c in UK_ALPHABET:
            entry = report["glyphs"][c]
            variants = []
            try:
                fragments = list(alternatives(c, font, measured, output))
            except ValueError:
                fragments = []
            if c in output.glyphs:
                fragments.append(
                    (
                        output.glyphs[c],
                        entry["donors"],
                        "measured-construction",
                        entry["adaptations"],
                    )
                )
            seen = set()
            for bmp, donors, recipe, adaptations in fragments:
                if bmp.rows in seen or not bmp.count():
                    continue
                seen.add(bmp.rows)
                actual = resolve(donors)
                if not actual:
                    continue
                lineage = sorted(set(actual) | profile_donors)
                info = {
                    "version": VERSION,
                    "id": recipe,
                    "policy": policy,
                    "description": entry["recipe"]
                    if recipe == "measured-construction"
                    else recipe,
                    "donors": actual,
                    "adaptations": adaptations,
                    "warnings": list(
                        entry["warnings"] if recipe == "measured-construction" else []
                    )
                    + list(measured.warnings)
                    + rejected,
                    "metrics": report["metrics"],
                    "metricsSource": measured.metrics_source,
                    "verticalStroke": measured.vertical_stroke,
                    "horizontalStroke": measured.horizontal_stroke,
                    "capWaist": measured.cap_waist,
                    "lowerWaist": measured.lower_waist,
                }
                variants.append(
                    (np.asarray(bmp.to_matrix(), dtype=np.uint8), actual, lineage, info)
                )
            choices[c] = {"variants": variants, "errors": entry["errors"]}
        value = choices
        self.cache[key] = value
        self.cache.move_to_end(key)
        while len(self.cache) > self.capacity:
            self.cache.popitem(last=False)
        self.builds += 1
        return value, None

    def candidates(self, request, provided):
        choices, reason = self.prepare(request, provided)
        if choices is None:
            return [], {"status": "unavailable", "reason": reason}
        choice = choices.get(request["character"])
        if choice is None:
            return [], {
                "status": "unavailable",
                "reason": "Рецепти призначено для української абетки.",
            }
        variants = choice["variants"]
        return variants, {
            "status": "available" if variants else "unresolved",
            "reason": " ".join(choice["errors"]) if not variants else "",
            "policy": request.get("recipeMode", "strict"),
        }
