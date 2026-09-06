"""Punch near-white studio backgrounds out of full-body photos via flood fill."""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC_DIR = Path(
    "/Users/huangzetao/.cursor/projects/"
    "Users-huangzetao-hkishslibrary-instagram-cursor-INTERACTIVE-SIMULATION/assets"
)
DST_DIR = Path(__file__).resolve().parents[1] / "assets" / "figures"

WHITE_MIN = 232
MAX_CHANNEL_DELTA = 18


def is_studio_white(r: int, g: int, b: int) -> bool:
    if min(r, g, b) < WHITE_MIN:
        return False
    return max(r, g, b) - min(r, g, b) <= MAX_CHANNEL_DELTA


def flood_background(rgb: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def try_push(y: int, x: int) -> None:
        if bg[y, x]:
            return
        r, g, b = (int(v) for v in rgb[y, x])
        if is_studio_white(r, g, b):
            bg[y, x] = True
            q.append((y, x))

    for x in range(w):
        try_push(0, x)
        try_push(h - 1, x)
    for y in range(h):
        try_push(y, 0)
        try_push(y, w - 1)

    while q:
        y, x = q.popleft()
        if y > 0:
            try_push(y - 1, x)
        if y + 1 < h:
            try_push(y + 1, x)
        if x > 0:
            try_push(y, x - 1)
        if x + 1 < w:
            try_push(y, x + 1)
    return bg


def cutout(path: Path) -> Image.Image:
    src = Image.open(path).convert("RGBA")
    arr = np.array(src)
    bg = flood_background(arr[:, :, :3])
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    arr[:, :, 3] = alpha
    img = Image.fromarray(arr, "RGBA")

    # Soften the cut edge so the sign doesn't look jagged in 3D.
    mask = img.getchannel("A").filter(ImageFilter.GaussianBlur(radius=1.2))
    img.putalpha(mask)

    bbox = img.getbbox()
    if not bbox:
        return img
    pad = 8
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(img.width, x1 + pad)
    y1 = min(img.height, y1 + pad)
    return img.crop((x0, y0, x1, y1))


def main() -> None:
    DST_DIR.mkdir(parents=True, exist_ok=True)
    sources = sorted(SRC_DIR.glob("person-0*.png"))
    if not sources:
        raise SystemExit(f"no person-0*.png files in {SRC_DIR}")
    for i, src in enumerate(sources, start=1):
        out = DST_DIR / f"figure-{i:02d}.png"
        cutout(src).save(out, "PNG")
        print(f"{src.name} -> {out.name} {Image.open(out).size}")


if __name__ == "__main__":
    main()
