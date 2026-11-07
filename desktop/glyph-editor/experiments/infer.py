import argparse
import hashlib
import time

import numpy as np
import torch
from network import GlyphStyleCNN, device
from request import validate_request

from data import (
    REFS,
    SIZE,
    Dataset,
    atomic_json,
    denormalize,
    load_json,
    normalize,
    rows,
    structurally_usable,
)


class Generator:
    def __init__(self, data):
        self.ds = Dataset(data)
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
        if request["snapshot"] != ds.meta["snapshot"]:
            raise ValueError("Model dataset belongs to a different corpus snapshot")
        if character not in ds.char_index:
            raise ValueError(
                "This prototype supports Latin, digits and Ukrainian letters"
            )
        refs = np.zeros((12, SIZE, SIZE), np.float32)
        provided = {}
        used_references = []
        for g in request["references"]:
            for label in g["labels"]:
                if label["kind"] == "unicode" and label["value"] != character:
                    provided[label["value"]] = g
        for k, choices in enumerate(REFS):
            for c in choices:
                if c in provided:
                    refs[k] = normalize(provided[c], font)
                    refs[k + 6] = 1
                    used_references.append(provided[c]["id"])
                    break
        if refs[6:, 0, 0].sum() < 2:
            raise ValueError(
                "Need at least two reference groups: H/Н, x/х, o/о, n/п, k/к, p/р"
            )
        fi = next((i for i, f in enumerate(ds.fonts) if f["id"] == font["id"]), None)
        exclude = ds.fonts[fi]["group"] if fi is not None else None
        ranked = (
            ds.rank(refs, character, exclude)
            if evaluation
            else ds.rank(refs, character, exclude, pool=range(len(ds.fonts)))
        )
        if not ranked:
            raise ValueError("No independent donor font for this character")
        ranked = ranked[:8]
        ci = ds.char_index[character]
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
        filtered_neural = 0
        count = max(1, min(8, int(request.get("count", 8))))
        for k, (score, i) in enumerate(ranked):
            for method, grid in [
                ("retrieval", ds.images[i, ci]),
                ("cnn", probabilities[k] >= 0.5),
            ]:
                bits = denormalize(grid, target, font)
                if not evaluation and method == "cnn":
                    structure = denormalize(ds.images[i, ci], target, font)
                    if not structurally_usable(bits, structure):
                        filtered_neural += 1
                        continue
                packed = rows(bits)
                fingerprint = hashlib.sha256("|".join(packed).encode()).hexdigest()
                dedup = (method, fingerprint) if evaluation else fingerprint
                if dedup in seen or not bits.any():
                    continue
                if evaluation and sum(c["method"] == method for c in result) >= 4:
                    continue
                seen.add(dedup)
                donor = ds.fonts[i]
                result.append(
                    {
                        "id": fingerprint[:16],
                        "method": method,
                        "rows": packed,
                        "width": target["width"],
                        "height": target["height"],
                        "rowBytes": (target["width"] + 7) // 8,
                        "styleDistance": score,
                        "model": "para-style-cnn-v1"
                        if method == "cnn"
                        else "nearest-font-v1",
                        "checkpointSha256": self.training["checkpointSha256"]
                        if method == "cnn"
                        else None,
                        "sourceGlyphId": donor["glyphIds"][character],
                        "sourceFontId": donor["id"],
                        "sourceSha256": donor["sha256"],
                        "sourceLicenseId": donor["licenseId"],
                        "sourceLicense": donor["license"],
                        "source": donor["source"],
                        "references": used_references,
                    }
                )
                if len(result) >= count:
                    break
            if len(result) >= count:
                break
        result.sort(key=lambda candidate: candidate["method"] != "retrieval")
        return {
            "format": "para-glyph-candidates",
            "schemaVersion": 1,
            "snapshot": request["snapshot"],
            "fontId": font["id"],
            "baseSha256": font["sha256"],
            "glyphId": target["id"],
            "character": character,
            "revision": request["revision"],
            "targetSignature": request["targetSignature"],
            "candidates": result,
            "device": str(self.dev),
            "seconds": time.perf_counter() - start,
            "evaluation": evaluation,
            "filteredNeural": filtered_neural,
            "notice": "Experimental CNN and nearest-font proposals. Fewer unique candidates may be returned. Metrics and mappings are preserved on Apply.",
        }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--request", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    atomic_json(a.output, Generator(a.data).candidates(load_json(a.request)))
