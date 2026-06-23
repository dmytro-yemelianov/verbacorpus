from expand.segment import segment_page

RAW = """Горе не задавить, а з ніг звалить.
ж
Іржа їсть залізо, а горе -- серце.
.о
ТЯЖКЕ СОЦІАЛЬНЕ СТАНОВИЩЕ
Лихо не по дереву ходить,
а по людях.
25
"""


def test_segments_drops_junk_joins_wraps():
    out = segment_page(RAW)
    assert out == [
        "Горе не задавить, а з ніг звалить.",
        "Іржа їсть залізо, а горе -- серце.",
        "Лихо не по дереву ходить, а по людях.",
    ]


def test_empty_page():
    assert segment_page("\n\n12\nж\n") == []


def test_dehyphenates_line_breaks():
    raw = "Кого біда учепиться, то на спину сте-\nребиться.\n"
    assert segment_page(raw) == ["Кого біда учепиться, то на спину стеребиться."]
