import csv, json
from enrich.export import write_enriched_csv, enrich_json, write_json


def _rows():
    return [{"id": "p000001", "text": "Т1", "normalized_text": "т1", "modern_text": "М1",
             "keyword": "k", "explanation": "clean1", "category": "animals;wisdom_folly",
             "sources": "Franko1901", "source_refs": "А", "variant_group": ""}]


def test_write_enriched_csv(tmp_path):
    p = tmp_path / "c.csv"; write_enriched_csv(_rows(), str(p))
    r = list(csv.DictReader(p.open(encoding="utf-8")))[0]
    assert list(r.keys()) == ["id", "text", "normalized_text", "modern_text", "keyword",
                              "explanation", "category", "sources", "source_refs", "variant_group"]
    assert r["modern_text"] == "М1" and r["category"] == "animals;wisdom_folly"


def test_enrich_json_adds_modern_and_category_list():
    base = [{"id": "p000001", "text": "Т1", "normalized_text": "т1", "keyword": "k",
             "category": None, "variant_group": None,
             "annotations": [{"source": "Franko1901", "ref": "А", "explanation": "raw1"}]}]
    rows = {r["id"]: r for r in _rows()}
    out = enrich_json(base, rows)
    assert out[0]["modern_text"] == "М1"
    assert out[0]["category"] == ["animals", "wisdom_folly"]
    assert out[0]["annotations"][0]["explanation"] == "clean1"
    # input not mutated
    assert base[0].get("modern_text") is None
