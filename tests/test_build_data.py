import json, csv, os, xml.etree.ElementTree as ET
from app.build_data import build

TAX = "enrich/taxonomy.csv"
SRC = "sources.csv"


def test_build_outputs(tmp_path):
    out = tmp_path / "data"; xml = tmp_path / "corpus.xml"
    stats = build("tests/fixtures/productize_corpus.csv", TAX, SRC, str(out), str(xml))
    prov = json.loads((out / "proverbs.json").read_text(encoding="utf-8"))
    assert stats["count"] == 2
    assert prov[0]["id"] == "p000001"
    assert prov[0]["category"] == ["food_hunger", "animals"]
    assert prov[0]["sources"] == ["Franko1901", "Bobkova"]
    assert "modern_text" in prov[0] and "explanation" not in prov[0]
    expl = json.loads((out / "explanations.json").read_text(encoding="utf-8"))
    assert expl == {"p000001": "Сатира."}                # only non-empty
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert meta["count"] == 2
    assert meta["taxonomy"]["food_hunger"] == "Їжа і голод"
    assert any(s["key"] == "Bobkova" for s in meta["sources"])
    root = ET.fromstring(xml.read_text(encoding="utf-8"))
    assert root.tag == "corpus" and len(root.findall("proverb")) == 2


def test_sources_have_citation(tmp_path):
    out = tmp_path / "data"; xml = tmp_path / "corpus.xml"
    build("tests/fixtures/productize_corpus.csv", TAX, SRC, str(out), str(xml))
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    for s in meta["sources"]:
        assert s.get("citation"), f"source {s['key']} missing citation"
        assert "isbn" in s
        assert "url" in s


def test_build_writes_reference_files(tmp_path):
    out = tmp_path / "data"; xml = tmp_path / "corpus.xml"
    build("tests/fixtures/productize_corpus.csv", TAX, SRC, str(out), str(xml))
    # public/ is tmp_path (parent of out_dir)
    bib = tmp_path / "references.bib"
    csl = tmp_path / "references.csl.json"
    assert bib.exists(), "references.bib not written to public/"
    assert bib.read_text(encoding="utf-8").startswith("@book{")
    assert csl.exists(), "references.csl.json not written to public/"
    csl_data = json.loads(csl.read_text(encoding="utf-8"))
    src_count = sum(1 for _ in csv.DictReader(open(SRC, encoding="utf-8")))
    assert len(csl_data) == src_count


def test_root_references_exist(tmp_path):
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import build
    build._write_references(out_dir=str(tmp_path))
    bib = (tmp_path / "references.bib").read_text(encoding="utf-8")
    assert bib.startswith("@book{")
    csl = json.loads((tmp_path / "references.csl.json").read_text(encoding="utf-8"))
    assert isinstance(csl, list) and len(csl) == 5


def test_read_version(tmp_path):
    from app.build_data import _read_version
    (tmp_path / "VERSION").write_text("1.0.0\n", encoding="utf-8")
    corpus = tmp_path / "corpus.csv"
    corpus.write_text("id,text\n", encoding="utf-8")
    assert _read_version(str(corpus)) == "1.0.0"


def test_read_version_missing(tmp_path):
    from app.build_data import _read_version
    corpus = tmp_path / "corpus.csv"
    corpus.write_text("x", encoding="utf-8")
    assert _read_version(str(corpus)) is None
