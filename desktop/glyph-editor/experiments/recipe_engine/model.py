"""Font identities and pixel-boundary metric contracts."""

from __future__ import annotations

from dataclasses import dataclass, field

from .bitmap import Bitmap

UK_UPPER = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ"
UK_LOWER = "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя"
UK_ALPHABET = UK_UPPER + UK_LOWER


@dataclass(frozen=True)
class Metrics:
    baseline: int
    cap_top: int
    x_top: int

    def __post_init__(self):
        if any(type(v) is not int for v in (self.baseline, self.cap_top, self.x_top)):
            raise ValueError("metrics must be integer pixel boundaries")
        if not 0 <= self.cap_top <= self.x_top < self.baseline:
            raise ValueError("metrics require 0 <= cap_top <= x_top < baseline")

    @property
    def cap_height(self):
        return self.baseline - self.cap_top

    @property
    def x_height(self):
        return self.baseline - self.x_top


@dataclass
class Font:
    width: int
    height: int
    glyphs: dict[str, Bitmap]
    metrics: Metrics | None = None
    name: str = "Untitled"
    notes: list[str] = field(default_factory=list)

    def validate(self):
        if type(self.width) is not int or not 3 <= self.width <= 64:
            raise ValueError("recipe cells require width 3–64 pixels")
        if type(self.height) is not int or not 5 <= self.height <= 64:
            raise ValueError("recipe cells require height 5–64 pixels")
        if not isinstance(self.name, str) or any(c in self.name for c in "\r\n\x00"):
            raise ValueError("font name must be a single line of text")
        if self.metrics is not None:
            if not isinstance(self.metrics, Metrics):
                raise ValueError("metrics must be a Metrics instance")
            if self.metrics.baseline > self.height:
                raise ValueError("baseline exceeds cell height")
        if not isinstance(self.glyphs, dict) or not self.glyphs:
            raise ValueError("font requires a non-empty glyph dictionary")
        for char, bitmap in self.glyphs.items():
            if (
                not isinstance(char, str)
                or len(char) != 1
                or 0xD800 <= ord(char) <= 0xDFFF
            ):
                raise ValueError("glyph keys must be single Unicode scalar values")
            if not isinstance(bitmap, Bitmap):
                raise TypeError(f"glyph U+{ord(char):04X} is not a Bitmap")
            if (bitmap.width, bitmap.height) != (self.width, self.height):
                raise ValueError(
                    f"glyph U+{ord(char):04X} dimensions do not match cell"
                )
        return self
