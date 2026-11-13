import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("sync_bez_tabu", Path(__file__).resolve().parents[1] / "sync_bez_tabu.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTests(unittest.TestCase):
    def test_vendored_snapshot_has_no_lost_rows_and_hashes_match(self):
        import csv
        import hashlib
        base = Path(__file__).resolve().parents[1] / "public/bez-tabu/data"
        provenance = json.loads((base / "provenance.json").read_text())
        for name, digest in provenance["files"].items():
            self.assertEqual(hashlib.sha256((base / name).read_bytes()).hexdigest(), digest, name)
        data = json.loads((base / "entries.json").read_text())
        rows = list(csv.DictReader(io.StringIO((base / "synonyms.csv").read_text(encoding="utf-8-sig"))))
        self.assertEqual(len(rows), len(data["entries"]))
        for line, (row, entry) in enumerate(zip(rows, data["entries"]), 2):
            self.assertEqual(entry["sourceRow"], line)
            for key in row:
                self.assertEqual(entry[key], row[key] == "1" if key == "isWord" else row[key])

    def test_stale_export_rejected_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source"; (source / "data").mkdir(parents=True)
            (source / "synonyms.csv").write_text("changed input")
            (source / "data/entries.json").write_text(json.dumps({"schemaVersion": 1, "source": {"sha256": "old"}}))
            destination = Path(tmp) / "destination"
            with self.assertRaisesRegex(ValueError, "Stale"):
                module.sync(source, destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
