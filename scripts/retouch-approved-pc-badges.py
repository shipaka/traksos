#!/usr/bin/env python3
"""Surgical, pixel-local removal of two foreign maker badges from the EXACT
owner-approved 617 PC photo/atlas. The truck, TrakSOS trailer, sunset, road,
map and every non-badge pixel remain identical to the approved originals.

Creates separate review derivatives; never overwrites the original images.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path("web/public")
OUT = Path("e2e/shots/approved-pc-badge-retouch")
ASSETS = [
  {
    "original": "owner20-photo-background-approved.webp",
    "output": "owner20-photo-background-approved-retouched.webp",
    "git_sha": "10a03e182ad463c8d36107adec38428ec8095a8c",
    "size": (1536, 324),
    "areas": [(648, 166, 666, 182), (649, 188, 667, 202)],
    "inspection": (625, 143, 690, 222)
  },
  {
    "original": "owner20-artwork-sprite.webp",
    "output": "owner20-artwork-sprite-retouched.webp",
    "git_sha": "63a31c0c6420e0c1bf1b6a11350e46f89ed71f24",
    "size": (1018, 446),
    "areas": [(98, 165, 114, 182), (99, 188, 115, 202)],
    "inspection": (80, 143, 145, 222)
  }
]

def git_sha(data:bytes)->str:
  return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()

def retouch_one(conf:dict)->dict:
  path=ROOT/conf["original"]
  raw=path.read_bytes()
  if git_sha(raw)!=conf["git_sha"]:
    raise SystemExit(f"Original file changed; refusing surgery on {path}")
  original=np.array(Image.open(path).convert("RGBA"))
  if (original.shape[1],original.shape[0])!=conf["size"]:
    raise SystemExit(f"Wrong native source dimensions for {path}")
  result=original.copy()
  allowed=np.zeros(original.shape[:2], dtype=bool)
  # Follow surrounding original paint and grille by interpolating along the
  # SAME source row; no artificial opaque overlay, blur or added gradient layer.
  for x0,y0,x1,y1 in conf["areas"]:
    allowed[y0:y1,x0:x1]=True
    for y in range(y0,y1):
      left=original[y,x0-1,:3].astype(np.float64)
      right=original[y,x1,:3].astype(np.float64)
      for x in range(x0,x1):
        t=(x-x0+1)/(x1-x0+1)
        result[y,x,:3]=np.rint((1-t)*left+t*right).astype(np.uint8)
  changed=np.any(original!=result,axis=2)
  if not np.any(changed) or np.any(changed & ~allowed):
    raise SystemExit(f"Unexpected change outside maker badges in {path}")
  if np.any(original[:,:,3]!=result[:,:,3]):
    raise SystemExit(f"Alpha changed in {path}")
  target=ROOT/conf["output"]
  Image.fromarray(result).save(target,"WEBP",lossless=True,method=6,exact=True)
  roundtrip=np.array(Image.open(target).convert("RGBA"))
  if np.any(roundtrip!=result):
    raise SystemExit(f"WEBP recompression changed original pixels in {target}")
  # Review artifacts contain original, result, inspection 4x and change mask.
  source_im=Image.fromarray(original)
  updated_im=Image.fromarray(result)
  box=conf["inspection"]
  title=conf["original"].replace(".webp","")
  source_im.save(OUT/(title+"-before.png"))
  updated_im.save(OUT/(title+"-after.png"))
  for label,im in [("before",source_im),("after",updated_im)]:
    crop=im.crop(box)
    crop.resize((crop.width*4,crop.height*4),Image.Resampling.NEAREST).save(OUT/(title+"-badge-"+label+"-4x.png"))
  diff=np.zeros((original.shape[0],original.shape[1],4),dtype=np.uint8)
  diff[changed]=(255,124,53,255)
  Image.fromarray(diff).save(OUT/(title+"-changed-only.png"))
  summary={
    "original":str(path),"output":str(target),
    "original_blob_sha":conf["git_sha"],
    "output_sha256":hashlib.sha256(target.read_bytes()).hexdigest(),
    "size":conf["size"],"allowed_rectangles_xyxy":conf["areas"],
    "modified_pixels":int(changed.sum()),
    "outside_rectangles_modified_pixels":int((changed & ~allowed).sum()),
    "alpha_modified_pixels":0,
    "trailer_sign_modified_pixels":0,
    "approval":"REVIEW CANDIDATE — not a new truck or full-scene redesign"
  }
  return summary

def main():
  OUT.mkdir(parents=True,exist_ok=True)
  records=[retouch_one(a) for a in ASSETS]
  (OUT/"proof.json").write_text(json.dumps(records,ensure_ascii=False,indent=2)+"\n")
  print(json.dumps(records,ensure_ascii=False,indent=2))
if __name__=="__main__":
  main()
