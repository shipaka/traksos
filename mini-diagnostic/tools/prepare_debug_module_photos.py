"""Prepare model-specific reference photos for INTERNAL debug review only.
No runtime Internet permission; no photos included in release or source repository.
Public accessibility is not a redistribution license. Replace with cleared assets before publication.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile
from PIL import Image, ImageOps

# Each source was checked against the model name or exact part number.
# Never reuse a photograph for another generation.
SOURCES = {
    "zf_tebs_d": ("4801020140", "https://perimpecas.com.br/fotos/384046.jpg", "https://www.wabco-customercentre.com/catalog/en_US/4801020140"),
    "zf_tebs_e": ("4801020300", "https://eshop.imps.cz/fotky-produktu/4801020300-4.png.webp", "https://www.wabco-customercentre.com/catalog/en_US/4801020300"),
    "zf_iebs": ("iEBS Premium", "https://aftermarket.zf.com/media/master/for-fleets/wabco/premium_isometric_fullhd_21.jpg?v=809718499", "https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
    "kb_g22": ("K055369V04N50", "https://sfk-truck.com/image/cache/wp/gP/produkti/462999-550x550w.webp", "https://sfk-truck.com/40"),
    "kb_itebs_x": ("iTEBS X", "https://static.tildacdn.com/tild3736-6532-4339-b532-616466663631/iTEBS_X1.png", "https://alger-truckdiag.ru/kbitebsx"),
    "haldex_eb3": ("EB+ Gen3", "https://www.haldex.com/globalassets/europe/4.-brands/1.-haldex/2.-ebs/2.-ebgen3/ebgen3.png", "https://www.haldex.com/en/europe/brands/haldex/ebs/eb_gen1_to_gen3/"),
    "haldex_eb4": ("EB+ 4.0", "https://www.haldex.com/en/europe/haldex-academy/courses/ebs-eb-4.0/348704-trainings2fc334b8a220f413a740a23a4ba11b8345.png", "https://www.haldex.com/en/europe/haldex-academy/"),
}
OUT = Path("app/src/debug/res/drawable-nodpi")
REPORT = Path("module-photo-review.json")
MAX_BYTES = 8 * 1024 * 1024

def prepare(item):
    key, (model, url, page) = item
    result = {"model_id": key, "variant": model, "image_url": url, "reference": page,
              "rights": "internal reference only; redistribution not cleared"}
    try:
        request = urllib.request.Request(url, headers={"User-Agent":"TrakSOS internal visual review/1.0"})
        with urllib.request.urlopen(request, timeout=18) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("image exceeds size limit")
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("PNG", "JPEG", "WEBP") or min(image.size) < 150:
                raise ValueError("not a usable image")
            if image.width * image.height > 20_000_000:
                raise ValueError("pixel count exceeds limit")
            image = ImageOps.exif_transpose(image).convert("RGBA")
            image.thumbnail((760, 760), Image.Resampling.LANCZOS)
            backdrop = Image.new("RGBA", image.size, (247, 248, 249, 255))
            backdrop.alpha_composite(image)
            target = OUT / ("module_" + key + ".webp")
            backdrop.convert("RGB").save(target, "WEBP", quality=88)
        result.update(status="downloaded", source_sha256=hashlib.sha256(raw).hexdigest(),
                      packed_sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    except Exception as exc:
        result.update(status="unavailable", error=str(exc)[:240])
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-apk", type=Path)
    args = parser.parse_args()
    if args.verify_apk:
        report = json.loads(REPORT.read_text(encoding="utf-8"))
        with zipfile.ZipFile(args.verify_apk) as apk:
            names = apk.namelist()
        for row in report:
            if row["status"] == "downloaded":
                expected = "module_" + row["model_id"] + ".webp"
                if not any(n.startswith("res/") and n.rsplit("/", 1)[-1] == expected for n in names):
                    raise SystemExit("missing packaged resource: " + expected)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for key in SOURCES:
        (OUT / ("module_" + key + ".webp")).unlink(missing_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        report = list(pool.map(prepare, SOURCES.items()))
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    successful = [r["model_id"] for r in report if r["status"] == "downloaded"]
    print("Downloaded reference photos:", ", ".join(successful))
    if len(successful) != len(SOURCES):
        raise SystemExit("Incomplete visual review: inspect photo report; do not publish incomplete APK")

if __name__ == "__main__":
    main()
