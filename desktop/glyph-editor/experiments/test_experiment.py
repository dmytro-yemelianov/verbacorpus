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


if __name__ == "__main__":
    unittest.main()
