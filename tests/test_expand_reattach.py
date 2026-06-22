from expand.reattach import reattach

ENR_COLS = ["id", "text", "normalized_text", "modern_text", "keyword",
            "explanation", "category", "sources", "source_refs", "variant_group"]


def _base(id, text, nt, expl="", src="Bobkova"):
    return {"id": id, "text": text, "normalized_text": nt, "keyword": "",
            "explanation": expl, "category": "", "sources": src,
            "source_refs": "005", "variant_group": ""}


def test_match_reuses_enrichment_and_new_is_flagged():
    enriched = [{"id": "p000050", "text": "Стара", "normalized_text": "стара",
                 "modern_text": "Стара (мод.)", "keyword": "", "explanation": "поясн",
                 "category": "wisdom_folly", "sources": "Franko1901",
                 "source_refs": "С", "variant_group": ""}]
    base = [
        _base("p000050", "Стара", "стара", src="Franko1901;Bobkova"),  # matches
        _base("p000051", "Нова приказка", "нова приказка"),            # net-new
    ]
    attached, new_ids = reattach(base, enriched)
    assert list(attached[0].keys()) == ENR_COLS
    assert attached[0]["modern_text"] == "Стара (мод.)"
    assert attached[0]["category"] == "wisdom_folly"
    assert attached[0]["explanation"] == "поясн"
    assert new_ids == ["p000051"]
    assert attached[1]["modern_text"] == "Нова приказка"   # modern_text = text
    assert attached[1]["category"] == ""
