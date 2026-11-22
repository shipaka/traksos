#!/usr/bin/env python3
"""Auditable *local* retouch of approved TrakSOS truck art.

This script DOES NOT create/recompose the scene. It only proposes variations
of the grille-lettering mask in the original bitmap. TrakSOS trailer lettering,
truck, perspective, road, background, colors and canvas size remain identical
outside the mask. Outputs are REVIEW ARTIFACTS, not automatically published.

Run in CI: python3 scripts/retouch-approved-truck.py
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SOURCE = Path("web/public/tracksos-approved-hero-owner-20261119.webp")
OUT = Path("e2e/shots/approved-truck-retouch")
# Approximate coordinates of the WHITE foreign maker name on the front grille
# of the fixed, owner-approved 912x460 composition.
ROI = (187, 217, 300, 251)  # x0 y0 x1 y1; no changes outside these pixels
EXPECTED_GIT_BLOB_SHA = "ae2deca0f4d3165cd441de8535104378cead22f4"


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def crop_scaled(src: Image.Image, box: tuple[int, int, int, int], scale: int = 4) -> Image.Image:
    return src.crop(box).resize(((box[2] - box[0]) * scale, (box[3] - box[1]) * scale), Image.Resampling.NEAREST)


def main() -> None:
    original_bytes = SOURCE.read_bytes()
    actual_sha = git_blob_sha(original_bytes)
    if actual_sha != EXPECTED_GIT_BLOB_SHA:
        raise SystemExit(
            f"Do not retouch unreviewed original! Expected Git blob "
            f"{EXPECTED_GIT_BLOB_SHA}, got {actual_sha}"
        )

    rgb = np.array(Image.open(SOURCE).convert("RGB"))
    h, w, _ = rgb.shape
    if (w, h) != (912, 460):
        raise SystemExit(f"Owner-approved original expected 912x460, got {w}x{h}")
    x0, y0, x1, y1 = ROI
    patch = rgb[y0:y1, x0:x1, :]
    # Lettering is almost white, whereas the background blue-black grille is
    # dark. Mask only the high-luma strokes in this small, fixed region.
    high = np.min(patch, axis=2).astype(np.int16)
    spread = (np.max(patch, axis=2).astype(np.int16) -
              np.min(patch, axis=2).astype(np.int16))
    letter = np.logical_and(high > 104, spread < 95).astype("uint8") * 255

    mask = np.zeros((h, w), dtype=np.uint8)
    mask[y0:y1, x0:x1] = letter
    # Enclose anti-aliased white stroke edges but avoid moving any boundaries
    # of the actual truck. Radius is confined to the known logo box.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.dilate(mask, kernel, iterations=1)
    confined = np.zeros_like(mask)
    confined[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    mask = confined

    if int(np.count_nonzero(mask)) < 200 or int(np.count_nonzero(mask)) > 2600:
        raise SystemExit(
            f"Suspicious manufacturer logo mask: {np.count_nonzero(mask)} px"
        )

    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(OUT / "00-exact-approved-original.png")
    Image.fromarray(mask).save(OUT / "01-logo-pixels-mask.png")
    inspect_box = (176, 207, 312, 261)
    crop_scaled(Image.fromarray(rgb), inspect_box).save(OUT / "00-original-grille-4x.png")

    # Inpaint ONLY the masked text pixels. The original TrakSOS sign on the
    # trailer is not even in the editable region.
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    summary = []
    for name, radius, algorithm in [
        ("02-telea-r2", 2, cv2.INPAINT_TELEA),
        ("03-telea-r4", 4, cv2.INPAINT_TELEA),
        ("04-navier-stokes-r3", 3, cv2.INPAINT_NS),
    ]:
        result_bgr = cv2.inpaint(bgr, mask, radius, algorithm)
        candidate = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)
        modified = np.any(candidate != rgb, axis=2)
        outside = modified.copy()
        outside[y0:y1, x0:x1] = False
        if np.any(outside):
            raise SystemExit(f"ERROR: {name} altered the approved scene outside logo!")
        if np.any(candidate[:, 350:] != rgb[:, 350:]):
            raise SystemExit(f"ERROR: {name} altered TrakSOS on the trailer!")
        im = Image.fromarray(candidate)
        # Lossless WEBP: no change to the original decoded pixels except logo.
        im.save(OUT / f"{name}.webp", "WEBP", lossless=True, method=6)
        im.save(OUT / f"{name}.png")
        crop_scaled(im, inspect_box).save(OUT / f"{name}-grille-4x.png")

        # Triptych and highlighted diff for meaningful side-by-side review.
        # Never use a black block to hide the mark in the final artwork.
        diff = np.zeros_like(rgb)
        diff[modified] = (255, 130, 45)
        Image.fromarray(diff).save(OUT / f"{name}-changed-pixels-only.png")
        summary.append({
            "candidate": name, "logo_inpaint_radius": radius,
            "modified_pixels": int(np.count_nonzero(modified)),
            "outside_logo_modified_pixels": int(np.count_nonzero(outside)),
            "trailer_modified_pixels": 0
        })

    (OUT / "provenance.json").write_text(json.dumps({
        "source": SOURCE.as_posix(),
        "original_blob_sha": actual_sha,
        "canvas": [w, h],
        "allowed_logo_roi_xyxy": ROI,
        "mask_pixels": int(np.count_nonzero(mask)),
        "final_artwork_status": "REVIEW ONLY, NOT APPROVED OR DEPLOYED",
        "traksos_trailer_lettering_preserved": True,
        "candidates": summary
    }, ensure_ascii=False, indent=2) + "\n")
    print("Audited retouch candidates written:", OUT)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
