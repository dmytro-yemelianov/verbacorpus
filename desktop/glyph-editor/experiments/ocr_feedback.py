"""Optional local OCR feedback, calibrated on the font's known references.

Recognition does not prove stylistic quality. Exact native copies are protected,
weak OCR leaves ranking alone, and no expected-character whitelist is used.
Tesseract's C API reuses one language model for the whole candidate batch.
"""

import ctypes
import ctypes.util
import hashlib
import json
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image

from data import pixels

PAIRS = [
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


def compatible(expected, actual):
    return expected == actual or any(
        expected in pair and actual in pair for pair in PAIRS
    )


def recognition_status(expected, text, confidence):
    if confidence < 45 or len(text) != 1:
        return "uncertain"
    if expected == text:
        return "match"
    if compatible(expected, text):
        return "compatible"
    return "mismatch" if confidence >= 60 else "uncertain"


def rerank(candidates, character, recognize, calibrated):
    annotated = []
    for order, original in enumerate(candidates):
        candidate = dict(original)
        text, confidence = recognize(candidate)
        status = recognition_status(character, text, confidence)
        candidate["ocr"] = {
            "text": text,
            "confidence": confidence,
            "status": status,
            "calibrated": calibrated,
            "engine": "tesseract-lstm",
        }
        # Never replace a native exact/homograph copy because OCR prefers another alphabet.
        protected = candidate["method"] in ("reference", "homograph")
        tier = (
            0
            if protected
            else 1
            if status in ("match", "compatible")
            else 3
            if status == "mismatch"
            else 2
        )
        annotated.append((tier if calibrated else 0, order, candidate))
    return [c for _, _, c in sorted(annotated, key=lambda item: item[:2])]


class OpticalFeedback:
    def __init__(self, data=None):
        self.handle = None
        self.cache = {}
        self.calibrations = {}
        self.reason = "Локальний OCR не налаштовано"
        directory = Path(data or Path(__file__).parent.parent / ".build/ocr/tessdata")
        if not all(
            (directory / f"{lang}.traineddata").is_file() for lang in ("ukr", "eng")
        ):
            self.reason = "Немає локальних OCR-моделей ukr/eng"
            return
        library = ctypes.util.find_library("tesseract") or next(
            (
                str(p)
                for p in [
                    Path("/opt/homebrew/lib/libtesseract.dylib"),
                    Path("/usr/local/lib/libtesseract.dylib"),
                ]
                if p.is_file()
            ),
            None,
        )
        if not library:
            self.reason = "Бібліотека Tesseract недоступна"
            return
        # Bound Tesseract's native threads; inference already runs outside the UI.
        os.environ.setdefault("OMP_THREAD_LIMIT", "1")
        try:
            self.lib = ctypes.CDLL(library)
            signatures = {
                "TessBaseAPICreate": (ctypes.c_void_p, []),
                "TessBaseAPIInit3": (
                    ctypes.c_int,
                    [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p],
                ),
                "TessBaseAPISetPageSegMode": (None, [ctypes.c_void_p, ctypes.c_int]),
                "TessBaseAPISetImage": (
                    None,
                    [
                        ctypes.c_void_p,
                        ctypes.POINTER(ctypes.c_ubyte),
                        ctypes.c_int,
                        ctypes.c_int,
                        ctypes.c_int,
                        ctypes.c_int,
                    ],
                ),
                "TessBaseAPIGetUTF8Text": (ctypes.c_void_p, [ctypes.c_void_p]),
                "TessBaseAPIMeanTextConf": (ctypes.c_int, [ctypes.c_void_p]),
                "TessDeleteText": (None, [ctypes.c_void_p]),
                "TessBaseAPIClear": (None, [ctypes.c_void_p]),
                "TessBaseAPIDelete": (None, [ctypes.c_void_p]),
            }
            for name, (result, args) in signatures.items():
                function = getattr(self.lib, name)
                function.restype, function.argtypes = result, args
            handle = self.lib.TessBaseAPICreate()
            if self.lib.TessBaseAPIInit3(handle, str(directory).encode(), b"eng+ukr"):
                self.lib.TessBaseAPIDelete(handle)
                self.reason = "Не вдалося відкрити OCR-моделі"
                return
            self.handle = handle
            self.reason = ""
            self.lib.TessBaseAPISetPageSegMode(
                handle, 10
            )  # one character, no target whitelist
        except (OSError, AttributeError) as error:
            self.reason = str(error)[:200]

    def close(self):
        if self.handle:
            self.lib.TessBaseAPIDelete(self.handle)
            self.handle = None

    def recognize(self, glyph):
        bits = pixels(glyph)
        digest = hashlib.sha256(bits.tobytes() + str(bits.shape).encode()).hexdigest()
        if digest in self.cache:
            return self.cache[digest]
        points = np.argwhere(bits)
        if not len(points):
            return "", 0
        y0, x0 = points.min(axis=0)
        y1, x1 = points.max(axis=0) + 1
        ink = bits[y0:y1, x0:x1]
        z = max(1, min(12, round(40 / max(1, ink.shape[0]))))
        image = Image.fromarray(255 - ink * 255).resize(
            (ink.shape[1] * z, ink.shape[0] * z), Image.Resampling.NEAREST
        )
        padded = Image.new("L", (image.width + 20, image.height + 20), 255)
        padded.paste(image, (10, 10))
        data = np.ascontiguousarray(padded, dtype=np.uint8)
        self.lib.TessBaseAPISetImage(
            self.handle,
            data.ctypes.data_as(ctypes.POINTER(ctypes.c_ubyte)),
            data.shape[1],
            data.shape[0],
            1,
            data.shape[1],
        )
        pointer = self.lib.TessBaseAPIGetUTF8Text(self.handle)
        try:
            text = ctypes.string_at(pointer).decode("utf-8").strip() if pointer else ""
            confidence = max(0, min(100, self.lib.TessBaseAPIMeanTextConf(self.handle)))
        finally:
            if pointer:
                self.lib.TessDeleteText(pointer)
            self.lib.TessBaseAPIClear(self.handle)
        result = (text[:16], confidence)
        self.cache[digest] = result
        return result

    def apply(self, result, references):
        start = time.perf_counter()
        if not self.handle:
            result["recognition"] = {"status": "unavailable", "reason": self.reason}
            return result
        key = hashlib.sha256(
            json.dumps(references, sort_keys=True).encode()
        ).hexdigest()
        if key not in self.calibrations:
            chosen = []
            for char in "AHMOExonkpyB":
                glyph = next(
                    (
                        g
                        for g in references
                        if any(
                            l.get("kind") == "unicode" and l.get("value") == char
                            for l in g["labels"]
                        )
                    ),
                    None,
                )
                if glyph:
                    chosen.append((char, glyph))
            matches = sum(
                recognition_status(char, *self.recognize(g)) in ("match", "compatible")
                for char, g in chosen
            )
            agreement = matches / max(1, len(chosen))
            self.calibrations[key] = (agreement, len(chosen))
        agreement, count = self.calibrations[key]
        calibrated = count >= 4 and agreement >= 0.6
        result["candidates"] = rerank(
            result["candidates"], result["character"], self.recognize, calibrated
        )
        result["recognition"] = {
            "status": "active" if calibrated else "unreliable",
            "referenceAgreement": agreement,
            "referenceCount": count,
            "seconds": time.perf_counter() - start,
            "reason": ""
            if calibrated
            else "OCR непевно читає цей шрифт; порядок збережено",
        }
        return result
