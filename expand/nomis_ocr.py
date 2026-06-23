from __future__ import annotations

import os
import subprocess


def column_boxes(width: int, height: int, overlap: int = 20) -> list[tuple[int, int, int, int]]:
    mid = width // 2
    left = (0, 0, mid + overlap, height)
    right = (mid - overlap, 0, width, height)
    return [left, right]


def ocr_image(path: str, lang: str = "ukr", psm: int = 6, tessdata: str | None = None) -> str:
    env = dict(os.environ)
    if tessdata:
        env["TESSDATA_PREFIX"] = os.path.abspath(tessdata)
    out = subprocess.run(
        ["tesseract", path, "stdout", "-l", lang, "--psm", str(psm)],
        capture_output=True, text=True, env=env, check=True,
    )
    return out.stdout


def ocr_pdf(pdf: str, out_txt_dir: str, dpi: int = 300,
            tessdata: str = "expand/work/tessdata_best") -> int:
    from PIL import Image
    os.makedirs(out_txt_dir, exist_ok=True)
    img_dir = os.path.join(out_txt_dir, "_img")
    os.makedirs(img_dir, exist_ok=True)
    subprocess.run(["pdftoppm", "-r", str(dpi), "-png", pdf, os.path.join(img_dir, "page")], check=True)
    pages = sorted(f for f in os.listdir(img_dir) if f.endswith(".png"))
    for i, name in enumerate(pages, 1):
        im = Image.open(os.path.join(img_dir, name))
        parts = []
        for j, box in enumerate(column_boxes(im.width, im.height)):
            crop_path = os.path.join(img_dir, f"col-{i:04d}-{j}.png")
            im.crop(box).save(crop_path)
            parts.append(ocr_image(crop_path, tessdata=tessdata))
        with open(os.path.join(out_txt_dir, f"page-{i:04d}.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(parts))
    return len(pages)
