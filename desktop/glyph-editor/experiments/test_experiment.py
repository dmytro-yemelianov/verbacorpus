import copy
import json
import unittest
from pathlib import Path

import numpy as np

from data import Dataset, denormalize, normalize, pixels, rows


class BitmapExperimentTests(unittest.TestCase):
    def test_native_round_trip_and_padding(self):
        g = {
            "width": 5,
            "height": 3,
            "rowBytes": 1,
            "rows": ["A8", "50", "F8"],
            "metrics": {"leftBearing": 0, "shiftUp": -1},
        }
        font = {"cell": {"width": 5, "height": 3}, "metrics": {"baseline": 2}}
        self.assertEqual(rows(pixels(g)), g["rows"])
        self.assertTrue(
            np.array_equal(denormalize(normalize(g, font), g, font), pixels(g))
        )
        self.assertTrue(all(int(r, 16) & 7 == 0 for r in rows(pixels(g))))

    def test_bearings_baseline_and_outside_cell_are_explicit(self):
        g = {
            "width": 3,
            "height": 3,
            "rowBytes": 1,
            "rows": ["E0"] * 3,
            "metrics": {"leftBearing": -1, "shiftUp": 0},
        }
        font = {"cell": {"width": 4, "height": 4}, "metrics": {"baseline": 3}}
        recovered = denormalize(normalize(g, font), g, font)
        self.assertEqual(recovered[:, 0].sum(), 0)
        self.assertEqual(recovered[:, 1:].sum(), 6)

    def test_collapsed_neural_shapes_are_rejected_without_touching_retrieval(self):
        from data import structurally_usable

        structure = np.ones((5, 5), dtype=np.uint8)
        self.assertTrue(structurally_usable(structure, structure))
        collapsed = np.zeros_like(structure)
        collapsed[2, 2] = 1
        self.assertFalse(structurally_usable(collapsed, structure))

    def test_request_rejects_unbounded_dimensions_and_nonfinite_metrics(self):
        from request import validate_request

        with self.assertRaises(ValueError):
            validate_request({"snapshot": "bad"})
        font = {
            "id": "test",
            "sha256": "a" * 64,
            "cell": {"width": 1000, "height": 8},
            "metrics": {"baseline": 7},
        }
        with self.assertRaises(ValueError):
            validate_request({"snapshot": "b" * 64, "font": font})

    def test_training_and_test_families_and_latin_duplicates_do_not_overlap(self):
        path = Path(__file__).parent.parent / ".build/style-transfer"
        if not (path / "manifest.json").exists():
            self.skipTest("Prepare the local dataset first")
        ds = Dataset(path)
        self.assertFalse(
            {ds.fonts[i]["group"] for i in ds.train}
            & {ds.fonts[i]["group"] for i in ds.test}
        )
        train_signatures = {ds.images[i, :52].tobytes() for i in ds.train}
        self.assertTrue(
            all(ds.images[i, :52].tobytes() not in train_signatures for i in ds.test)
        )
        for i in ds.test:
            refs = ds.references(i, "Ї")
            self.assertTrue(
                all(
                    ds.fonts[j]["split"] == "train"
                    for _, j in ds.rank(refs, "Ї", ds.fonts[i]["group"])
                )
            )

    def test_hidden_target_bitmap_does_not_influence_candidates(self):
        path = Path(__file__).parent.parent / ".build/style-transfer"
        if not (path / "cnn.pt").exists():
            self.skipTest("Train the optional local CNN first")
        from infer import Generator

        generator = Generator(path)
        f = next(f for f in generator.ds.fonts if f["id"] == "cozette-13x15")
        corpus = Path(__file__).resolve().parents[3] / "app"
        record = json.loads((corpus / "public" / f["url"].lstrip("/")).read_text())
        by = {g["character"]: g for g in record["glyphs"] if g["character"]}
        target = copy.deepcopy(by["Ї"])
        request = {
            "snapshot": generator.ds.meta["snapshot"],
            "font": f,
            "target": target,
            "references": [by[c] for c in "Hxonkp"],
            "character": "Ї",
            "count": 8,
            "revision": 0,
            "targetSignature": "test",
        }
        a = generator.candidates(request, evaluation=True)
        target["rows"] = ["00" * target["rowBytes"]] * target["height"]
        b = generator.candidates(request, evaluation=True)
        self.assertEqual(a["candidates"], b["candidates"])
        self.assertTrue(
            all(
                c["sourceFontId"] not in generator.training["testFontIds"]
                for c in a["candidates"]
            )
        )


