from __future__ import annotations

_COLUMNS = ["id", "text", "normalized_text", "modern_text", "keyword",
            "explanation", "category", "sources", "source_refs", "variant_group"]


def reattach(base_rows: list[dict], enriched_rows: list[dict]) -> tuple[list[dict], list[str]]:
    by_norm = {r["normalized_text"]: r for r in enriched_rows}
    attached: list[dict] = []
    new_ids: list[str] = []
    for b in base_rows:
        e = by_norm.get(b["normalized_text"])
        if e is not None:
            modern_text = e["modern_text"]
            category = e["category"]
            explanation = e["explanation"]
        else:
            modern_text = b["text"]
            category = ""
            explanation = b["explanation"]
            new_ids.append(b["id"])
        row = {
            "id": b["id"], "text": b["text"], "normalized_text": b["normalized_text"],
            "modern_text": modern_text, "keyword": b["keyword"], "explanation": explanation,
            "category": category, "sources": b["sources"], "source_refs": b["source_refs"],
            "variant_group": b["variant_group"],
        }
        attached.append({c: row[c] for c in _COLUMNS})
    return attached, new_ids
