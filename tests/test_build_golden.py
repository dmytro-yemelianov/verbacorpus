import filecmp

from build import build, build_records


def test_golden_corpus(tmp_path):
    stats = build(sources_dir="tests/fixtures/golden", out_dir=str(tmp_path))
    produced = tmp_path / "corpus.csv"
    assert filecmp.cmp(
        str(produced), "tests/fixtures/golden/expected_corpus.csv", shallow=False
    )
    assert stats["total"] == 4
    assert stats["variant_groups"] == 1
    assert stats["per_source"]["Franko1901"] == 2


def test_build_is_deterministic(tmp_path):
    a = build_records("tests/fixtures/golden")
    b = build_records("tests/fixtures/golden")
    assert [r.id for r in a] == [r.id for r in b]
    assert [r.text for r in a] == [r.text for r in b]
