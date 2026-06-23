import csv
from embed.run import build_index


def _write_corpus(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "text", "modern_text", "explanation"])
        w.writeheader()
        for r in rows:
            w.writerow(r)


def test_build_index_first_run_upserts_all(tmp_path):
    corpus = str(tmp_path / "c.csv"); manifest = str(tmp_path / "m.json")
    _write_corpus(corpus, [
        {"id": "p1", "text": "А", "modern_text": "А", "explanation": ""},
        {"id": "p2", "text": "Б", "modern_text": "В", "explanation": "по"},
    ])
    upserts, deletes = [], []
    stats = build_index(
        corpus, manifest,
        embed_fn=lambda texts: [[0.1, 0.2] for _ in texts],
        upsert_fn=lambda items: upserts.extend(items),
        delete_fn=lambda ids: deletes.extend(ids),
    )
    assert stats == {"upserted": 2, "deleted": 0, "total": 2}
    assert {u["id"] for u in upserts} == {"p1", "p2"}
    assert upserts[0]["values"] == [0.1, 0.2]


def test_build_index_second_run_only_delta(tmp_path):
    corpus = str(tmp_path / "c.csv"); manifest = str(tmp_path / "m.json")
    base = [{"id": "p1", "text": "А", "modern_text": "А", "explanation": ""},
            {"id": "p2", "text": "Б", "modern_text": "Б", "explanation": ""}]
    _write_corpus(corpus, base)
    build_index(corpus, manifest, embed_fn=lambda t: [[0.0] for _ in t],
                upsert_fn=lambda i: None, delete_fn=lambda i: None)
    # change p2, remove p1, add p3
    _write_corpus(corpus, [
        {"id": "p2", "text": "Б", "modern_text": "Б-нове", "explanation": ""},
        {"id": "p3", "text": "Г", "modern_text": "Г", "explanation": ""},
    ])
    upserts, deletes = [], []
    stats = build_index(corpus, manifest, embed_fn=lambda t: [[0.0] for _ in t],
                        upsert_fn=lambda i: upserts.extend(i), delete_fn=lambda i: deletes.extend(i))
    assert {u["id"] for u in upserts} == {"p2", "p3"}
    assert deletes == ["p1"]
    assert stats == {"upserted": 2, "deleted": 1, "total": 2}
