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


def e(group, term, synonym, is_word=True):
    return {"group": group, "term": term, "synonym": synonym, "isWord": is_word}


class IdTests(unittest.TestCase):
    def test_ids_are_stable_unique_and_keep_old_assignments(self):
        entries = [e("Г", "т", "а"), e("Г", "т", "б"), e("Г", "т", "а")]  # третій - дублікат першого
        table = module.assign_ids(entries, {"version": 1, "ids": {}})
        self.assertEqual(len(set(table["ids"].values())), 2)
        again = module.assign_ids(entries[:1], table)  # джерело скоротилось
        self.assertEqual(again["ids"], table["ids"])  # нічого не втрачено й не змінено

    def test_key_normalises_and_distinguishes_is_word(self):
        a = module.entry_key(e(" Г", "т", "й"))
        self.assertEqual(a, module.entry_key(e("Г", "т", "и\u0306")))  # NFC + strip
        self.assertNotEqual(a, module.entry_key(e("Г", "т", "й", False)))

    def test_prefix_collision_extends_length(self):
        table = {"version": 1, "ids": {}}
        k = module.entry_key(e("Г", "т", "а"))
        short = __import__("hashlib").sha256(k.encode()).hexdigest()[:10]
        table["ids"]["other-key"] = short
        out = module.assign_ids([e("Г", "т", "а")], table)
        self.assertEqual(out["ids"][k], __import__("hashlib").sha256(k.encode()).hexdigest()[:12])

    def test_vendored_table_covers_every_entry(self):
        base = Path(__file__).resolve().parents[1]
        data = json.loads((base / "public/bez-tabu/data/entries.json").read_text())
        table = json.loads((base / "content/bez-tabu-ids.json").read_text())
        keys = {module.entry_key(x) for x in data["entries"]}
        self.assertEqual(len(keys), 1995)
        self.assertTrue(keys <= set(table["ids"]))
        self.assertEqual(len(set(table["ids"].values())), len(table["ids"]))


if __name__ == "__main__":
    unittest.main()
