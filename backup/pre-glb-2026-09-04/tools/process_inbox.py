"""Watch assets/inbox for dropped photos, cut them out, and queue sign replacements."""

from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "assets" / "inbox"
FIGURES = ROOT / "assets" / "figures"
CONTOURS = FIGURES / "contours.json"
EVENT_PATH = ROOT / "assets" / "replace.json"
FAILED = INBOX / "_failed"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout_figures import cutout  # noqa: E402
from extract_contours import extract  # noqa: E402

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
IGNORE = {".ds_store", "drop_photo_here.txt", ".keep", "latest.json"}


def grabcut_cutout(path: Path) -> Image.Image:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError(f"could not read {path.name}")
    h, w = bgr.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    rect = (int(w * 0.08), int(h * 0.03), int(w * 0.84), int(h * 0.94))
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, rect, bgd, fgd, 5, cv2.GC_INIT_WITH_RECT)
    keep = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    keep = cv2.medianBlur(keep, 5)
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
    rgba[:, :, 3] = keep
    img = Image.fromarray(rgba)
    bbox = img.getbbox()
    if not bbox:
        return img
    pad = 8
    x0, y0, x1, y1 = bbox
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))


def opaque_ratio(img: Image.Image) -> float:
    alpha = img.getchannel("A")
    pix = list(alpha.getdata())
    if not pix:
        return 0.0
    return sum(1 for v in pix if v > 40) / len(pix)


def cut_background(path: Path) -> Image.Image:
    img = cutout(path)
    ratio = opaque_ratio(img)
    if 0.08 < ratio < 0.92:
        return img
    print(f"flood fill looked weak ({ratio:.2f}), trying grabcut", flush=True)
    return grabcut_cutout(path)


def next_figure_stem() -> str:
    nums = []
    for path in FIGURES.glob("figure-*.png"):
        try:
            nums.append(int(path.stem.split("-")[1]))
        except (IndexError, ValueError):
            continue
    return f"figure-{(max(nums) if nums else 0) + 1:02d}"


def wait_stable(path: Path, tries: int = 16) -> bool:
    last = -1
    for _ in range(tries):
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size > 0 and size == last:
            return True
        last = size
        time.sleep(0.15)
    return last > 0


def merge_contour(stem: str, contour: dict) -> None:
    data = json.loads(CONTOURS.read_text()) if CONTOURS.exists() else {}
    data[stem] = {"outer": contour["outer"], "holes": contour.get("holes", [])}
    CONTOURS.write_text(json.dumps(data))


def write_event(stem: str, count: int) -> None:
    event = {
        "id": int(time.time() * 1000),
        "figure": stem,
        "src": f"./assets/figures/{stem}.png",
        "count": count,
    }
    EVENT_PATH.write_text(json.dumps(event))
    print(f"queued {stem} onto {count} signs", flush=True)


def process_file(path: Path) -> None:
    if not wait_stable(path):
        print(f"skip (not ready): {path.name}", flush=True)
        return
    stem = next_figure_stem()
    dest = FIGURES / f"{stem}.png"
    try:
        cut_background(path).save(dest, "PNG")
        contour = extract(dest)
        merge_contour(stem, contour)
        count = random.randint(4, 18)
        write_event(stem, count)
        path.unlink(missing_ok=True)
        print(f"{path.name} -> {dest.name}", flush=True)
    except Exception as exc:
        FAILED.mkdir(parents=True, exist_ok=True)
        failed = FAILED / path.name
        try:
            path.replace(failed)
        except OSError:
            pass
        print(f"failed {path.name}: {exc}", flush=True)


def pending_images() -> list[Path]:
    INBOX.mkdir(parents=True, exist_ok=True)
    files = []
    for path in INBOX.iterdir():
        if path.name.startswith("."):
            continue
        if path.name.lower() in IGNORE:
            continue
        if path.is_dir():
            continue
        if path.suffix.lower() in IMAGE_SUFFIXES:
            files.append(path)
    return sorted(files, key=lambda p: p.stat().st_mtime)


def watch_forever(interval: float = 0.6) -> None:
    INBOX.mkdir(parents=True, exist_ok=True)
    FIGURES.mkdir(parents=True, exist_ok=True)
    print(f"watching {INBOX}", flush=True)
    while True:
        for path in pending_images():
            process_file(path)
        time.sleep(interval)


if __name__ == "__main__":
    watch_forever()
