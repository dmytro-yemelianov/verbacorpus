"""Import a reviewed ua-bez-tabu snapshot; normal site builds need no sibling repo."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


def sync(source, destination):
    source, destination = Path(source), Path(destination)
    raw = (source / "synonyms.csv").read_bytes()
    data = json.loads((source / "data/entries.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(raw).hexdigest()
    if data.get("schemaVersion") != 1 or data["source"]["sha256"] != digest:
        raise ValueError("Stale or unsupported export; rebuild ua-bez-tabu first")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    entries = data["entries"]
    if len(rows) != len(entries) or data["stats"]["rows"] != len(rows):
        raise ValueError("Entry count mismatch")
    for line, (row, entry) in enumerate(zip(rows, entries), 2):
        if entry["sourceRow"] != line or type(entry["isWord"]) is not bool:
            raise ValueError(f"Invalid source row {line}")
        if any(entry[k] != (row[k] == "1" if k == "isWord" else row[k]) for k in row):
            raise ValueError(f"Export differs from CSV at row {line}")
    files = {name: (source / "data" / name).read_bytes() for name in
             ("entries.json", "synonyms.json", "synonyms.csv", "synonyms.xml", "audit.json")}
    if files["synonyms.csv"] != raw:
        raise ValueError("Stale CSV copy")
    xml = ET.fromstring(files["synonyms.xml"])
    if xml.attrib.get("sourceSha256") != digest or len(xml) != len(rows):
        raise ValueError("Stale XML export")
    files["LICENSE.txt"] = (source / "LICENSE").read_bytes()
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    upstream = subprocess.check_output(["git", "-C", str(source), "rev-parse", "origin/main"], text=True).strip()
    # Exporter may have reviewed, uncommitted changes; pin both data and exporter bytes.
    provenance = {"repository": data["source"]["repository"], "upstreamRevision": upstream, "sourceRevision": revision,
                  "sourceSha256": digest,
                  "exporterSha256": hashlib.sha256((source / "tools/converter.py").read_bytes()).hexdigest(),
                  "files": {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}}
    files["provenance.json"] = (json.dumps(provenance, ensure_ascii=False, indent=2) + "\n").encode()
    destination.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        (destination / name).write_bytes(raw)
    print(f"Imported {len(entries)} source rows ({digest[:12]})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=Path(__file__).resolve().parents[2] / "ua-bez-tabu")
    args = parser.parse_args()
    sync(args.source, Path(__file__).resolve().parent / "public/bez-tabu/data")
