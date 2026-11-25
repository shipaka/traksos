#!/usr/bin/env python3
"""One-off license-audited Wikimedia Commons photo importer.

Input:  scripts/vehiclePhotoSources.json (owner-reviewed model/generation + masks)
Output: WebP files with no camera EXIF or readable registration plate.
  python3 scripts/import_vehicle_photos.py --out web/public/vehicles/models
  python3 scripts/import_vehicle_photos.py --emit-github-logs
This is intentionally NOT run at user page load. Never pass VIN/plate to any remote site.

--emit-github-logs is a one-off maintainers' workflow: output consists of public
license-approved photos in base64, allowing GitHub connector to commit binary
blobs without storing raw license plates in the repo. Do not use on private
customer photographs.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "scripts" / "vehiclePhotoSources.json"
Image.MAX_IMAGE_PIXELS = 35_000_000
MAX_JPEG = 18_000_000
OUTPUT_SIZE = (900, 600)


def commons_url(name: str) -> str:
    file_name = name.replace(" ", "_")
    digest = hashlib.md5(file_name.encode("utf-8")).hexdigest()
    return "https://upload.wikimedia.org/wikipedia/commons/" + digest[0] + "/" + digest[:2] + "/" + urllib.parse.quote(file_name, safe="")


def download_original(name: str) -> bytes:
    url = commons_url(name)
    req = urllib.request.Request(url, headers={
        "User-Agent": "TrakSosVehiclePhotoImporter/1.0 (+https://github.com/shipaka/traksos/issues/186)",
        "Accept": "image/jpeg,image/png,image/webp,*/*;q=0.2",
    })
    # No arbitrary URLs from manifest. Only the validated Commons file object.
    with urllib.request.urlopen(req, timeout=35) as resp:
        if not str(resp.url).startswith("https://upload.wikimedia.org/wikipedia/commons/"):
            raise RuntimeError("Photo redirect points outside Wikimedia Commons")
        content = resp.read(MAX_JPEG + 1)
        if len(content) > MAX_JPEG:
            raise RuntimeError(f"Source too large: {name}")
        return content


def validate_box(coords: list[float]) -> None:
    if len(coords) != 4 or not all(isinstance(v, (float, int)) and 0 <= v <= 1 for v in coords):
        raise ValueError("Invalid normalized crop/redaction box")
    if coords[0] >= coords[2] or coords[1] >= coords[3]:
        raise ValueError("Empty crop/redaction box")


def box_pixels(box: list[float], width: int, height: int) -> tuple[int, int, int, int]:
    validate_box(box)
    return (
        max(0, min(width-1, round(box[0] * width))),
        max(0, min(height-1, round(box[1] * height))),
        max(1, min(width, round(box[2] * width))),
        max(1, min(height, round(box[3] * height))),
    )


def prepare(row: dict) -> bytes:
    raw = download_original(row["sourceFile"])
    try:
        image = Image.open(io.BytesIO(raw))
        if image.format not in ("JPEG", "PNG", "WEBP"):
            raise ValueError("Unexpected source image encoding")
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Invalid source image") from exc
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    if width < 550 or height < 390:
        raise ValueError("Source too small for a mobile card")

    for rectangle in row["redact"]:
        area = box_pixels(rectangle, width, height)
        region = image.crop(area)
        # Strong privacy redaction: pixelate first, then blur, including the
        # registration on trailers/other visible cars if any mask is specified.
        mini = region.resize((max(1, region.width // 45), max(1, region.height // 45)), Image.Resampling.BOX)
        anonymized = mini.resize(region.size, Image.Resampling.NEAREST).filter(
            ImageFilter.GaussianBlur(radius=max(6, region.width // 11))
        )
        image.paste(anonymized, area)

    image = image.crop(box_pixels(row["crop"], width, height))
    image = ImageOps.fit(image, OUTPUT_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=78, method=6, exif=b"")
    data = out.getvalue()
    with Image.open(io.BytesIO(data)) as test:
        if test.size != OUTPUT_SIZE or test.format != "WEBP":
            raise RuntimeError("WebP output validation failed")
        if test.getexif():
            raise RuntimeError("Metadata/EXIF was not cleared")
    if len(data) > 150_000:
        raise RuntimeError("Photo not mobile-sized")
    return data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="web/public/vehicles/models")
    parser.add_argument("--emit-github-logs", action="store_true")
    args = parser.parse_args()
    source = json.loads(MANIFEST.read_text(encoding="utf-8"))
    rows = source["items"]
    if source.get("schemaVersion") != 1 or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Unrecognized photo manifest or duplicate ID")
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    for row in rows:
        # In regular mode, download for an operator to review locally.
        # In one-off CI mode, public already-masked bytes are emitted in
        # chunked log records, then committed by the repo's GitHub connector.
        data = prepare(row)
        name = row["id"] + ".webp"
        (out / name).write_bytes(data)
        print(f"IMPORT_OK {name} {len(data)} {hashlib.sha256(data).hexdigest()}", flush=True)
        if args.emit_github_logs:
            encoded = base64.b64encode(data).decode("ascii")
            print(f"TRAKSOS_ASSET_BEGIN {row['id']} {name} {len(data)} {hashlib.sha256(data).hexdigest()}", flush=True)
            for n in range(0, len(encoded), 6000):
                print(f"TRAKSOS_ASSET_CHUNK {row['id']} {encoded[n:n+6000]}", flush=True)
            print(f"TRAKSOS_ASSET_END {row['id']}", flush=True)
    print("ALL_IMPORTS_COMPLETE " + str(len(rows)), flush=True)


if __name__ == "__main__":
    main()
