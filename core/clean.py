from __future__ import annotations
import re
import unicodedata

_LIST_NUM = re.compile(r"^\(?\d+[.)]?\s+")          # "1 ", "1. ", "(1) ", "(1 "
_LEAD_DASH = re.compile(r"^[-–—]\s+")                # leading space-padded dash (stray bullet)
_LEAD_JUNK = re.compile(r"^[\s|.:,!/'()]+")          # stray leading punct/space (NOT « „ " or letters)
_LOWER_UA = re.compile(r"[а-яіїєґ]")
_QUOTES = {"«": '"', "»": '"', "„": '"', "“": '"', "”": '"', "‹": '"', "›": '"'}
_APOS = "'ʼ`´’"  # ' ʼ ` ´ ’  -> '
_WS = re.compile(r"\s+")
_DBL_HYPHEN = re.compile(r"\s*--\s*")
_SPACE_PUNCT = re.compile(r"\s+([,;:!?])")
_SPACE_DOT = re.compile(r"\s+\.(?!\.)")
_TRAIL_PUNCT = re.compile(r"([.!?][\"')]*)(?:\s*[,;:]+|\s+[.!?]+(?!\.\.))$")
_DBL_DOT = re.compile(r"(?<![.!?])\.\.(?!\.)")
_TRAIL_COMMA = re.compile(r",\s*$")
_TIGHT_COMMA = re.compile(r",([А-ЯІЇЄҐа-яіїєґ])")

def clean_punct(text: str) -> str:
    t = _DBL_HYPHEN.sub(" - ", text)
    t = _SPACE_PUNCT.sub(r"\1", t)
    t = _SPACE_DOT.sub(".", t)
    t = _TRAIL_PUNCT.sub(r"\1", t)
    t = _DBL_DOT.sub(".", t)
    t = _TRAIL_COMMA.sub(".", t)
    t = _TIGHT_COMMA.sub(r", \1", t)
    return _WS.sub(" ", t).strip()

def clean_text(text: str) -> str:
    t = _LIST_NUM.sub("", text, count=1)
    t = _LEAD_DASH.sub("", t)
    t = _LEAD_JUNK.sub("", t).strip()
    if t and _LOWER_UA.match(t[0]):
        t = t[0].upper() + t[1:]
    return t

def to_plain(text: str) -> str:
    t = unicodedata.normalize("NFC", text)
    for q, a in _QUOTES.items():
        t = t.replace(q, a)
    for ch in _APOS:
        t = t.replace(ch, "'")
    t = t.replace("…", "...")
    t = t.replace("—", "-").replace("–", "-")        # em/en dash -> hyphen; spacing kept distinguishes тире/дефіс
    return clean_punct(t)
