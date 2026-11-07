"""Local before/after contact sheets for the audited seven font families."""

import argparse
import collections
import json
from pathlib import Path

from infer import Generator
from PIL import Image, ImageDraw, ImageFont

from data import pixels

parser = argparse.ArgumentParser(
    description="Compare draft Ukrainian glyphs with new native candidates without changing drafts"
)
parser.add_argument("--audit", type=Path, required=True)
a = parser.parse_args()
root = a.audit
output = root / "comparison"
output.mkdir(exist_ok=True)
ids = [
    "apricotportable",
    "hoard-windows-windows-3-1-arial-b-arial-8",
    "att-pc6300",
    "hoard-apple-mac-athens-18",
    "hoard-oberon-barbedor10-screen",
    "hoard-pc-geos-breadbox-ensemble-4-1-3-berkeley-12",
    "hoard-pc-geos-breadbox-ensemble-4-1-3-bison-12",
]
engine = Generator(native_only=True)
font_path = next(
    (
        p
        for p in [
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ]
        if p.is_file()
    ),
    None,
)
font = ImageFont.truetype(str(font_path), 13) if font_path else ImageFont.load_default()
panels = []
for id in ids:
    r = json.loads((root / (id + ".json")).read_text())
    result = engine.batch(r["request"])
    (output / (id + ".new.json")).write_text(json.dumps(result, ensure_ascii=False))
    new = {
        a["character"]: a.get("candidates", [None])[0] if a.get("candidates") else None
        for a in result["results"]
    }
    w, h = r["font"]["cell"]["width"], r["font"]["cell"]["height"]
    cw = max(w * 3 + 6, 37)
    ch = h * 3 + 22
    image = Image.new("RGB", (34 * cw, 25 + ch * 5), "#171d19")
    d = ImageDraw.Draw(image)
    d.text(
        (4, 3),
        r["summary"]["name"]
        + " | LAT / old uppercase / native uppercase / old lowercase / native lowercase",
        font=font,
        fill="#d4b76e",
    )
    seq = [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ",
    ]
    chars = [seq[0][:33], seq[1], seq[1], seq[1].lower(), seq[1].lower()]
    for line, cs in enumerate(chars):
        for i, c in enumerate(cs):
            g = new.get(c) if line in (2, 4) else r["current"].get(c)
            x = i * cw + 2
            y = 25 + line * ch
            d.text((x, y + h * 3 + 2), c, font=font, fill="#a3ae97")
            if not g:
                d.rectangle((x, y, x + w * 3 - 1, y + h * 3 - 1), outline="#c66f6f")
                continue
            for py, row in enumerate(pixels(g)):
                for px, v in enumerate(row):
                    if v:
                        d.rectangle(
                            (x + px * 3, y + py * 3, x + px * 3 + 2, y + py * 3 + 2),
                            fill="#eee9d7",
                        )
    image.save(output / (id + ".png"))
    panels.append(image)
    print(
        id,
        collections.Counter(
            "available" if a.get("candidates") else "unresolved"
            for a in result["results"]
        ),
    )
    print(
        [
            (a["character"], a.get("recipeStatus", {}).get("reason", a.get("error")))
            for a in result["results"]
            if not a.get("candidates")
        ]
    )
img = Image.new(
    "RGB", (max(p.width for p in panels), sum(p.height for p in panels)), "#171d19"
)
y = 0
for p in panels:
    img.paste(p, (0, y))
    y += p.height
img.save(output / "before-native.png")
