#!/usr/bin/env python3
"""Read PB library containers; emit metadata, never execute/extract payload code.

Original bounded implementation of the block layout documented by Arnd Schmidt:
https://www.dwox.com/PBL_File_Format.txt (PB5--11.5; reverse-engineered).
Only container layout is implemented. P-code/events/functions are NOT decoded.
Python 3.10+, standard library only. See RUNBOOK.md for limits and evidence tiers.
"""
import argparse
import collections
import hashlib
import json
import re
import struct
from pathlib import Path

VERSION = "1.0"
FORMAT_SOURCE = "https://www.dwox.com/PBL_File_Format.txt"
TERMS = ["sqlca", "sqlcode", "commit", "rollback", "connect", "disconnect",
         "dbbackup", "dbunload", "dbvalid", "dbeng8", "dbeng9", "saveas",
         "retrieve", "settransobject", "update", "accepttext", "datawindow",
         "profileint", "profilestring", "setprofilestring", "filecopy", "filemove",
         "filedelete", "run", "open", "postevent", "triggerevent", "dynamic",
         "凭证", "审核", "记账", "结账", "结转", "备份", "恢复", "成本", "分配"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Invalid(ValueError):
    pass


def u16(data, off):
    if off < 0 or off + 2 > len(data):
        raise Invalid("u16_out_of_bounds")
    return struct.unpack_from("<H", data, off)[0]


def u32(data, off):
    if off < 0 or off + 4 > len(data):
        raise Invalid("u32_out_of_bounds")
    return struct.unpack_from("<I", data, off)[0]


def physical_spans(segments, start, size):
    spans = []
    for s in segments:
        a, b = max(start, s["object_offset"]), min(start + size, s["object_offset"] + s["bytes"])
        if b > a:
            spans.append({"file_offset": s["file_offset"] + a - s["object_offset"], "bytes": b - a})
    return spans


def string_hints(data, segments, limit):
    """Keyword/token occurrence only: these records do not establish execution."""
    terms, tokens = [], []
    lowered = data.lower()
    for term in TERMS:
        for enc in ("ascii", "utf-16le", "cp936"):
            try:
                needle = term.encode(enc)
            except UnicodeEncodeError:
                continue
            if enc == "cp936" and needle == term.encode("utf-8"):
                continue  # avoid duplicate ASCII record
            pos, n = 0, 0
            while n < 8:
                found = lowered.find(needle.lower(), pos)
                if found < 0:
                    break
                terms.append({"term": term, "encoding": enc, "object_offset": found,
                              "file_spans": physical_spans(segments, found, len(needle))})
                n += 1
                pos = found + len(needle)
    patterns = [("ascii", rb"[A-Za-z_][A-Za-z_0-9.$]{2,160}"),
                ("utf-16le", rb"(?:[A-Za-z_]\x00)(?:[A-Za-z_0-9.$]\x00){2,160}")]
    for enc, pattern in patterns:
        for match in re.finditer(pattern, data):
            token = match.group().decode(enc)
            # Return only PB-style names, not arbitrary strings or SQL/code bodies.
            if re.match(r"(?i)^(?:w_|m_|d_|u_|n_|f_|s_|gf_|gn_|of_|ue_)", token):
                tokens.append({"token": token, "encoding": enc, "object_offset": match.start(),
                               "file_spans": physical_spans(segments, match.start(), len(match.group()))})
                if len(tokens) >= limit:
                    break
        if len(tokens) >= limit:
            break
    return {"classification": "string_occurrences_not_calls", "keyword_hints": terms,
            "name_hints": tokens, "name_hint_limit": limit,
            "name_hint_limit_reached": len(tokens) >= limit}


class Library:
    def __init__(self, data, header, max_object_bytes=32 * 1024 * 1024, hint_limit=100):
        self.data, self.header = data, header
        self.max_object_bytes, self.hint_limit = max_object_bytes, hint_limit
        self.errors, self.objects, self.nodes = [], [], []
        if data[header:header + 4] != b"HDR*":
            raise Invalid("missing_HDR")
        if data[header + 4:header + 16] == b"PowerBuilder":
            self.encoding, self.header_size, self.entry_size, self.version_pos = "cp936", 512, 24, 18
            self.scc_offset_pos = 284
        elif data[header + 4:header + 28] == "PowerBuilder".encode("utf-16le"):
            self.encoding, self.header_size, self.entry_size, self.version_pos = "utf-16le", 1024, 28, 32
            self.scc_offset_pos = 558
        else:
            raise Invalid("HDR_product_signature_not_PowerBuilder")
        if header + self.header_size > len(data):
            raise Invalid("truncated_header")
        self.format_version = data[header + self.version_pos:header + self.version_pos + (8 if self.encoding == "utf-16le" else 4)].decode(self.encoding, errors="replace")

    def chain(self, pointer, declared):
        if declared > self.max_object_bytes:
            return None, [], ["object_exceeds_byte_limit"]
        out, spans, errors, seen = bytearray(), [], [], set()
        while pointer:
            if pointer in seen:
                errors.append("DAT_chain_cycle")
                break
            seen.add(pointer)
            if len(seen) > (declared // 1 + 2) or len(seen) > len(self.data) // 10 + 1:
                errors.append("DAT_chain_limit")
                break
            if pointer % 512 or pointer + 10 > len(self.data) or self.data[pointer:pointer + 4] != b"DAT*":
                errors.append("invalid_DAT_pointer_or_signature")
                break
            next_pointer, length = u32(self.data, pointer + 4), u16(self.data, pointer + 8)
            if length > 502 or pointer + 10 + length > len(self.data):
                errors.append("invalid_DAT_length")
                break
            if len(out) + length > declared:
                errors.append("DAT_bytes_exceed_declared_size")
                break
            spans.append({"object_offset": len(out), "file_offset": pointer + 10,
                          "bytes": length, "block_offset": pointer, "next_block_raw": next_pointer})
            out.extend(self.data[pointer + 10:pointer + 10 + length])
            pointer = next_pointer
        if len(out) != declared:
            errors.append("DAT_bytes_differ_from_declared_size")
        return bytes(out), spans, errors

    def node(self, offset):
        if offset % 512 or offset + 3072 > len(self.data) or self.data[offset:offset + 4] != b"NOD*":
            raise Invalid("invalid_NOD_pointer_or_signature")
        count, free = u16(self.data, offset + 20), u16(self.data, offset + 16)
        if free > 3040 or count > 3040 // self.entry_size:
            raise Invalid("invalid_NOD_counts")
        info = {"file_offset": offset, "left_raw": u32(self.data, offset + 4),
                "parent_raw": u32(self.data, offset + 8), "right_raw": u32(self.data, offset + 12),
                "entry_count": count, "free_bytes": free, "entries_parsed": 0}
        pos = offset + 32
        for _ in range(count):
            if pos + self.entry_size > offset + 3072 or self.data[pos:pos + 4] != b"ENT*":
                self.errors.append({"offset": pos, "error": "invalid_ENT_signature_or_bounds"})
                break
            delta = 4 if self.encoding == "utf-16le" else 0
            pointer, size = u32(self.data, pos + 8 + delta), u32(self.data, pos + 12 + delta)
            comment_size, name_size = u16(self.data, pos + 20 + delta), u16(self.data, pos + 22 + delta)
            if name_size == 0 or pos + self.entry_size + name_size > offset + 3072 or (delta and name_size % 2):
                self.errors.append({"offset": pos, "error": "invalid_ENT_name_length"})
                break
            raw_name = self.data[pos + self.entry_size:pos + self.entry_size + name_size]
            name = raw_name.decode(self.encoding, errors="replace").rstrip("\x00")
            blob, spans, errors = self.chain(pointer, size)
            obj = {"entry_offset": pos, "node_offset": offset, "name": name,
                   "name_raw_sha256": sha(raw_name), "name_encoding": self.encoding,
                   "entry_extension": name.rsplit(".", 1)[-1].lower() if "." in name else None,
                   "type_evidence": "entry_extension_only_runtime_class_not_decoded",
                   "entry_format_version": self.data[pos + 4:pos + 8 + delta].decode(self.encoding, errors="replace"),
                   "declared_bytes": size, "first_data_block_raw": pointer,
                   "comment_bytes_declared": comment_size, "data_segments": spans,
                   "chain_status": "complete" if not errors else "incomplete", "errors": errors,
                   "logical_data_sha256": sha(blob) if blob is not None and not errors else None,
                   "function_event_table_status": "not_decoded"}
            if blob is not None:
                obj.update(string_hints(blob, spans, self.hint_limit))
                obj["datawindow_text_signature_candidate"] = all(x in blob.lower() for x in (b"datawindow", b"table", b"column"))
            self.objects.append(obj)
            info["entries_parsed"] += 1
            pos += self.entry_size + name_size
        return info

    def parse(self):
        start = self.header + self.header_size
        if self.data[start:start + 4] != b"FRE*":
            self.errors.append({"offset": start, "error": "expected_FRE_after_header"})
        # Locate first physical NOD after header/bitmap. Tree links then define reachability.
        root = next((p for p in range(start, len(self.data) - 3071, 512)
                     if self.data[p:p + 4] == b"NOD*"), None)
        pending, visited = ([root] if root is not None else []), set()
        if root is None:
            self.errors.append({"offset": start, "error": "no_NOD_found"})
        while pending:
            off = pending.pop()
            if off in visited:
                continue
            visited.add(off)
            try:
                node = self.node(off)
                self.nodes.append(node)
                pending.extend(p for p in (node["left_raw"], node["parent_raw"], node["right_raw"]) if p and p not in visited)
            except Invalid as exc:
                self.errors.append({"offset": off, "error": str(exc)})
        names = collections.defaultdict(list)
        for obj in self.objects:
            names[obj["name"].lower()].append(obj["entry_offset"])
            names[obj["name"].rsplit(".", 1)[0].lower()].append(obj["entry_offset"])
        for obj in self.objects:
            for hint in obj.get("name_hints", []):
                hint["local_matching_entry_offsets"] = sorted(set(names.get(hint["token"].lower(), [])))
                hint["relation"] = "text_name_occurrence_not_call_or_inheritance"
        return {"header_offset": self.header, "header_encoding": self.encoding,
                "format_version_raw": self.format_version, "format_version_is_pb_major_version": False,
                "pointer_mode": "absolute_file_offsets_only",
                "root_selection": "first_aligned_NOD_after_HDR_then_link_reachability",
                "root_selection_proven_active": False,
                "scc_pointer_raw": u32(self.data, self.header + self.scc_offset_pos),
                "scc_data_not_exported": True, "nodes": self.nodes, "objects": self.objects,
                "errors": self.errors,
                "status": "partial" if self.errors or any(o["errors"] for o in self.objects) else "container_parsed",
                "call_graph": {"status": "not_decoded", "edges": []}}


def probe_bytes(data, max_object_bytes=32 * 1024 * 1024, hint_limit=100):
    libraries, rejected = [], []
    for off in range(0, len(data), 512):
        if data[off:off + 4] == b"HDR*":
            try:
                libraries.append(Library(data, off, max_object_bytes, hint_limit).parse())
            except Invalid as exc:
                rejected.append({"offset": off, "error": str(exc)})
    trailers = [{"offset": p, "header_pointer_raw": u32(data, p + 4)}
                for p in range(0, max(0, len(data) - 7), 512) if data[p:p + 4] == b"TRL*"]
    for trailer in trailers:
        trailer["matches_valid_header"] = trailer["header_pointer_raw"] in {l["header_offset"] for l in libraries}
    return {"bytes": len(data), "sha256": sha(data), "libraries": libraries,
            "trailer_candidates": trailers, "rejected_headers": rejected,
            "status": "no_supported_container" if not libraries else "partial" if any(l["status"] == "partial" for l in libraries) else "container_parsed"}


def batch(manifest, payload_root, output, max_object_bytes, hint_limit):
    import csv
    rows = list(csv.DictReader(manifest.open(encoding="utf-8-sig", newline="")))
    selected = [r for r in rows if Path(r["original_destination"].replace("\\", "/")).suffix.lower() == ".pbd"
                or Path(r["original_destination"].replace("\\", "/")).name.lower() in
                {"run_zw8.exe", "rhzw8_mfq.exe", "rhzw8_cb.exe", "rhzw9_cn0.exe", "rhzw9_fp0.exe", "rh_hlp.exe", "filesmove.exe"}]
    output.mkdir(parents=True, exist_ok=True)
    index, cache = [], {}
    root = payload_root.resolve()
    for row in selected:
        rid = row["installer"] + ":" + row["record"]
        path = (root / row["materialized_relative_path"]).resolve()
        entry = {"record_id": rid, "destination": row["original_destination"], "expected_sha256": row["sha256"]}
        if not path.is_relative_to(root):
            entry["status"] = "path_outside_payload_root_rejected"
        elif not path.is_file():
            entry["status"] = "missing_bytes"
        else:
            data = path.read_bytes()
            if len(data) != int(row["bytes"]) or sha(data) != row["sha256"]:
                entry["status"] = "hash_or_size_mismatch_rejected"
            else:
                if row["sha256"] not in cache:
                    report = probe_bytes(data, max_object_bytes, hint_limit)
                    name = row["sha256"] + ".json"
                    (output / name).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    cache[row["sha256"]] = (name, report["status"])
                entry["report"], entry["status"] = cache[row["sha256"]]
        index.append(entry)
    result = {"schema_version": 1, "probe_version": VERSION, "format_source": FORMAT_SOURCE,
              "script_sha256": sha(Path(__file__).read_bytes()), "manifest_sha256": sha(manifest.read_bytes()),
              "limits": {"max_object_bytes": max_object_bytes, "name_hint_limit_per_object": hint_limit},
              "raw_objects_exported": False, "original_program_executed": False,
              "records": index, "status_counts": dict(collections.Counter(r["status"] for r in index))}
    (output / "index.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(index), "unique_reports": len(cache), "status_counts": result["status_counts"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--payload-root", type=Path, required=True,
                        help="Directory containing payloads-static-readonly/ from the existing extraction")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-object-bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--hint-limit", type=int, default=100)
    args = parser.parse_args()
    if args.max_object_bytes <= 0 or args.hint_limit <= 0:
        parser.error("limits must be positive")
    if args.output.resolve().is_relative_to(args.payload_root.resolve()):
        parser.error("output must be outside the input payload tree")
    batch(args.manifest, args.payload_root, args.output, args.max_object_bytes, args.hint_limit)


if __name__ == "__main__":
    main()
