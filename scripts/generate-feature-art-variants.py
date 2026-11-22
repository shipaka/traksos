#!/usr/bin/env python3
"""Regenerate TrakSOS feature art for every screen from five immutable masters.

Usage (requires Pillow): python3 scripts/generate-feature-art-variants.py --write

Do not edit just the Android or mobile image; this regenerates all three sizes
for each service, updates integrity hashes, and keeps the visual identity.
The owner's 617/618 layout and real clicks must still pass manual screenshot QA.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent / 'web/public/feature-art'
KEYS = ('tech', 'ecu', 'parts', 'insurance', 'inspection')
VARIANTS = {
    'desktop': ((512, 300), 87),
    'mobile': ((360, 210), 81),
    'android': ((256, 150), 75),
}

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true', help='explicitly re-export all responsive images')
    args = parser.parse_args()
    manifest_path = ROOT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert set(manifest['features']) == set(KEYS), 'Missing or extra feature id'
    for key in KEYS:
        meta = manifest['features'][key]
        master_url = meta['variants']['master']['url']
        master_path = ROOT / Path(master_url).name
        with Image.open(master_path) as image:
            source = image.convert('RGB')
            if source.width < 512 or source.height < 512:
                raise RuntimeError(f'{key}: master too small for approved cards')
            for variant, (size, quality) in VARIANTS.items():
                asset = meta['variants'][variant]
                target = ROOT / Path(asset['url']).name
                if args.write:
                    crop = ImageOps.fit(source, size, method=Image.Resampling.LANCZOS,
                                        centering=(0.5, 0.53))
                    crop.save(target, format='WEBP', quality=quality, method=6)
                if not target.is_file():
                    raise RuntimeError(f'{key}: missing {target}')
                asset.update(width=size[0], height=size[1],
                             bytes=target.stat().st_size, sha256=digest(target))
        meta['variants']['master']['bytes'] = master_path.stat().st_size
        meta['variants']['master']['sha256'] = digest(master_path)
    if args.write:
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',encoding='utf-8')
        print('Rebuilt all 15 responsive assets and refreshed manifest; review screenshots before merge')
    else:
        print('Read-only inspection complete. Use --write to rebuild every platform together')

if __name__ == '__main__':
    run()
