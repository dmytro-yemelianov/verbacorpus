"""Explicitly snapshot sibling project metadata and a redistributable font specimen."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ALPHABET = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ"
REQUIRED = set(ALPHABET + ALPHABET.lower())


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def revision(path):
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def snapshot(upa, nasinnia, destination):
    pattern_bytes = (upa / "data/patterns.v3.json").read_bytes()
    patterns = json.loads(pattern_bytes)
    if not isinstance(patterns, list) or not patterns:
        raise ValueError("Empty UPA catalog")
    fonts = []
    for path in sorted((nasinnia / "data").rglob("*.json")):
        record = json.loads(path.read_text())
        if isinstance(record, dict) and isinstance(record.get("glyphData"), list) and record["glyphData"]:
            fonts.append((path, record))
    eligible = []
    for path, record in fonts:
        chars = {g.get("character") for g in record["glyphData"]}
        if REQUIRED <= chars and record.get("downloadAllowed") is True and record.get("license", {}).get("redistributionAllowed") is True:
            eligible.append((path, record))
    if not eligible:
        raise ValueError("No redistributable font with complete Ukrainian alphabet")
    selected = next(((p, f) for p, f in eligible if f["id"] == "cozette-13x15"), None)
    if selected is None:
        raise ValueError("Reviewed Cozette specimen is unavailable; review a new source explicitly")
    path, font = selected
    if font["license"]["id"] != "MIT":
        raise ValueError("Review the specimen license before importing a different license")
    allowed = REQUIRED | {chr(c) for c in range(32, 127)} | set("ʼ’₴–—«»")
    specimen = {k: font[k] for k in ["id", "displayName", "cell", "metrics", "license", "source"]}
    specimen["glyphData"] = [g for g in font["glyphData"] if g.get("character") in allowed]
    for glyph in specimen["glyphData"]:
        if len(glyph["rows"]) != font["cell"]["height"]:
            raise ValueError("Unexpected font row count")
        for row in glyph["rows"]:
            if len(row) != ((font["cell"]["width"] + 7) // 8) * 2:
                raise ValueError("Unexpected raster width")
            int(row, 16)
    summary = {
        "upa": {"patterns": len(patterns), "publication": "preparation", "source": "upa-archive/data/patterns.v3.json", "revision": revision(upa), "sha256": digest(pattern_bytes)},
        "nasinnia": {"rasterRecords": len(fonts), "ukrainianRedistributableRecords": len(eligible), "specimenId": font["id"], "source": str(Path("nasinnia") / path.relative_to(nasinnia)), "revision": revision(nasinnia), "sha256": digest(path.read_bytes())},
    }
    destination.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, value in [("projects.json", summary), ("font-specimen.json", specimen)]:
        raw = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
        (destination / name).write_bytes(raw)
        files[name] = digest(raw)
    license_raw = (Path(__file__).resolve().parent / "content/licenses/Cozette-LICENSE.txt").read_bytes()
    (destination / "Cozette-LICENSE.txt").write_bytes(license_raw)
    files["Cozette-LICENSE.txt"] = digest(license_raw)
    (destination / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "files": files}, indent=2) + "\n")
    print(f"Snapshot: {len(patterns)} ornaments (metadata only), {len(fonts)} raster fonts, {len(eligible)} Ukrainian fonts; specimen {font['id']}")


if __name__ == "__main__":
    app = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upa", type=Path, default=app.parents[1] / "upa-archive")
    parser.add_argument("--nasinnia", type=Path, default=app.parents[1] / "nasinnia")
    args = parser.parse_args()
    snapshot(args.upa, args.nasinnia, app / "content/snapshots")
