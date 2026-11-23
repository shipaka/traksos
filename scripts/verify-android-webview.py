#!/usr/bin/env python3
"""Inspect the *installed* Android debug WebView over local Chrome DevTools.

On the CI Android 15 emulator, 'adb shell uiautomator dump' can wedge the
entire emulator and drop ADB. This alternative inspects the live browser DOM
over the ADB-forwarded WebView socket, then the shell test separately demands
actual distinct screenshots. Never run it against release APKs or real users.
No extra pip/npm packages, network hosts, or server credentials are needed.
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import urllib.request
from urllib.parse import urlparse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 2_000_000


def exactly(sock, length, initial=b""):
    buf = bytearray(initial)
    while len(buf) < length:
        part = sock.recv(length - len(buf))
        if not part:
            raise ConnectionError("DevTools socket closed unexpectedly")
        buf.extend(part)
    return bytes(buf)


def send_frame(sock, payload, opcode=1):
    mask = os.urandom(4)
    length = len(payload)
    if length < 126:
        header = bytes([0x80 | opcode, 0x80 | length])
    elif length < 65536:
        header = bytes([0x80 | opcode, 0x80 | 126]) + struct.pack("!H", length)
    else:
        header = bytes([0x80 | opcode, 0x80 | 127]) + struct.pack("!Q", length)
    sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))


def read_frame(sock):
    first, second = exactly(sock, 2)
    opcode = first & 15
    length = second & 127
    if length == 126:
        length = struct.unpack("!H", exactly(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", exactly(sock, 8))[0]
    if length > MAX_FRAME:
        raise ValueError("Unexpectedly large DevTools frame")
    mask = exactly(sock, 4) if second & 128 else None
    data = exactly(sock, length)
    if mask:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return opcode, data


def evaluate(target, role, port):
    ws = urlparse(target["webSocketDebuggerUrl"])
    if ws.scheme != "ws" or ws.hostname not in ("127.0.0.1", "localhost") or ws.port != port:
        raise ValueError("DevTools returned a non-loopback WebSocket")
    with socket.create_connection(("127.0.0.1", port), timeout=6) as sock:
        sock.settimeout(6)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {ws.path} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(request.encode("ascii"))
        head = b""
        while b"\r\n\r\n" not in head:
            head += exactly(sock, 1)
            if len(head) > 16384:
                raise ValueError("DevTools sent an oversized HTTP handshake")
        if not head.startswith(b"HTTP/1.1 101 "):
            raise ConnectionError("Live WebView refused DevTools handshake")
        accepted = base64.b64encode(
            hashlib.sha1((key + GUID).encode("ascii")).digest()
        ).decode("ascii")
        if ("sec-websocket-accept: " + accepted).lower() not in head.decode(
            "latin1"
        ).lower():
            raise ConnectionError("Incorrect DevTools WebSocket handshake")
        # The URL and DOM must both match this specific real APK review route.
        # These are real AndroidClientWorkspace / AndroidPerformerWorkspace
        # components (not static screenshots or a mocked browser).
        expression = """(() => {
          const root = document.querySelector('.and19-review-page');
          const text = root?.innerText || '';
          const role = LOCATION_ROLE;
          const marker = role === 'client' ? 'Владелец автопарка' : 'Сегодня';
          return {
            correctRoute: location.hash === '#/android-review/' + role,
            mounted: !!root && !!root.querySelector('.and19-review-live'),
            heading: text.includes('Рабочий стол'),
            roleMarker: text.includes(marker),
            isDemo: text.includes('ДЕМО APK'),
            ready: document.readyState === 'complete'
          };
        })()""".replace("LOCATION_ROLE", json.dumps(role))
        send_frame(sock, json.dumps({
            "id": 1, "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True}
        }).encode("utf-8"))
        for _ in range(30):
            opcode, payload = read_frame(sock)
            if opcode == 9:
                send_frame(sock, payload, opcode=10)
                continue
            if opcode == 8:
                raise ConnectionError("DevTools socket closed before evaluation")
            if opcode != 1:
                continue
            reply = json.loads(payload)
            if reply.get("id") != 1:
                continue
            if "error" in reply or "exceptionDetails" in reply.get("result", {}):
                raise ValueError("WebView evaluation failed")
            value = reply.get("result", {}).get("result", {}).get("value", {})
            if all(value.get(field) is True for field in (
                "correctRoute", "mounted", "heading", "roleMarker", "isDemo", "ready"
            )):
                print(f"ANDROID_WEBVIEW_ROLE_DOM_CONFIRMED={role}")
                return
            raise ValueError("Wrong or incomplete live WebView role DOM: " +
                             ",".join(k for k, v in value.items() if v is False))
        raise TimeoutError("Live WebView never answered DOM query")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=("client", "master"))
    parser.add_argument("--port", type=int, default=9222)
    args = parser.parse_args()
    if args.port != 9222:
        raise ValueError("Unexpected CI DevTools port")
    with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json/list", timeout=6) as r:
        targets = json.load(r)
    candidates = [t for t in targets if t.get("type") == "page"
                  and t.get("webSocketDebuggerUrl")
                  and "#/android-review/" + args.role in t.get("url", "")]
    if len(candidates) != 1:
        raise ValueError("No unique live APK WebView review target found")
    evaluate(candidates[0], args.role, args.port)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TimeoutError, ConnectionError,
            json.JSONDecodeError) as exc:
        print("FAIL: real Android WebView role DOM: " + str(exc), file=sys.stderr)
        sys.exit(1)
