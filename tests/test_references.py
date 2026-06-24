from core.references import render_citation, to_bibtex, to_csl

FULL = {"Citationkey": "X", "Author": "Іван Франко", "Title": "Назва", "Year": "1901",
        "Place": "Львів", "Publisher": "НТШ", "Volume": "Етнографічний збірник, тт. X, XVI",
        "ISBN": "", "URL": "https://example.org/x", "Note": ""}
MODERN = {"Citationkey": "M", "Author": "А. Б.", "Title": "Словник", "Year": "2009",
          "Place": "Київ", "Publisher": "Освіта", "Volume": "", "ISBN": "978-966-00-0000-0", "URL": "", "Note": ""}

def test_render_citation_full_no_isbn():
    c = render_citation(FULL)
    assert c == "Іван Франко. Назва. Етнографічний збірник, тт. X, XVI. Львів: НТШ, 1901. https://example.org/x"
    assert "ISBN" not in c  # blank ISBN omitted cleanly

def test_render_citation_modern_with_isbn():
    c = render_citation(MODERN)
    assert c == "А. Б. Словник. Київ: Освіта, 2009. ISBN 978-966-00-0000-0."

def test_render_citation_omits_blanks_no_dangling_punct():
    minimal = {"Citationkey": "Z", "Author": "", "Title": "Заголовок", "Year": "1864", "Place": "СПб.",
               "Publisher": "", "Volume": "", "ISBN": "", "URL": "", "Note": ""}
    assert render_citation(minimal) == "Заголовок. СПб., 1864."

def test_to_bibtex_omits_empty_fields():
    bib = to_bibtex([FULL])
    assert bib.startswith("@book{X,")
    assert "title = {Назва}" in bib and "address = {Львів}" in bib and "publisher = {НТШ}" in bib
    assert "isbn" not in bib  # empty ISBN not emitted
    bibm = to_bibtex([MODERN])
    assert "isbn = {978-966-00-0000-0}" in bibm

def test_to_csl_shape():
    csl = to_csl([FULL, MODERN])
    assert csl[0]["id"] == "X" and csl[0]["type"] == "book"
    assert csl[0]["issued"]["date-parts"] == [[1901]]
    assert "ISBN" not in csl[0] and csl[1]["ISBN"] == "978-966-00-0000-0"
