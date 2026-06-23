from __future__ import annotations

import re

_CYR = re.compile(r"[а-яіїєґА-ЯІЇЄҐ]")


def _is_boundary(line: str) -> bool:
    s = line.strip()
    if not s or s.isdigit():
        return True
    letters = _CYR.findall(s)
    if len(letters) < 4:
        return True
    if all(c.isupper() for c in letters):
        return True
    return False


def _finish(buf: list[str]) -> str:
    text = re.sub(r"\s+", " ", " ".join(buf)).strip()
    text = re.sub(r"^\d+\s+", "", text)
    text = re.sub(r"\s+\d+$", "", text)
    return text.strip()


def segment_page(raw_text: str) -> list[str]:
    proverbs: list[str] = []
    buf: list[str] = []
    for line in raw_text.split("\n"):
        if _is_boundary(line):
            if buf:
                proverbs.append(_finish(buf))
                buf = []
        else:
            stripped = line.strip()
            # De-hyphenate: if previous line ends with hyphen, join without space
            if buf and buf[-1] and buf[-1][-1] in ('-', '‐', '¬'):
                buf[-1] = buf[-1][:-1] + stripped
            else:
                buf.append(stripped)
    if buf:
        proverbs.append(_finish(buf))
    return [p for p in proverbs if p]
