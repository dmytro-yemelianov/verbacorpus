"""Fetch pinned official ukr/eng OCR data into ignored local build artifacts."""

import hashlib
import json
import urllib.request
from pathlib import Path

COMMIT = "87416418657359cb625c412a48b6e1d6d41c29bd"
SHA256 = {
    "ukr": "d59e53e2bded32f4445f124b4b00240fcac7e8044c003ab822ccb94f0b3db59b",
    "eng": "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
}


def setup():
    root = Path(__file__).parent.parent / ".build/ocr"
    directory = root / "tessdata"
    directory.mkdir(parents=True, exist_ok=True)
    for language, expected in SHA256.items():
        destination = directory / f"{language}.traineddata"
        if (
            destination.exists()
            and hashlib.sha256(destination.read_bytes()).hexdigest() == expected
        ):
            continue
        url = f"https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{COMMIT}/{language}.traineddata"
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"OCR model hash mismatch: {language}")
        temporary = destination.with_suffix(".tmp")
        temporary.write_bytes(data)
        temporary.replace(destination)
    (root / "manifest.json").write_text(
        json.dumps(
            {
                "repository": "https://github.com/tesseract-ocr/tessdata_fast",
                "commit": COMMIT,
                "license": "Apache-2.0",
                "sha256": SHA256,
            },
            indent=2,
        )
    )
    print(
        "Pinned ukr/eng OCR data ready; a local Tesseract 5 library is also required."
    )


if __name__ == "__main__":
    setup()
