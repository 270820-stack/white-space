"""Watch assets/inbox for dropped photos, cut them out, and queue sign replacements."""

from __future__ import annotations

import io
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
SAVED = ROOT / "assets" / "figures-saved"
CONTOURS = FIGURES / "contours.json"
EVENT_PATH = ROOT / "assets" / "replace.json"
FAILED = INBOX / "_failed"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout_figures import cutout  # noqa: E402
from extract_contours import extract  # noqa: E402

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
IGNORE = {".ds_store", "drop_photo_here.txt", ".keep", "latest.json"}
MAX_EDGE = 1600


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


def downscale_if_huge(path: Path) -> Path:
    with Image.open(path) as img:
        img.load()
        if max(img.size) <= MAX_EDGE:
            return path
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
        tmp = path.with_name("." + path.stem + ".prep.png")
        img.save(tmp, "PNG")
        print(f"downscaled {path.name} to {img.size[0]}x{img.size[1]}", flush=True)
        return tmp


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


def saved_bodies() -> list[Path]:
    return [p for p in sorted(SAVED.glob("figure-*.png")) if p.is_file()]


def detect_face_crop(img: Image.Image) -> Image.Image:
    bgr = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(gray, 1.12, 5, minSize=(80, 80)) if not cascade.empty() else []
    if len(faces):
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        pad_x = int(fw * 0.22)
        pad_top = int(fh * 0.38)
        pad_bot = int(fh * 0.22)
        x0 = max(0, x - pad_x)
        y0 = max(0, y - pad_top)
        x1 = min(w, x + fw + pad_x)
        y1 = min(h, y + fh + pad_bot)
        return img.crop((x0, y0, x1, y1))
    return img.crop((int(w * 0.18), int(h * 0.08), int(w * 0.82), int(h * 0.78)))


def cut_face(img: Image.Image) -> Image.Image:
    crop = detect_face_crop(img)
    tmp = INBOX / "._online_face.png"
    INBOX.mkdir(parents=True, exist_ok=True)
    crop.save(tmp, "PNG")
    try:
        out = cut_background(tmp)
    finally:
        tmp.unlink(missing_ok=True)
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def composite_face_on_body(face: Image.Image, body: Image.Image) -> Image.Image:
    body = body.convert("RGBA")
    face = face.convert("RGBA")
    bb = body.getbbox() or (0, 0, body.width, body.height)
    x0, y0, x1, y1 = bb
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)
    head_h = max(8, int(bh * 0.19))
    neck_y = y0 + head_h
    head_band = body.crop((x0, y0, x1, neck_y))
    hb = head_band.getbbox()
    natural_w = (hb[2] - hb[0]) if hb else int(bw * 0.40)
    fb = face.getbbox() or (0, 0, face.width, face.height)
    face = face.crop(fb)
    target_w = max(24, int(natural_w * 0.9))
    ratio = target_w / max(1, face.width)
    max_h = max(28, int(bh * 0.20))
    if int(face.height * ratio) > max_h:
        ratio = max_h / max(1, face.height)
    face = face.resize(
        (max(24, int(face.width * ratio)), max(28, int(face.height * ratio))),
        Image.LANCZOS,
    )
    face_arr = np.array(face)
    fade_h = max(6, int(face_arr.shape[0] * 0.16))
    row = np.arange(face_arr.shape[0])
    face_fade = np.clip((face_arr.shape[0] - 1 - row) / fade_h, 0.0, 1.0)
    face_arr[:, :, 3] = (face_arr[:, :, 3].astype(np.float32) * face_fade[:, None]).astype(np.uint8)
    face = Image.fromarray(face_arr, "RGBA")
    arr = np.array(body)
    yy = np.arange(arr.shape[0])[:, None]
    wipe = yy < neck_y
    keep = np.clip((yy - neck_y) / 10.0, 0.0, 1.0)
    arr[:, :, 0] = np.where(wipe, 0, arr[:, :, 0])
    arr[:, :, 1] = np.where(wipe, 0, arr[:, :, 1])
    arr[:, :, 2] = np.where(wipe, 0, arr[:, :, 2])
    arr[:, :, 3] = np.where(wipe, 0, (arr[:, :, 3].astype(np.float32) * keep).astype(np.uint8))
    cleared = Image.fromarray(arr, "RGBA")
    px = x0 + (bw - face.width) // 2
    py = neck_y - face.height + int(face.height * 0.14)
    cleared.paste(face, (px, py), face)
    return cleared


def process_online_photo(data: bytes) -> dict:
    FIGURES.mkdir(parents=True, exist_ok=True)
    bodies = saved_bodies()
    if not bodies:
        raise RuntimeError("no saved figures for clothing")
    raw = Image.open(io.BytesIO(data)).convert("RGBA")
    if max(raw.size) > MAX_EDGE:
        raw.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    face = cut_face(raw)
    body_path = random.choice(bodies)
    body = Image.open(body_path).convert("RGBA")
    combined = composite_face_on_body(face, body)
    stem = next_figure_stem()
    dest = FIGURES / f"{stem}.png"
    combined.save(dest, "PNG")
    try:
        merge_contour(stem, extract(dest))
    except Exception:
        pass
    count = random.randint(3, 10)
    event = {
        "id": int(time.time() * 1000),
        "figure": stem,
        "src": f"./assets/figures/{stem}.png",
        "count": count,
    }
    print(f"online {stem} onto {count} signs using {body_path.name}", flush=True)
    return event


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
    prepared = None
    try:
        prepared = downscale_if_huge(path)
        cut_background(prepared).save(dest, "PNG")
        try:
            merge_contour(stem, extract(dest))
        except Exception as exc:
            print(f"contour skipped for {dest.name}: {exc}", flush=True)
        count = random.randint(3, 10)
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
    finally:
        if prepared is not None and prepared != path:
            prepared.unlink(missing_ok=True)


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
