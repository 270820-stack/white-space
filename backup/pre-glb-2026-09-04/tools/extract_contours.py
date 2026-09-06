"""Trace figure PNG alpha into simplified polygon contours."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "assets" / "figures"
ALPHA_CUT = 80


def simplify(contour: np.ndarray, frac: float = 0.00085) -> list[list[float]]:
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, max(frac * peri, 0.8), True)
    return approx.reshape(-1, 2).astype(float).tolist()


def normalize(pts: list[list[float]], width: int, height: int) -> list[list[float]]:
    out = []
    for x, y in pts:
        nx = x / width - 0.5
        ny = 0.5 - y / height
        out.append([round(nx, 5), round(ny, 5)])
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def extract(path: Path) -> dict:
    img = np.array(Image.open(path).convert("RGBA"))
    h, w = img.shape[:2]
    mask = (img[:, :, 3] > ALPHA_CUT).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        raise RuntimeError(f"no contour in {path.name}")

    outer = simplify(max(contours, key=cv2.contourArea))

    return {
        "outer": normalize(outer, w, h),
        "holes": [],
        "points": len(outer),
        "holeCount": 0,
    }


def main() -> None:
    data = {}
    for path in sorted(ROOT.glob("figure-0[1-6].png")):
        info = extract(path)
        data[path.stem] = {"outer": info["outer"], "holes": info["holes"]}
        print(f"{path.name}: {info['points']} pts, {info['holeCount']} holes")
    out = ROOT / "contours.json"
    out.write_text(json.dumps(data))
    print("wrote", out)


if __name__ == "__main__":
    main()
