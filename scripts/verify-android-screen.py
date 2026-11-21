#!/usr/bin/env python3
"""Reject blank Android screencaps using only Python standard library."""
import collections
import pathlib
import struct
import sys
import zlib

PNG = b'\x89PNG\r\n\x1a\n'

def pixel_stats(path):
    buf = pathlib.Path(path).read_bytes()
    if not buf.startswith(PNG):
        raise ValueError('not a PNG')
    i = len(PNG)
    width = height = channels = None
    data = bytearray()
    while i < len(buf):
        length = struct.unpack('>I', buf[i:i + 4])[0]
        tag = buf[i + 4:i + 8]
        chunk = buf[i + 8:i + 8 + length]
        i += 12 + length
        if tag == b'IHDR':
            width, height, depth, color, comp, filt, interlace = struct.unpack('>IIBBBBB', chunk)
            if depth != 8 or color not in (2, 6) or interlace or comp or filt:
                raise ValueError(f'unsupported PNG format {depth}/{color}/{interlace}')
            channels = 3 if color == 2 else 4
        elif tag == b'IDAT':
            data.extend(chunk)
        elif tag == b'IEND':
            break
    if not width or not height or not data:
        raise ValueError('missing PNG image data')
    scan = zlib.decompress(data)
    stride = width * channels
    previous = bytearray(stride)
    pos = 0
    hist = collections.Counter()
    pixels = bytearray()
    for y in range(height):
        method = scan[pos]
        pos += 1
        curr = bytearray(scan[pos:pos + stride])
        pos += stride
        for k in range(stride):
            a = curr[k - channels] if k >= channels else 0
            b = previous[k]
            c = previous[k - channels] if k >= channels else 0
            if method == 0: add = 0
            elif method == 1: add = a
            elif method == 2: add = b
            elif method == 3: add = (a + b) // 2
            elif method == 4:
                p = a + b - c
                d = (abs(p-a), abs(p-b), abs(p-c))
                add = (a, b, c)[d.index(min(d))]
            else: raise ValueError(f'unknown PNG filter {method}')
            curr[k] = (curr[k] + add) & 255
        if height // 10 < y < height * 9 // 10 and y % 3 == 0:
            for x in range(width // 10, width * 9 // 10, 3):
                off = x * channels
                rgb = bytes(curr[off:off + 3])
                hist[rgb] += 1
                pixels.extend(rgb)
        previous = curr
    return width, height, pixels, len(hist), hist.most_common(1)[0][1] / (len(pixels) // 3)

if __name__ == '__main__':
    try:
        w, h, pixels, distinct, dom = pixel_stats(sys.argv[1])
        print(f'Android screenshot {w}x{h}: {distinct} sampled colors, largest color {dom:.1%} of app viewport')
        if distinct < 30 or dom > .92:
            raise ValueError('App viewport appears uniform/black; guest UI not visibly rendered')
        for previous in sys.argv[2:]:
            pw, ph, other, _, _ = pixel_stats(previous)
            if (pw, ph) != (w, h):
                raise ValueError('screen dimensions changed between roles')
            # Ignore system bars and tiny animation/clock changes.
            changed = sum(abs(a - b) > 16 for a, b in zip(pixels, other))
            if changed < 0.02 * len(pixels):
                raise ValueError(f'app content still resembles {previous}')
    except (OSError, IndexError, ValueError, EOFError) as e:
        print(f'FAIL: screenshot validation: {e}', file=sys.stderr)
        sys.exit(1)
