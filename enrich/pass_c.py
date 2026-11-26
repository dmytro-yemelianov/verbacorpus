from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path

STOPWORDS = frozenset({
    "а", "і", "й", "та", "не", "що", "на", "в", "у", "до", "з", "із", "зі",
    "за", "по", "від", "для", "про", "при", "над", "під", "без", "чи", "бо",
    "як", "то", "же", "ж", "би", "б", "ні",
})


def validate_hook(text: str, hook: str | None) -> str | None:
    """Return None when hook is a valid 1-4 word verbatim substring, else reason."""
    if not isinstance(hook, str) or not hook:
        return "missing"
    if hook not in text:
        return "not_verbatim"
    if hook.endswith("."):
        return "trailing_dot"
    words = hook.split()
    if not (1 <= len(words) <= 4):
        return f"word_count_{len(words)}"
    last = words[-1].lower().strip(",;:!?\"'()-")
    if last in STOPWORDS:
        return "trailing_stopword"
    idx = text.find(hook)
    if idx > 0 and text[idx - 1].isalpha():
        return "mid_word_start"
    end = idx + len(hook)
    if end < len(text) and text[end].isalpha():
        return "mid_word_end"
    return None


def fallback_hook(text: str) -> str:
    """Choose a valid 1-3 word substring, or empty when none exists."""
    tokens = list(re.finditer(r"\S+", text))
    if not tokens:
        return ""

    comma = text.rfind(",")
    after_comma = next((i for i, token in enumerate(tokens) if token.start() > comma), 0)
    floors = [after_comma, 0] if after_comma else [0]
    for floor in floors:
        for end_index in range(len(tokens) - 1, floor - 1, -1):
            for count in (3, 2, 1):
                start_index = end_index - count + 1
                if start_index < floor:
                    continue
                start = tokens[start_index].start()
                end = tokens[end_index].end()
                candidate = text[start:end].rstrip(".,;:!?\"'()")
                if validate_hook(text, candidate) is None:
                    return candidate
    return ""


def prepare_batches(corpus_csv: str, out_dir: str, batch_size: int = 100) -> int:
    out = Path(out_dir)
    (out / "batches").mkdir(parents=True, exist_ok=True)
    (out / "done").mkdir(parents=True, exist_ok=True)
    with open(corpus_csv, encoding="utf-8") as f:
        rows = [{"id": r["id"], "text": r["text"]} for r in csv.DictReader(f)]
    n_batches = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        p = out / "batches" / f"batch_{n_batches:04d}.txt"
        p.write_text("\n".join(f"{r['id']}\t{r['text']}" for r in chunk) + "\n", encoding="utf-8")
        n_batches += 1
    return n_batches
