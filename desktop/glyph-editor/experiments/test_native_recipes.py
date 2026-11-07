import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from infer import Generator
from native_recipes import NativeRecipes
from recipe_engine.bitmap import Bitmap
from recipe_engine.fragments import repeat_fit
from recipe_engine.model import UK_ALPHABET, Font, Metrics
from recipe_engine.recipes import COPY_MAP
from recipe_engine.style import estimate_style
from recipe_engine.synthesis import _counter_count, generate

from data import rows


def fixture(name="square-8x16"):
    raw = json.loads(
        (Path(__file__).parent / "fixtures/recipes" / (name + ".json")).read_text()
    )
    w, h = raw["cell"]["width"], raw["cell"]["height"]
    glyphs = {
        c: Bitmap(w, h, tuple(int(row, 16) for row in values))
        for c, values in raw["glyphs"].items()
    }
    return Font(w, h, glyphs, Metrics(**raw["metrics"]))


def request(font=None, char="Ї"):
    font = font or fixture()
    metrics = font.metrics
    identity = {
        "id": "test-font",
        "sha256": "a" * 64,
        "cell": {"width": font.width, "height": font.height},
        "metrics": {
            "baseline": metrics.baseline,
            "capHeight": metrics.cap_height,
            "xHeight": metrics.x_height,
        },
    }
    refs = [
        {
            "id": f"g{i:06d}",
            "width": font.width,
            "height": font.height,
            "rowBytes": (font.width + 7) // 8,
            "rows": rows(np.array(g.to_matrix())),
            "metrics": {"leftBearing": 0, "shiftUp": 0},
            "labels": [{"kind": "unicode", "value": c}],
        }
        for i, (c, g) in enumerate(font.glyphs.items())
        if c.isascii() and (c.isalpha() or c in "36.") and g.count()
    ]
    return {
        "snapshot": "b" * 64,
        "font": identity,
        "referenceFont": identity,
        "references": refs,
        "target": {
            **copy.deepcopy(refs[0]),
            "id": "g999999",
            "labels": [],
            "rows": ["00" * ((font.width + 7) // 8)] * font.height,
        },
        "character": char,
        "revision": 0,
        "count": 8,
        "mode": "native",
        "preferLatin": True,
        "targetSignature": "fixture",
    }


class NativeRecipeTests(unittest.TestCase):
    def test_original_eight_style_height_fixtures_have_complete_compact_results(self):
        for name in ("square", "cut"):
            for height in (8, 12, 14, 16):
                with self.subTest(style=name, height=height):
                    font = fixture(f"{name}-8x{height}")
                    before = copy.deepcopy(font.glyphs)
                    output, report = generate(font, "compact")
                    self.assertEqual(report["summary"]["unresolved"], 0)
                    self.assertEqual(font.glyphs, before)
                    self.assertTrue(all(c in output.glyphs for c in UK_ALPHABET))
                    for c in ("Ф", "ф"):
                        self.assertEqual(_counter_count(output.glyphs[c]), 2)

    def test_missing_dependencies_are_reported_instead_of_invented(self):
        font = fixture()
        font.glyphs = {"H": font.glyphs["H"]}
        output, report = generate(font, "strict")
        for c in ("Я", "Ю", "Й", "Ї", "Ж"):
            self.assertNotIn(c, output.glyphs)
            self.assertTrue(report["glyphs"][c]["errors"])

    def test_integer_font_guides_override_automatic_measurement(self):
        req = request(char="Є")
        req["recipeUseGuides"] = True
        req["font"]["metrics"].update({"capHeight": 10, "xHeight": 6})
        req["target"]["metrics"]["shiftUp"] = -3
        for g in req["references"]:
            g["metrics"]["shiftUp"] = -3
        result = Generator(native_only=True).candidates(req)
        recipe = next(
            c["recipe"] for c in result["candidates"] if c["method"] == "recipe"
        )
        self.assertEqual(recipe["metrics"], {"baseline": 13, "cap_top": 3, "x_top": 7})

    def test_untrusted_source_guides_cannot_shorten_latin_anchors(self):
        req = request(char="Є")
        req["font"]["metrics"].update({"baseline": 11, "capHeight": 7, "xHeight": 4})
        result = Generator(native_only=True).candidates(req)
        recipe = next(
            c["recipe"] for c in result["candidates"] if c["method"] == "recipe"
        )
        self.assertEqual(recipe["metrics"]["baseline"], fixture().metrics.baseline)
        self.assertIn("inferred", recipe["metricsSource"])

    def test_exact_homograph_never_silently_clips_ink(self):
        req = request(char="А")
        a = next(g for g in req["references"] if g["labels"][0]["value"] == "A")
        a["metrics"]["leftBearing"] = 100
        result = Generator(native_only=True).candidates(req)
        self.assertEqual(result["candidates"], [])

    def test_exact_homographs_and_original_donors_remain_identical(self):
        font = fixture()
        before = dict(font.glyphs)
        generated, report = generate(font, mode="strict")
        self.assertEqual(font.glyphs, before)
        for c, latin in COPY_MAP.items():
            self.assertEqual(generated.glyphs[c], font.glyphs[latin])
            self.assertEqual(report["glyphs"][c]["status"], "copied")

    def test_native_mode_never_loads_dataset_or_neural_model(self):
        with patch("infer.Dataset", side_effect=AssertionError("dataset loaded")):
            engine = Generator(native_only=True)
            result = engine.candidates(request(char="А"))
        self.assertEqual(result["candidates"][0]["method"], "homograph")
        self.assertTrue(
            all(c["method"] in ("homograph", "recipe") for c in result["candidates"])
        )

    def test_policy_is_explicit_and_strict_refuses_diacritic_clipping(self):
        font = fixture("cut-8x8")
        strict, a = generate(font, "strict")
        compact, b = generate(font, "compact")
        self.assertNotIn("Ї", strict.glyphs)
        self.assertTrue(a["glyphs"]["Ї"]["errors"])
        self.assertIn("Ї", compact.glyphs)
        self.assertTrue(b["glyphs"]["Ї"]["adaptations"])

    def test_real_pfi_cell_metadata_does_not_block_recipe_domain(self):
        req = request(char="Ж")
        req["font"]["cell"].update(
            {"monospace": True, "pixelAspectRatio": {"x": 1, "y": 1}}
        )
        self.assertTrue(Generator(native_only=True).candidates(req)["candidates"])

    def test_no_latin_or_wrong_case_is_not_a_generation_reference(self):
        engine = Generator(native_only=True)
        req = request(char="ї")
        req["references"] = [
            g for g in req["references"] if g["labels"][0]["value"].isupper()
        ]
        with self.assertRaisesRegex(ValueError, "lowercase Latin"):
            engine.candidates(req)
        req["references"][0]["labels"] = [{"kind": "unicode", "value": "Η"}]
        req["references"] = req["references"][:1]
        with self.assertRaisesRegex(ValueError, "Latin"):
            engine.candidates(req)

    def test_widths_above_one_byte_keep_cell_and_padding(self):
        font = fixture()
        widened = Font(
            13,
            16,
            {
                c: Bitmap(13, 16, tuple(row << 4 for row in bmp.rows))
                for c, bmp in font.glyphs.items()
            },
            font.metrics,
        )
        result = Generator(native_only=True).candidates(request(widened, "Ж"))
        self.assertTrue(result["candidates"])
        for c in result["candidates"]:
            self.assertEqual((c["width"], c["rowBytes"]), (13, 2))
            self.assertTrue(all(int(row, 16) & 7 == 0 for row in c["rows"]))

    def test_cache_reused_across_letters_and_bounded_and_revision_sensitive(self):
        engine = Generator(native_only=True)
        req = request()
        a = engine.candidates(req)
        req["character"] = "Ж"
        engine.candidates(req)
        self.assertEqual(engine.recipes.builds, 1)
        for i in range(7):
            req["references"][0]["rows"][0] = "%02X" % (i + 1)
            engine.candidates(req)
        self.assertLessEqual(len(engine.recipes.cache), 4)
        self.assertEqual(engine.candidates(request())["candidates"], a["candidates"])

    def test_clipping_and_fractional_alignment_rejected_by_recipe_adapter(self):
        req = request()
        for g in req["references"]:
            g["metrics"]["leftBearing"] = 100
        provided = {g["labels"][0]["value"]: g for g in req["references"]}
        variants, status = NativeRecipes().candidates(req, provided)
        self.assertEqual(variants, [])
        self.assertEqual(status["status"], "unavailable")
        for g in req["references"]:
            g["metrics"]["leftBearing"] = 0.5
        self.assertEqual(NativeRecipes().candidates(req, provided)[0], [])

    def test_provenance_contains_only_real_input_donors_and_replay_is_deterministic(
        self,
    ):
        engine = Generator(native_only=True)
        req = request(char="Й")
        req["recipeMode"] = "compact"
        before = copy.deepcopy(req)
        a, b = engine.candidates(req), engine.candidates(req)
        self.assertEqual(req, before)
        self.assertEqual(a["candidates"], b["candidates"])
        ids = {g["id"] for g in req["references"]}
        self.assertTrue(a["candidates"])
        for c in a["candidates"]:
            self.assertTrue(set(c["references"]) <= ids)
            self.assertEqual(c["sourceSha256"], req["font"]["sha256"])
            if c["method"] == "recipe":
                self.assertTrue(all(d.isascii() for d in c["recipe"]["donors"]))

    def test_fragment_reflow_removes_duplicates_only(self):
        source = Bitmap(5, 7, (31, 17, 17, 31, 17, 17, 31))
        fitted = repeat_fit(source, 5, 5)
        self.assertEqual(fitted.rows, (31, 17, 31, 17, 31))
        with self.assertRaisesRegex(ValueError, "No repeated"):
            repeat_fit(source, 5, 4)
        self.assertEqual(_counter_count(source), _counter_count(fitted))

    def test_gemini_crossbar_probe_uses_source_row_not_midpoint(self):
        bmp = Bitmap(8, 10, (0, 0x42, 0x7E, 0x42, 0x42, 0x42, 0x42, 0x42, 0, 0))
        style = estimate_style(Font(8, 10, {"H": bmp}, Metrics(8, 1, 4)))
        self.assertEqual(style.cap_waist, 2)
        self.assertIn("H", style.waist_donors)

    def test_source_latinate_diaeresis_is_used(self):
        req = request(char="Ї")
        donor = copy.deepcopy(req["references"][0])
        donor["id"] = "g888888"
        donor["labels"] = [{"kind": "unicode", "value": "Ï"}]
        req["references"].append(donor)
        c = Generator(native_only=True).candidates(req)["candidates"][0]
        self.assertEqual(c["recipe"]["id"], "native-latin-diaeresis")
        self.assertEqual(c["rows"], donor["rows"])

    def test_oversize_domain_is_explained_not_silently_resampled(self):
        req = request(char="Ж")
        req["target"]["width"] = 65
        req["target"]["rowBytes"] = 9
        req["target"]["rows"] = ["00" * 9] * 16
        result = Generator(native_only=True).candidates(req)
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["recipeStatus"]["status"], "unavailable")

    def test_all_letters_keep_dimensions_and_two_counter_ef(self):
        font = fixture()
        output, report = generate(font, "compact")
        self.assertEqual(set(report["glyphs"]), set(UK_ALPHABET))
        for c in UK_ALPHABET:
            if c in output.glyphs:
                self.assertEqual(
                    (output.glyphs[c].width, output.glyphs[c].height), (8, 16)
                )
        for c in "Фф":
            self.assertEqual(_counter_count(output.glyphs[c]), 2)


if __name__ == "__main__":
    unittest.main()
