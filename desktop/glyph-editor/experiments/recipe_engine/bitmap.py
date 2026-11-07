"""Small immutable monochrome bitmaps; integer coordinates only."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Bitmap:
    width: int
    height: int
    rows: tuple[int, ...]

    def __post_init__(self):
        if type(self.width) is not int or type(self.height) is not int:
            raise ValueError("bitmap dimensions must be integers")
        if self.width < 1 or self.height < 1:
            raise ValueError("bitmap dimensions must be positive")
        object.__setattr__(self, "rows", tuple(self.rows))
        if len(self.rows) != self.height:
            raise ValueError("bitmap row count does not match height")
        limit = 1 << self.width
        if any(type(r) is not int or r < 0 or r >= limit for r in self.rows):
            raise ValueError("bitmap rows contain values outside their width")

    def get(self, x: int, y: int) -> int:
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return 0
        return (self.rows[y] >> (self.width - 1 - x)) & 1

    def bbox(self):
        occupied = [(y, row) for y, row in enumerate(self.rows) if row]
        if not occupied:
            return None
        left = min(self.width - row.bit_length() for _, row in occupied)
        right = max(self.width - (row & -row).bit_length() + 1 for _, row in occupied)
        return left, occupied[0][0], right, occupied[-1][0] + 1

    def count(self) -> int:
        return sum(bin(row).count("1") for row in self.rows)  # noqa: FURB161 - Python 3.9 runtime

    def to_matrix(self):
        return [[self.get(x, y) for x in range(self.width)] for y in range(self.height)]

    @classmethod
    def from_matrix(cls, matrix):
        if not matrix or not matrix[0]:
            raise ValueError("bitmap matrix cannot be empty")
        width = len(matrix[0])
        if any(len(row) != width for row in matrix):
            raise ValueError("bitmap matrix must be rectangular")
        rows = []
        for row in matrix:
            value = 0
            for pixel in row:
                if pixel not in (0, 1) or not isinstance(pixel, (int, bool)):
                    raise ValueError("bitmap pixels must be 0 or 1")
                value = (value << 1) | int(pixel)
            rows.append(value)
        return cls(width, len(rows), tuple(rows))

    @classmethod
    def blank(cls, width, height):
        return cls(width, height, (0,) * height)

    def crop(self, x0, y0, width, height):
        if (
            width < 1
            or height < 1
            or x0 < 0
            or y0 < 0
            or x0 + width > self.width
            or y0 + height > self.height
        ):
            raise ValueError("crop lies outside bitmap")
        return Bitmap.from_matrix(
            [
                [self.get(x, y) for x in range(x0, x0 + width)]
                for y in range(y0, y0 + height)
            ]
        )

    def mirror_lr(self):
        return Bitmap.from_matrix([list(reversed(row)) for row in self.to_matrix()])

    def mirror_tb(self):
        return Bitmap(self.width, self.height, tuple(reversed(self.rows)))

    def place(self, width, height, x, y):
        canvas = [[0] * width for _ in range(height)]
        for sy in range(self.height):
            for sx in range(self.width):
                if self.get(sx, sy):
                    dx, dy = x + sx, y + sy
                    if not (0 <= dx < width and 0 <= dy < height):
                        raise ValueError("placement would clip ink")
                    canvas[dy][dx] = 1
        return Bitmap.from_matrix(canvas)

    def union(self, other):
        if (self.width, self.height) != (other.width, other.height):
            raise ValueError("union requires equal dimensions")
        return Bitmap(
            self.width, self.height, tuple(a | b for a, b in zip(self.rows, other.rows))
        )

    def hex_rows(self):
        digits = (self.width + 3) // 4
        return [f"{row:0{digits}X}" for row in self.rows]
