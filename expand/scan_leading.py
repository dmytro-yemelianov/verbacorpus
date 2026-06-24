from __future__ import annotations
import csv, re, sys, collections

def classify(text: str) -> str:
    t = text.strip()
    if not t:
        return "empty"
    c = t[0]
    if c in "Ѣѣ":
        return "yat"
    if re.match(r"[А-ЯІЇЄҐ]", c):
        return "upper"
    if re.match(r"[а-яіїєґ]", c):
        return "lower"
    if c in '«»"„""':
        return "quote"
    if c.isdigit():
        return "digit"
    if re.match(r"[A-Za-zͰ-Ͽ]", c):     # Latin or Greek
        return "latin"
    return "punct"

def scan(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = collections.defaultdict(list)
    for r in rows:
        out[classify(r["text"])].append(r)
    return out

def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "corpus.csv"
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    groups = scan(rows)
    for k in sorted(groups, key=lambda k: -len(groups[k])):
        print(f"{k}: {len(groups[k])}")

if __name__ == "__main__":
    main()
