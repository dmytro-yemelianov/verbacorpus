from __future__ import annotations

def render_citation(r: dict) -> str:
    g = lambda k: (r.get(k) or "").strip()
    bits: list[str] = []
    if g("Author"): bits.append(g("Author").rstrip(".") + ".")
    if g("Title"): bits.append(g("Title").rstrip(".") + ".")
    if g("Volume"): bits.append(g("Volume").rstrip(".") + ".")
    place, pub, year = g("Place"), g("Publisher"), g("Year")
    loc = f"{place}: {pub}" if place and pub else (place or pub)
    seg = f"{loc}, {year}" if loc and year else (loc or year)
    if seg: bits.append(seg.rstrip(".") + ".")
    if g("ISBN"): bits.append(f"ISBN {g('ISBN')}.")
    if g("URL"): bits.append(g("URL"))
    return " ".join(bits)

def to_bibtex(rows: list[dict]) -> str:
    fieldmap = [("author", "Author"), ("title", "Title"), ("year", "Year"),
                ("address", "Place"), ("publisher", "Publisher"), ("volume", "Volume"),
                ("isbn", "ISBN"), ("url", "URL"), ("note", "Note")]
    out = []
    for r in rows:
        lines = [f"@book{{{r['Citationkey']},"]
        for bib, col in fieldmap:
            v = (r.get(col) or "").strip()
            if v:
                lines.append(f"  {bib} = {{{v}}},")
        lines.append("}")
        out.append("\n".join(lines))
    return "\n\n".join(out) + "\n"

def to_csl(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        g = lambda k: (r.get(k) or "").strip()
        e: dict = {"id": r["Citationkey"], "type": "book"}
        if g("Author"): e["author"] = [{"literal": g("Author")}]
        if g("Title"): e["title"] = g("Title")
        if g("Year").isdigit(): e["issued"] = {"date-parts": [[int(g("Year"))]]}
        if g("Place"): e["publisher-place"] = g("Place")
        if g("Publisher"): e["publisher"] = g("Publisher")
        if g("Volume"): e["volume"] = g("Volume")
        if g("ISBN"): e["ISBN"] = g("ISBN")
        if g("URL"): e["URL"] = g("URL")
        out.append(e)
    return out
