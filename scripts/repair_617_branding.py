#!/usr/bin/env python3
"""Remove lettering ONLY from the photographic pixels in owner-approved 617.
The exact 1536x324 composition, truck, highway, sky and map layout are retained.
Do not alter the original, byte-locked reference image.
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[1]
source=root/"web/public/owner20-photo-background-approved.webp"
target=root/"web/public/owner20-photo-brandless-20261122.webp"
image=np.asarray(Image.open(source).convert("RGB"))
h,w=image.shape[:2]
assert (w,h)==(1536,324),(w,h)
hsv=cv2.cvtColor(image,cv2.COLOR_RGB2HSV)
r,g,b=(image[:,:,0].astype(np.int16),image[:,:,1].astype(np.int16),image[:,:,2].astype(np.int16))
v=hsv[:,:,2].astype(np.int16)
sat=hsv[:,:,1].astype(np.int16)

# Restrict work to the *letter strokes*, never to entire rectangles: filling
# large polygonal regions distorted the curtain-side and sunset in review.
white=(v>119)&(sat<115)&(r>g-25)&(g>b-35)
orange=(r>122)&(r>g*1.20)&(g>b*1.05)&(sat>60)
letters=np.asarray(white|orange,dtype=np.uint8)*255
mask=np.zeros((h,w),np.uint8)
def select(poly,roi_letters=letters,expand=2):
    boundary=np.zeros_like(mask)
    cv2.fillPoly(boundary,[np.asarray(poly,np.int32)],255)
    letters_here=cv2.bitwise_and(roi_letters,boundary)
    if expand:
        letters_here=cv2.dilate(letters_here,np.ones((expand*2+1,expand*2+1),np.uint8))
        letters_here=cv2.bitwise_and(letters_here,boundary)
    cv2.bitwise_or(mask,letters_here,dst=mask)

# The large typographic logotype: diagonal perspective line stays pristine.
# No brand text will be baked into the new image; the accessible brand wordmark
# stays in the website's header, not on the truck.
select([[816,108],[912,166],[911,226],[815,212]],expand=2)
# Front strip of curtain-side graphic, not the sky around it.
select([[786,68],[810,80],[813,166],[785,153]],expand=2)
# Small letters on the upper cab visor.
cv2.rectangle(mask,(629,75),(700,96),255,-1)

# Tiny manufacturer badges / cab identification and licence plate.
cv2.ellipse(mask,(658,176),(8,8),0,0,360,255,-1)
cv2.ellipse(mask,(657,199),(8,8),0,0,360,255,-1)
cv2.rectangle(mask,(640,260),(688,269),255,-1)

fixed=cv2.inpaint(cv2.cvtColor(image,cv2.COLOR_RGB2BGR),mask,4,cv2.INPAINT_TELEA)
out=Image.fromarray(cv2.cvtColor(fixed,cv2.COLOR_BGR2RGB))
out.save(target,format="WEBP",quality=92,method=6)
print(f"exported {target.relative_to(root)}: {out.size} {target.stat().st_size} bytes; letter pixels: {np.count_nonzero(mask)}")
