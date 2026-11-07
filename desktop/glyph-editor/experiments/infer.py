import argparse
import hashlib
import json
import time

import numpy as np
from native_templates import templates
from request import validate_request

from data import (
    REFS,
    SIZE,
    Dataset,
    atomic_json,
    denormalize,
    load_json,
    normalize,
    pixels,
    rows,
    structurally_usable,
)


class Generator:
    def __init__(self, data, neural=True):
        self.ds = Dataset(data)
        self.model = None
        self.dev = "cpu"
        self.training = {}
        self.rankings = {}
        self.optical = None
        if neural:
            import torch
            from network import GlyphStyleCNN, device

            self.dev = device()
            self.model = GlyphStyleCNN().to(self.dev)
            self.model.load_state_dict(
                torch.load(
                    self.ds.path / "cnn.pt", map_location=self.dev, weights_only=True
                )
            )
            self.model.eval()
            self.training = load_json(self.ds.path / "training.json")

    def candidates(self, request, evaluation=False):
        validate_request(request)
        start = time.perf_counter()
        ds = self.ds
        character = request["character"]
        font = request["font"]
        target = request["target"]
        style = request.get("referenceFont", font)
        if request["snapshot"] != ds.meta["snapshot"]:
            raise ValueError("Model dataset belongs to a different corpus snapshot")
        if character not in ds.char_index:
            raise ValueError("Supported targets: Ukrainian, Latin and digits")
        refs = np.zeros((12, SIZE, SIZE), np.float32)
        provided = {}
        used = []
        for g in request["references"]:
            for label in g["labels"]:
                if (
                    label["kind"] == "unicode"
                    and len(label["value"]) == 1
                    and (not evaluation or label["value"] != character)
                ):
                    provided[label["value"]] = g
        for k, choices in enumerate(REFS):
            for c in choices:
                if c in provided:
                    refs[k] = normalize(provided[c], style)
                    refs[k + 6] = 1
                    used.append(provided[c]["id"])
                    break
        fi = next((i for i, f in enumerate(ds.fonts) if f["id"] == style["id"]), None)
        exclude = ds.fonts[fi]["group"] if fi is not None else None
        if evaluation:
            if refs[6:, 0, 0].sum() < 2:
                raise ValueError("Evaluation requires two fixed reference groups")
            ranked = ds.rank(refs, character, exclude)
        elif "referenceFont" in request:
            key = hashlib.sha256(
                json.dumps([style, request["references"]], sort_keys=True).encode()
            ).hexdigest()
            if key not in self.rankings:
                self.rankings[key] = ds.rank_custom(
                    {c: normalize(g, style) for c, g in provided.items()}, None, exclude
                )
            ranked = [
                (score, i)
                for score, i in self.rankings[key]
                if ds.present[i, ds.char_index[character]]
            ]
            used = list(dict.fromkeys(g["id"] for g in provided.values()))
        else:
            if refs[6:, 0, 0].sum() < 2:
                raise ValueError("Need two groups from H/Н, x/х, o/о, n/п, k/к, p/р")
            ranked = ds.rank(refs, character, exclude, pool=range(len(ds.fonts)))
        ranked = ranked[:8] if evaluation else ranked[:16]
        ci = ds.char_index[character]
        probabilities = None
        if self.model is not None and refs[6:, 0, 0].sum() >= 2:
            import torch

            content = np.array([ds.images[i, ci] for _, i in ranked])[:, None].astype(
                np.float32
            )
            with torch.inference_mode():
                probabilities = (
                    self.model(
                        torch.tensor(content, device=self.dev),
                        torch.tensor(
                            np.repeat(refs[None], len(content), axis=0), device=self.dev
                        ),
                    )
                    .sigmoid()
                    .cpu()
                    .numpy()[:, 0]
                )
        result = []
        seen = set()
        filtered = 0
        count = request.get("count", 8)
        style_identity = {
            "fontId": style["id"],
            "sha256": style["sha256"],
            "name": style.get("name", style["id"]),
            "licenseId": style.get("licenseId", "NOASSERTION"),
        }

        style_identity["glyphsSha256"] = hashlib.sha256(
            json.dumps(
                request["references"], sort_keys=True, ensure_ascii=False
            ).encode()
        ).hexdigest()
        if "draftRevision" in style:
            style_identity["draftRevision"] = style["draftRevision"]

        def append(
            method,
            bits,
            donor,
            source_id,
            score,
            reference_ids,
            source_character=None,
            operation=None,
        ):
            packed = rows(bits)
            digest = hashlib.sha256("|".join(packed).encode()).hexdigest()
            key = (method, digest) if evaluation else digest
            if key in seen or not bits.any():
                return
            if evaluation and sum(c["method"] == method for c in result) >= 4:
                return
            seen.add(key)
            result.append(
                {
                    "id": digest[:16],
                    "method": method,
                    "rows": packed,
                    "width": target["width"],
                    "height": target["height"],
                    "rowBytes": (target["width"] + 7) // 8,
                    "styleDistance": score,
                    "model": {
                        "cnn": "para-style-cnn-v1",
                        "retrieval": "nearest-font-v1",
                        "reference": "reference-copy-v1",
                        "homograph": "latin-homograph-v1",
                        "geometry": "native-cyrillic-v1",
                    }[method],
                    "checkpointSha256": self.training.get("checkpointSha256")
                    if method == "cnn"
                    else None,
                    "sourceGlyphId": source_id,
                    "sourceChar": source_character or character,
                    "sourceFontId": donor["id"],
                    "sourceSha256": donor["sha256"],
                    "sourceLicenseId": donor.get("licenseId", "NOASSERTION"),
                    "sourceLicense": donor.get(
                        "license", {"id": donor.get("licenseId", "NOASSERTION")}
                    ),
                    "source": donor.get("source", {}),
                    "references": reference_ids,
                    **({"operation": operation} if operation else {}),
                    **(
                        {"styleReferenceFont": style_identity}
                        if "referenceFont" in request
                        else {}
                    ),
                }
            )

        def reference_bits(g):
            if (style["id"] != font["id"] or style["sha256"] != font["sha256"]) and (
                style["cell"]["width"] != font["cell"]["width"]
                or style["cell"]["height"] != font["cell"]["height"]
            ):
                return denormalize(normalize(g, style), target, font)
            bitmap = pixels(g)
            out = np.zeros((target["height"], target["width"]), np.uint8)
            dx = round(g["metrics"]["leftBearing"] - target["metrics"]["leftBearing"])
            dy = round(
                target["height"]
                + target["metrics"]["shiftUp"]
                - g["height"]
                - g["metrics"]["shiftUp"]
            )
            for y, x in np.argwhere(bitmap):
                if 0 <= x + dx < target["width"] and 0 <= y + dy < target["height"]:
                    out[y + dy, x + dx] = 1
            return out

        if not evaluation and character in provided and "referenceFont" in request:
            g = provided[character]
            append(
                "reference",
                reference_bits(g),
                style,
                g["id"],
                0,
                [g["id"]],
            )
        if not evaluation and request.get("preferLatin") and "referenceFont" in request:
            pairs = [
                "AА",
                "BВ",
                "CС",
                "EЕ",
                "HН",
                "IІ",
                "KК",
                "MМ",
                "OО",
                "PР",
                "TТ",
                "XХ",
                "aа",
                "cс",
                "eе",
                "iі",
                "oо",
                "pр",
                "xх",
                "yу",
            ]
            latin = next(
                (
                    pair[0]
                    for pair in pairs
                    if pair[1] == character and pair[0] in provided
                ),
                None,
            )
            if latin:
                g = provided[latin]
                append(
                    "homograph", reference_bits(g), style, g["id"], 0, [g["id"]], latin
                )
            for bits, characters, operation in templates(
                character, provided, reference_bits
            ):
                source = provided[characters[0]]
                append(
                    "geometry",
                    bits,
                    style,
                    source["id"],
                    0,
                    [provided[c]["id"] for c in characters],
                    "+".join(characters),
                    operation,
                )
        for k, (score, i) in enumerate(ranked):
            donor = ds.fonts[i]
            template = ds.images[i, ci]
            methods = [("retrieval", template)]
            if probabilities is not None:
                methods.append(("cnn", probabilities[k] >= 0.5))
            for method, grid in methods:
                bits = denormalize(grid, target, font)
                if (
                    not evaluation
                    and method == "cnn"
                    and not structurally_usable(
                        bits, denormalize(template, target, font)
                    )
                ):
                    filtered += 1
                    continue
                append(method, bits, donor, donor["glyphIds"][character], score, used)
                if len(result) >= count:
                    break
            if len(result) >= count:
                break
        result.sort(
            key=lambda c: {
                "reference": 0,
                "homograph": 1,
                "geometry": 2,
                "retrieval": 3,
                "cnn": 4,
            }[c["method"]]
        )
        result = {
            "format": "para-glyph-candidates",
            "schemaVersion": 1,
            "snapshot": request["snapshot"],
            "fontId": font["id"],
            "baseSha256": font["sha256"],
            "glyphId": target["id"],
            "character": character,
            "revision": request["revision"],
            "targetSignature": request["targetSignature"],
            "candidates": result[:count],
            "device": str(self.dev),
            "seconds": time.perf_counter() - start,
            "evaluation": evaluation,
            "filteredNeural": filtered,
            "neuralSkipped": self.model is None or refs[6:, 0, 0].sum() < 2,
        }

        if not evaluation and request.get("ocrFeedback"):
            from ocr_feedback import OpticalFeedback

            if self.optical is None:
                self.optical = OpticalFeedback()
            self.optical.apply(result, request["references"])
            result["seconds"] = time.perf_counter() - start
        return result

    def batch(self, request):
        targets = request.get("targets", [])
        if not isinstance(targets, list) or not 1 <= len(targets) <= 128:
            raise ValueError("Choose 1–128 target letters")
        results = []
        for item in targets:
            single = {**request, **item}
            single.pop("targets", None)
            try:
                results.append(self.candidates(single))
            except ValueError as error:
                results.append(
                    {
                        "character": item.get("character"),
                        "glyphId": item.get("target", {}).get("id"),
                        "error": str(error),
                    }
                )
        return {
            "format": "para-glyph-candidate-batch",
            "schemaVersion": 1,
            "fontId": request["font"]["id"],
            "revision": request["revision"],
            "results": results,
        }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--request", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    request = load_json(a.request)
    engine = Generator(a.data, neural=request.get("mode") != "retrieval")
    atomic_json(
        a.output,
        engine.batch(request) if "targets" in request else engine.candidates(request),
    )
