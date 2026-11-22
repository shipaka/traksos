#!/usr/bin/env python3
"""One-off photographic branding cleanup for the approved 617.png hero.

Preserves the exact 1536x324 photographed geometry. The source photo is
immutable (brand references cannot be reused on public banners). This removes
only in-photo lettering, trailer artwork, vehicle badges and the cab's plate.
It never paints UI text, changes the approved homepage layout or touches 618.
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "web/public/owner20-photo-background-approved.webp"
target = root / "web/public/owner20-photo-brandless-20261122.webp"
image = np.asarray(Image.open(source).convert("RGB"))
height, width = image.shape[:2]
assert (width, height) == (1536, 324), (width, height)

# Original 617 source pixels inspected at native resolution:
# - large orange/white TrakSOS on the curtain-side
# - secondary artwork to the left of curtain logo
# - small amber lettering on the cab visor
# - two producer insignia on cab front, and registration text
mask = np.zeros((height, width), dtype=np.uint8)
regions = [
    np.array([[813,126],[909,136],[911,210],[811,193]], dtype=np.int32), # curtain logotype
    np.array([[789,75],[811,83],[812,166],[787,156]], dtype=np.int32),   # curtain brand artwork
    np.array([[632,76],[698,72],[700,96],[630,98]], dtype=np.int32),     # visor text
    np.array([[651,167],[667,166],[668,186],[650,187]], dtype=np.int32), # manufacturer badge
    np.array([[649,190],[669,188],[669,210],[647,212]], dtype=np.int32), # grille mark
    np.array([[638,256],[688,255],[690,270],[637,271]], dtype=np.int32),# plate
]
for polygon in regions:
    cv2.fillPoly(mask, [polygon], 255)
mask = cv2.dilate(mask, np.ones((3,3), np.uint8), iterations=1)
# Two passes: preserve nearby original lighting while reconstructing missing
# neutral panel paint. No rectangles or text are added to the banner.
photo_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
fixed = cv2.inpaint(photo_bgr, mask, 6, cv2.INPAINT_TELEA)
fixed = cv2.inpaint(fixed, mask, 11, cv2.INPAINT_NS)
out = Image.fromarray(cv2.cvtColor(fixed,cv2.COLOR_BGR2RGB))
out.save(target, format="WEBP", quality=92, method=6)
print(f"created: {target.relative_to(root)} {target.stat().st_size} bytes {out.size}")
