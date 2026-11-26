"""Strict optional offline review of complete UDS PDU files.
Not a transport decoder, identity authentication, or permission to transmit.
"""
import re

MAX_IDENTITY = 32768
MAX_DTC = 32768
DIDS = {"F187", "F189", "F18A", "F191", "F192", "F193", "F194", "F195"}
HEX = re.compile(r"(?:[0-9a-fA-F]{2})+", re.ASCII)
BYTE_LIST = re.compile(r"[0-9a-fA-F]{2}(?:[ \t]+[0-9a-fA-F]{2})*", re.ASCII)

def lines(data, maximum):
    if not 0 < len(data) <= maximum:
        raise ValueError("SIZE")
    try:
        raw = data.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ValueError("NON_ASCII") from exc
    result = raw.strip(" \t\r\n").splitlines()
    if not 1 <= len(result) <= 64 or any(not x.strip() for x in result):
        raise ValueError("ROW_COUNT_OR_BLANK")
    return result

def pdu(text, maximum):
    text = text.strip(" \t")
    if HEX.fullmatch(text):
        compact = text
    elif BYTE_LIST.fullmatch(text):
        compact = "".join(text.split())
    else:
        raise ValueError("INVALID_HEX")
    if not 1 <= len(compact)//2 <= maximum:
        raise ValueError("PDU_LENGTH")
    return bytes.fromhex(compact)

def identity_review(data):
    values, negative = {}, []
    for row in lines(data, MAX_IDENTITY):
        match = re.fullmatch(r"([0-9A-Fa-f]{4})[ \t]*:[ \t]*(.+)", row)
        if not match:
            raise ValueError("IDENTITY_ROW")
        did = match[1].upper()
        if did not in DIDS:
            raise ValueError("UNKNOWN_DID")
        raw = pdu(match[2], 259)
        if len(raw) == 3 and raw[:2] == b"\x7f\x22":
            negative.append({"did": did, "reason": raw[2]})
            continue
        if len(raw) < 4 or raw[:3] != bytes.fromhex("62"+did):
            raise ValueError("IDENTITY_REPLY")
        value = raw[3:].hex().upper()
        if did in values and values[did] != value:
            raise ValueError("CONFLICTING_IDENTITY")
        values[did] = value
    missing = []
    for name, alternatives in (
        ("supplier", {"F18A"}), ("part", {"F187"}),
        ("hardware", {"F191", "F192"}), ("software", {"F189", "F195"})
    ):
        if not alternatives.intersection(values):
            missing.append(name)
    return {"observed": values, "negative": negative, "missing_fields": missing,
            "electronic_identity_verified": False}

def dtc_review(data):
    # Explicit grammar: MASK: xx then one COUNT and one LIST, complete positive PDUs.
    # Negative/pending replies are not interpreted as empty lists.
    rows = lines(data, MAX_DTC)
    if len(rows) != 3:
        raise ValueError("DTC_ROW_COUNT")
    entries = {}
    for row in rows:
        m = re.fullmatch(r"(MASK|COUNT|LIST)[ \t]*:[ \t]*(.+)", row)
        if not m or m[1] in entries:
            raise ValueError("DTC_ROW")
        entries[m[1]] = pdu(m[2], 4095)
    requested, count, listed = (entries[k] for k in ("MASK", "COUNT", "LIST"))
    if len(requested) != 1 or not requested[0]:
        raise ValueError("STATUS_FILTER")
    if len(count) != 6 or count[:2] != b"\x59\x01":
        raise ValueError("COUNT_REPLY")
    if len(listed) < 3 or listed[:2] != b"\x59\x02" or (len(listed)-3)%4:
        raise ValueError("LIST_REPLY")
    if count[2] != listed[2] or not (requested[0] & count[2]):
        raise ValueError("STATUS_FILTER_OR_MASK")
    effective = requested[0] & count[2]
    codes = set()
    for i in range(3, len(listed), 4):
        code, status = listed[i:i+3], listed[i+3]
        if code in codes:
            raise ValueError("DUPLICATE_DTC")
        if not status & effective:
            raise ValueError("RECORD_OUTSIDE_STATUS_FILTER")
        codes.add(code)
    number = int.from_bytes(count[4:6], "big")
    return {"requested_mask": requested[0], "availability_mask": count[2],
            "format_identifier": count[3], "reported_count": number,
            "list_records": len(codes), "counts_match": number == len(codes),
            "same_observation_interval_verified": False, "physical_source_verified": False}
