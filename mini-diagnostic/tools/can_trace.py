"""Offline classic CAN log inspection. Never opens a CAN interface or transmits.
Supported input: numeric-timestamp candump compact data-frame lines (3/8-digit ID).
Unsupported records are counted as issues, never silently treated as valid data.
"""
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import argparse
import hashlib
import json
import re
import sys

MAX_BYTES = 16 * 1024 * 1024
MAX_FRAMES = 200_000
MAX_LINE = 256
LINE = re.compile(r"\(([0-9]{1,12})\.([0-9]{1,9})\)\s+([A-Za-z0-9_.-]{1,32})\s+([0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})#([0-9A-Fa-f]{0,16})",re.ASCII)

@dataclass(frozen=True)
class Frame:
    timestamp_ns: int
    interface: str
    can_id: int
    extended: bool
    data: bytes

    @property
    def key(self):
        return (self.interface, self.extended, self.can_id)

def parse_line(line):
    if len(line) > MAX_LINE:
        raise ValueError("LONG_LINE")
    m = LINE.fullmatch(line.strip())
    if not m:
        raise ValueError("UNSUPPORTED_OR_MALFORMED")
    seconds, fraction, interface, raw_id, raw_data = m.groups()
    extended = len(raw_id) == 8
    can_id = int(raw_id,16)
    if can_id > (0x1fffffff if extended else 0x7ff):
        raise ValueError("ID_OUT_OF_RANGE")
    if len(raw_data) % 2:
        raise ValueError("ODD_PAYLOAD")
    return Frame(int(seconds)*1_000_000_000 + int(fraction.ljust(9,"0")),
                 interface,can_id,extended,bytes.fromhex(raw_data))

def inspect(data):
    if len(data) > MAX_BYTES:
        raise ValueError("FILE_TOO_LARGE")
    # The format is ASCII; refuse an encoding mismatch rather than corrupting raw bytes.
    try:
        content = data.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ValueError("NON_ASCII_LOG") from exc
    frames = []
    issues = Counter()
    examples = []
    last = {}
    for number,line in enumerate(content.splitlines(),1):
        if not line.strip():
            continue
        try:
            if len(frames) >= MAX_FRAMES:
                raise ValueError("FRAME_LIMIT")
            f = parse_line(line)
            if f.interface in last and f.timestamp_ns < last[f.interface]:
                issues["NON_MONOTONIC_TIMESTAMP"] += 1
                if len(examples)<20:
                    examples.append({"line":number,"reason":"NON_MONOTONIC_TIMESTAMP"})
            last[f.interface] = f.timestamp_ns
            frames.append(f)
        except ValueError as exc:
            if str(exc) == "FRAME_LIMIT":
                raise
            issues[str(exc)] += 1
            if len(examples)<20:
                examples.append({"line":number,"reason":str(exc)})
    counts = Counter(f.key for f in frames)
    lengths = {}
    for f in frames:
        lengths.setdefault(f.key,Counter())[len(f.data)] += 1
    channels = [
        {"interface":iface,"extended":ext,"canId":format(cid,"08X" if ext else "03X"),
         "frames":count,"payloadLengths":dict(sorted(lengths[(iface,ext,cid)].items()))}
        for (iface,ext,cid),count in sorted(counts.items())
    ]
    return {"schema":"traksos.can-trace-summary.v1","sha256":hashlib.sha256(data).hexdigest(),
            "parsedFrames":len(frames),"issues":dict(issues),"issueExamples":examples,
            "parseClean":bool(frames) and not issues,"direction":"unknown",
            "captureCompleteness":"not_verified","ecuInterpretation":"none",
            "channels":channels}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("log",type=Path)
    p.add_argument("--output",type=Path,help="Write JSON to a new file; never overwrite an existing file.")
    args = p.parse_args()
    try:
        with args.log.open("rb") as source:
            summary = inspect(source.read(MAX_BYTES+1))
        report = json.dumps(summary,indent=2,ensure_ascii=False)+"\n"
        if args.output:
            with args.output.open("x",encoding="utf-8") as out:
                out.write(report)
        else:
            sys.stdout.write(report)
        return 0 if summary["parseClean"] else 2
    except (ValueError,OSError) as exc:
        print("Trace rejected: "+str(exc),file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
