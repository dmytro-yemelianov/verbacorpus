from adapters.franko import load


def test_maps_rows_to_records():
    recs = load("tests/fixtures/franko_sample.csv")
    # 3 valid rows; the empty-prov_clean row is skipped
    assert len(recs) == 3

    first = recs[0]
    assert first.text == "В кого є, то все своє."
    assert first.keyword == "Є, єсть"
    assert len(first.annotations) == 1
    ann = first.annotations[0]
    assert ann.source == "Franko1901"
    assert ann.ref == "Є"
    assert ann.explanation == "А я свого не маю і мені він не дасть."


def test_blank_description_yields_empty_explanation():
    recs = load("tests/fixtures/franko_sample.csv")
    boloto = [r for r in recs if r.text == "Аби болото, а жаби будуть."][0]
    assert boloto.annotations[0].explanation == ""
