import csv, json
from enrich.batch import make_batches


def _write_corpus(p, n):
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "text", "keyword", "explanation"])
        w.writeheader()
        for i in range(1, n + 1):
            w.writerow({"id": f"p{i:06d}", "text": f"t{i}", "keyword": "", "explanation": f"e{i}"})


def test_make_batches_splits_and_projects(tmp_path):
    corpus = tmp_path / "corpus.csv"; _write_corpus(corpus, 5)
    out = tmp_path / "in"
    paths = make_batches(str(corpus), str(out), fields=["id", "text"], size=2)
    assert len(paths) == 3                      # 2 + 2 + 1
    b0 = json.loads((out / "batch_0000.json").read_text(encoding="utf-8"))
    assert b0 == [{"id": "p000001", "text": "t1"}, {"id": "p000002", "text": "t2"}]
    b2 = json.loads((out / "batch_0002.json").read_text(encoding="utf-8"))
    assert b2 == [{"id": "p000005", "text": "t5"}]
    # id always included even if not requested
    paths2 = make_batches(str(corpus), str(tmp_path / "in2"), fields=["text"], size=10)
    rec = json.loads((tmp_path / "in2" / "batch_0000.json").read_text(encoding="utf-8"))[0]
    assert "id" in rec