class ReferenceWorkflowTests(unittest.TestCase):
    def test_region_import_honors_mask_and_explicit_character(self):
        import base64

        from reference_import import import_reference

        region = {
            "format": "para-glyph-region",
            "width": 3,
            "height": 2,
            "rowBytes": 1,
            "rows": ["E0", "A0"],
            "maskRows": ["40", "A0"],
            "bitmap": {"encoding": "hex-rows"},
        }
        r = import_reference(
            {
                "name": "glyph.json",
                "data": base64.b64encode(json.dumps(region).encode()).decode(),
                "characters": "Ж",
            }
        )
        self.assertEqual(r["glyphs"][0]["rows"], ["40", "A0"])
        self.assertEqual(r["glyphs"][0]["character"], "Ж")
        with self.assertRaises(ValueError):
            import_reference(
                {
                    "name": "glyph.json",
                    "data": base64.b64encode(json.dumps(region).encode()).decode(),
                    "characters": "ЖЮ",
                }
            )

    def test_bdf_import_preserves_cell_baseline_and_pixels(self):
        from reference_import import bdf

        text = """STARTFONT 2.1
FONTBOUNDINGBOX 3 3 0 -1
CHARSET_REGISTRY "ISO10646"
STARTCHAR H
ENCODING 72
DWIDTH 3 0
BBX 3 3 0 -1
BITMAP
A0
E0
A0
ENDCHAR
ENDFONT
"""
        cell, metrics, glyphs, _ = bdf(text.encode(), ["H"])
        self.assertEqual(cell, {"width": 3, "height": 3})
        self.assertEqual(metrics["baseline"], 2)
        self.assertEqual(glyphs[0]["rows"], ["A0", "E0", "A0"])
        with self.assertRaises(ValueError):
            bdf(text.replace("ISO10646", "ISO8859").encode(), ["H"])

    def test_outline_import_returns_only_mapped_one_bit_glyphs(self):
        from reference_import import truetype

        font = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
        if not font.exists():
            self.skipTest("Optional local outline reference")
        import importlib.util

        if importlib.util.find_spec("fontTools") is None:
            self.skipTest("Optional fontTools")
        _, _, glyphs, _ = truetype(font.read_bytes(), ["H", "Ї"], 16)
        self.assertEqual([g["character"] for g in glyphs], ["H", "Ї"])
        self.assertTrue(all(set(pixels(g).ravel()) <= {0, 1} for g in glyphs))

    def test_custom_reference_batch_needs_no_torch_and_preserves_font_identity(self):
        from unittest.mock import patch

        path = Path(__file__).parent.parent / ".build/style-transfer"
        if not (path / "manifest.json").exists():
            self.skipTest("Prepare optional local retrieval data")
        import builtins

        from infer import Generator

        original = builtins.__import__

        def without_torch(name, *args, **kwargs):
            if name == "torch" or name.startswith("torch."):
                raise AssertionError("Retrieval imported torch")
            return original(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=without_torch):
            engine = Generator(path, neural=False)
            font = next(f for f in engine.ds.fonts if f["id"] == "cozette-13x15")
            record = json.loads(
                (
                    Path(__file__).resolve().parents[3]
                    / "app/public"
                    / font["url"].lstrip("/")
                ).read_text()
            )
            by = {g["character"]: g for g in record["glyphs"] if g["character"]}
            request = {
                "snapshot": engine.ds.meta["snapshot"],
                "font": font,
                "referenceFont": {
                    **font,
                    "id": "reference-custom",
                    "sha256": "a" * 64,
                    "name": "External reference",
                },
                "references": [by["A"]],
                "count": 4,
                "mode": "retrieval",
                "revision": 2,
                "targets": [
                    {"target": by[c], "character": c, "targetSignature": c}
                    for c in "ҐЄ"
                ],
            }
            result = engine.batch(request)
            self.assertEqual(len(result["results"]), 2)
            for child in result["results"]:
                self.assertTrue(child["candidates"])
                self.assertTrue(
                    all(c["method"] == "retrieval" for c in child["candidates"])
                )
                self.assertEqual(
                    child["candidates"][0]["styleReferenceFont"]["fontId"],
                    "reference-custom",
                )


class LatinCompletionTests(unittest.TestCase):
    def test_native_homograph_copy_and_shared_reference_ranking(self):
        from unittest.mock import patch

        from infer import Generator

        path = Path(__file__).parent.parent / ".build/style-transfer"
        if not (path / "manifest.json").exists():
            self.skipTest("Optional local retrieval dataset")
        engine = Generator(path, neural=False)
        font = next(f for f in engine.ds.fonts if f["id"] == "acer-vga-8x8")
        record = json.loads(
            (
                Path(__file__).resolve().parents[3]
                / "app/public"
                / font["url"].lstrip("/")
            ).read_text()
        )
        a = next(g for g in record["glyphs"] if g["character"] == "A")
        targets = []
        for char in "АҐЄ":
            target = copy.deepcopy(a)
            target["character"] = char
            target["labels"] = [{"kind": "unicode", "value": char}]
            target["rows"] = ["00"] * 8
            targets.append(
                {"character": char, "target": target, "targetSignature": char}
            )
        request = {
            "snapshot": engine.ds.meta["snapshot"],
            "font": font,
            "referenceFont": font,
            "references": [a],
            "mode": "retrieval",
            "preferLatin": True,
            "count": 4,
            "revision": 0,
            "targets": targets,
        }
        with patch.object(
            engine.ds, "rank_custom", wraps=engine.ds.rank_custom
        ) as rank:
            result = engine.batch(request)
            self.assertEqual(rank.call_count, 1)
        candidate = result["results"][0]["candidates"][0]
        self.assertEqual(candidate["method"], "homograph")
        self.assertEqual(candidate["rows"], a["rows"])
        self.assertEqual(candidate["sourceGlyphId"], a["id"])
        self.assertEqual(candidate["sourceChar"], "A")


if __name__ == "__main__":
    unittest.main()
