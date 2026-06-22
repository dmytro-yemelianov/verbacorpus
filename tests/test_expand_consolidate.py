from expand.consolidate import consolidate


def test_consolidate_flattens_pages_in_order():
    rows = consolidate("tests/fixtures/bobkova_pages")
    # empty-text row in 000.csv is skipped -> 2 + 2 = 4
    assert len(rows) == 4
    assert rows[0] == {"ref": "000", "text": "Горе тільки рака красить."}
    assert rows[1] == {"ref": "000", "text": "Лихо нікого не красить."}
    assert rows[2]["ref"] == "001"
    assert rows[3]["text"] == "Канада добрий край, як не маєш грошей, то здихай."
