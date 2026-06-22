from enrich.tune_variants import recompute_variant_groups


def _rows(pairs):
    return [{"id": f"p{i:06d}", "text": t, "normalized_text": nt, "variant_group": "OLD"}
            for i, (t, nt) in enumerate(pairs, 1)]


def test_links_at_threshold_and_writes_back():
    rows = _rows([("баба з воза", "баба з воза"), ("баба із воза", "баба із воза"),
                  ("цілком інша річ", "цілком інша річ")])
    out = recompute_variant_groups(rows, threshold=80, max_group_size=None)
    assert out[0]["variant_group"] == out[1]["variant_group"] != ""
    assert out[2]["variant_group"] == ""          # singleton cleared
    assert out[0]["text"] == "баба з воза"          # untouched


def test_max_group_size_dissolves_large_groups():
    # four near-identical -> one group of 4; cap at 3 dissolves it
    rows = _rows([("як ту", "як ту а"), ("як ту", "як ту б"), ("як ту", "як ту в"), ("як ту", "як ту г")])
    out = recompute_variant_groups(rows, threshold=70, max_group_size=3)
    assert all(r["variant_group"] == "" for r in out)
