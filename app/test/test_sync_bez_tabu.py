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

    def test_id_failure_leaves_destination_and_table_untouched(self):
        import csv as _csv
        import hashlib
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source = tmp / "source"; (source / "data").mkdir(parents=True); (source / "tools").mkdir()
            raw = "group,term,synonym,isWord\nГ,т,а,1\n".encode()
            digest = hashlib.sha256(raw).hexdigest()
            (source / "synonyms.csv").write_bytes(raw)
            entries = {"schemaVersion": 1, "source": {"sha256": digest, "repository": "r"}, "stats": {"rows": 1},
                       "entries": [{"sourceRow": 2, "group": "Г", "term": "т", "synonym": "а", "isWord": True}]}
            (source / "data/entries.json").write_text(json.dumps(entries))
            for name in ("synonyms.json", "audit.json"):
                (source / "data" / name).write_text("{}")
            (source / "data/synonyms.csv").write_bytes(raw)
            (source / "data/synonyms.xml").write_text(f'<r sourceSha256="{digest}"><e/></r>')
            (source / "LICENSE").write_text("l"); (source / "tools/converter.py").write_text("x")
            ids_path = tmp / "ids.json"
            destination = tmp / "destination"
            with mock.patch.object(module.subprocess, "check_output", return_value="rev\n"), \
                 mock.patch.object(module, "assign_ids", side_effect=ValueError("Cannot assign a unique id")):
                with self.assertRaisesRegex(ValueError, "Cannot assign"):
                    module.sync(source, destination, ids_path)
            self.assertFalse(destination.exists())
            self.assertFalse(ids_path.exists())


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
