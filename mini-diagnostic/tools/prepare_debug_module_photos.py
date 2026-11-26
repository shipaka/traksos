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

# Reference images represent a specific variant or named family, not every revision.
# Additional sources must be visually reviewed; unavailable images are not replaced with other models.
# Never reuse a photograph for another generation.
SOURCES = {
    # Additional model photographs reviewed against catalog captions and visible markings.
    "haldex_plc": ("PLC Select 1M AL919338", "https://www.kahgotruckparts.com/web/image/product.template/84508/image_1024?unique=91bce21", "https://www.kahgotruckparts.com/shop/haldex-electronic-control-unit-al919338-84508"),
    "bendix_tabs6": ("TABS-6 standard 4 port 2S/1M", "https://cdn.shopify.com/s/files/1/1750/0827/products/Screenshot_2023-06-01_at_12.13.14_PM_1024x1024.png?v=1685636019", "https://miamistar.com/products/bendix-ecu-valve-assembly-std-4-port-2s-1m-axle-only-abs-modulator-valve"),
    "kb_kb4ta": ("KB4TA ABS ECU K004236 / K004246", "https://d1mv2b9v99cq0i.cloudfront.net/eyJidWNrZXQiOiJ3ZWItbmluamEtaW1hZ2VzIiwia2V5IjoibW9kdHJhbnNuelwvaW1hZ2VzXC9wcm9kaW1nXC8yMjM1MF8xLmpwZyIsImVkaXRzIjp7InJlc2l6ZSI6eyJ3aWR0aCI6MTIwMCwiaGVpZ2h0Ijo2MzAsImZpdCI6Imluc2lkZSIsIndpdGhvdXRFbmxhcmdlbWVudCI6dHJ1ZX19LCJ2ZXJzaW9uIjoiMjJjMWNkNjA5NzQ4YjBlZWZlY2Y3YjA0NDg2NGE1MmZmNTEyYWRjOSJ9", "https://www.mtw.co.nz/product/22350-knorr-bremse-kb4ta-abs-ecu"),
    "kb_kb3ta": ("KB3-TA II33582 ES1215", "https://www.diagtrucks.fr/97-thickbox_default/systeme-abs-kb3ta-knorr-ii33582.jpg", "https://www.diagtrucks.fr/racine/101-systeme-abs-kb3ta-knorr-ii33582.html"),
    "haldex_modal": ("MODAL 950364081", "https://www.trucksystems.de/media/image/product/16377/lg/haldex-elektronikeinheit-ecu-abs-modul-24v-950364081.jpg", "https://www.trucksystems.de/Haldex-Elektronikeinheit-ECU-ABS-Modul-24V-950364081"),
    "haldex_modular": ("MODULAR 1+/2/2+ ADR reference example", "https://www.diagtrucks.fr/94-thickbox_default/systeme-abs-modular-1-modular-2-ou-modular-2-adr-haldex.jpg", "https://www.diagtrucks.fr/racine/98-systeme-abs-modular-1-modular-2-ou-modular-2-adr-haldex.html"),
    "zf_vcs": ("VCS I 4461080300", "https://www.wabco-customercentre.com/catalog/productImage/e6108030_tif.png", "https://www.wabco-customercentre.com/catalog/en/4461080300"),
    "zf_tcs_ii": ("TCS II 4005001010 2S/1M Basic MSH", "https://trucktotrailerparts.com/cdn/shop/files/s4005001010-genuine-meritor-wabco-r-trailer-abs-ecu-valve-truck-to-trailer-1.jpg?v=1754616947&width=1214", "https://trucktotrailerparts.com/products/s4005001010-genuine-meritor-wabco-trailer-abs-ecu-valve-s400-500-101-0"),
    "zf_vario_c": ("Vario C 4461050320 label visible", "https://www.lkw-bus-service.de/images/pictures/Wabco%20Steuerger%C3%A4t%204461050320.JPG", "https://www.lkw-bus-service.de/anhaenger-auflieger-steuergeraete-reparatur/abs-vario-c.html"),
    # Official SORL catalog 35503100090 shows KORMEE cast into the cover and
    # SORL identification on the rear label. This is the listed TABS+RSS
    # assembly, not evidence for every KORMEE TEBS generation.
    "sorl_trailer_abs": ("SORL 35503100090 TABS+RSS 4S/2M, KORMEE-marked housing", "https://sorl.ru/img/prods/47518/tmb/35503100090.webp?v5=", "https://sorl.ru/catalog/35503100090"),
    "haldex_eb1": ("EB+ Gen1 2M main assembly, official small catalog image", "https://www.haldex.com/globalassets/europe/3.-trailer-application-guide/trailer-guide/xq_img/image79.jpg", "https://www.haldex.com/en/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen1-series/"),
    "haldex_uabs": ("364564001 U-ABS Premium assembly", "https://www.trucksystems.de/media/image/product/35145/lg/haldex-abs-ventileinheit-premium-uabs-364564001.jpg", "https://www.trucksystems.de/Haldex-ABS-Ventileinheit-Premium-UABS-364564001"),
    "kb_g20": ("K019349V02N50, G2.0 Standard", "https://landwirtschaft.rw.net/medias/940Wx705H-K019349V02N50.webp?context=bWFzdGVyfHJhaWZmZWlzZW5BZ3Jhcnw4NTY0MnxpbWFnZS93ZWJwfGNtRnBabVpsYVhObGJrRm5jbUZ5TDJobFpTOW9OR1V2TVRBd05UWTBPRE0zT1Rrd056QXVkMlZpY0F8ODUxMzdlM2Q4OWRmODk2YzljZDVkODRlMGI5OWE5ODgzMmY4MGE1ZjZiZTBmNzhkOTE5YzU4YjY4MGQ5ODQ3NA", "https://landwirtschaft.rw.net/KNORR-Bremse-TEBS-G20-Standard-Anhaengermodul/p/826K019349V02N50"),
    "kb_g21": ("G2.1, MTW 189022", "https://d1mv2b9v99cq0i.cloudfront.net/eyJidWNrZXQiOiJ3ZWItbmluamEtaW1hZ2VzIiwia2V5IjoibW9kdHJhbnNuelwvaW1hZ2VzXC9wcm9kaW1nXC8yNDg1OF8xLmpwZyIsImVkaXRzIjp7InJlc2l6ZSI6eyJ3aWR0aCI6MTIwMCwiaGVpZ2h0Ijo2MzAsImZpdCI6Imluc2lkZSIsIndpdGhvdXRFbmxhcmdlbWVudCI6dHJ1ZX19LCJ2ZXJzaW9uIjoiMzBmMzM2NzFlYjVlY2M2NTgwMjI2YWQxOTU3MDA1YTM0Nzg2ZGFkMiJ9", "https://www.mtw.co.nz/product/24858-knorr-bremse-g2-1-tebs-ecu"),
    "kb_tebs4": ("II39782N50 / ES2053", "https://trucktrailerspares.com.au/cdn/shop/files/II39782N5020EBS20Trailer20Module20ES2053-600x600-1_1200x1200.jpg?v=1722425338", "https://trucktrailerspares.com.au/products/knorr-bremse-ebs-trailer-module-ii39782n50-es2053"),
    "haldex_eb2": ("EB+ Generation 2, installation guide", "https://data.manualslib.fr/product-images/856/509520/haldex-eb-generation-2.jpg", "https://www.manualslib.fr/manual/509520/Haldex-Ebplus-Generation-2.html"),
    "zf_vcs_ii": ("4005000700 VCS II Standard 2S/2M", "https://www.trucksystems.de/media/image/product/9293/lg/wabco-abs-elektronik-vcs2-4005000700-400-500-070-0.jpg", "https://www.trucksystems.de/Wabco-ABS-Elektronik-VCS2-4005000700-400-500-070-0"),
    "vie_tebs": ("VIE TEBS family, revision not identified", "https://static.tildacdn.com/tild3237-6465-4133-b535-366233353862/IMG_2593.png", "https://alger-truckdiag.ru/tebsevstebsvie"),

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
REQUIRED = {"zf_tebs_d","zf_tebs_e","zf_iebs","kb_g22","kb_itebs_x","haldex_eb3","haldex_eb4"}

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
            if image.format not in ("PNG", "JPEG", "WEBP") or min(image.size) < (100 if key == "haldex_eb1" else 150):
                raise ValueError("not a usable image")
            if image.width * image.height > 20_000_000:
                raise ValueError("pixel count exceeds limit")
            result["original_size"] = list(image.size)
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
    # Reject exact duplicate source photos across different model IDs, never substitute a generic image.
    by_hash = {}
    for row in report:
        if row["status"] == "downloaded":
            by_hash.setdefault(row["source_sha256"], []).append(row)
    for group in by_hash.values():
        if len(group) > 1:
            for row in group:
                (OUT / ("module_" + row["model_id"] + ".webp")).unlink(missing_ok=True)
                row.update(status="unavailable", error="identical source image used for multiple model families")
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    successful = [r["model_id"] for r in report if r["status"] == "downloaded"]
    print("Downloaded reference photos:", ", ".join(successful))
    missing = REQUIRED - set(successful)
    if missing:
        raise SystemExit("Missing established reference photos: " + ", ".join(sorted(missing)))
    print("Additional photo coverage:", len(successful), "/", len(SOURCES), "inspect report for missing images")

if __name__ == "__main__":
    main()
