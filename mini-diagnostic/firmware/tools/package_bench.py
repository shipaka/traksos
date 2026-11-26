"""Package a clean, classic ESP32 4MB USB-only bench image; not an OTA update."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".pio/build/esp32_bench_ble"
DIST = ROOT / "dist"
LIMIT = 4 * 1024 * 1024
OFFSETS = (0x1000, 0x8000, 0xe000, 0x10000)

def verify_layout(parts):
    if tuple(offset for offset, _ in parts) != OFFSETS:
        raise ValueError("Unexpected flash offsets")
    for i, (offset, data) in enumerate(parts):
        end = OFFSETS[i+1] if i+1 < len(OFFSETS) else LIMIT
        if not data or offset + len(data) > end:
            raise ValueError(f"Image missing or overlaps: {offset:#x}")
    if parts[0][1][0] != 0xe9 or parts[3][1][0] != 0xe9:
        raise ValueError("Not ESP application images")
    if parts[1][1][:2] != bytes.fromhex("aa50"):
        raise ValueError("Invalid partition table")
    # Default Arduino application must actually be located at 0x10000.
    import struct
    entries = [struct.unpack("<HBBII16sI",parts[1][1][i:i+32])
               for i in range(0,len(parts[1][1])-31,32)]
    if not any(magic==0x50aa and kind==0 and off==0x10000 and len(parts[3][1])<=size and off+size<=LIMIT
               for magic,kind,sub,off,size,label,flags in entries):
        raise ValueError("No compatible app partition")

def main():
    packages = Path(os.environ.get("PLATFORMIO_CORE_DIR",Path.home()/".platformio"))/"packages"
    files = [BUILD/"bootloader.bin",BUILD/"partitions.bin",
             packages/"framework-arduinoespressif32/tools/partitions/boot_app0.bin",
             BUILD/"firmware.bin"]
    parts = [(offset,path.read_bytes()) for offset,path in zip(OFFSETS,files)]
    verify_layout(parts)
    DIST.mkdir(exist_ok=True)
    image = DIST/"traksos-bench-esp32-4mb.bin"
    cmd = [sys.executable,"-m","esptool","--chip","esp32","merge_bin",
           "-o",str(image),"--flash_mode","dio","--flash_freq","40m","--flash_size","4MB"]
    for offset,path in zip(OFFSETS,files):
        cmd.extend([hex(offset),str(path)])
    subprocess.run(cmd,check=True)
    data=image.read_bytes()
    if len(data)>LIMIT or data[0x1000]!=0xe9:
        raise ValueError("Bad merged image")
    for offset,part in parts[1:]:
        if data[offset:offset+len(part)] != part:
            raise ValueError(f"Merged segment mismatch {offset:#x}")
    (DIST/"manifest.json").write_text(json.dumps({
        "target":"esp32","flashBytes":LIMIT,"offset":0,"purpose":"USB-only BLE bench",
        "image":image.name,"sha256":hashlib.sha256(data).hexdigest(),
        "sourceCommit":os.environ.get("GITHUB_SHA","local")
    },indent=2),encoding="utf-8")
    for name in ("flash-windows.ps1","FLASH-WINDOWS.cmd","README-FLASH.txt"):
        shutil.copyfile(ROOT/"tools"/name,DIST/name)

if __name__=="__main__":
    main()
