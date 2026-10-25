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

VERSION = "1.1"
DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024
DEFAULT_MAX_TOTAL_FILE_BYTES = 1024 * 1024 * 1024
DEFAULT_MAX_OBJECTS = 10000
DEFAULT_MAX_TRAVERSAL_STEPS = 1000000
DEFAULT_MAX_TOTAL_OBJECT_BYTES = 256 * 1024 * 1024
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


class LimitExceeded(Invalid):
    pass


class Budget:
    """Shared across every library/file in a batch, including repeated DAT reads.

    Traversal steps charge aligned block scans, node visits, entries and DAT hops.
    Reconstructed bytes separately bound work done by keyword/regex scans. These
    are work counters, not a wall-clock deadline or a guarantee of full recovery.
    """
    def __init__(self, max_objects=DEFAULT_MAX_OBJECTS,
                 max_traversal_steps=DEFAULT_MAX_TRAVERSAL_STEPS,
                 max_total_object_bytes=DEFAULT_MAX_TOTAL_OBJECT_BYTES,
                 max_total_file_bytes=DEFAULT_MAX_TOTAL_FILE_BYTES):
        self.limits = {"objects": max_objects, "traversal_steps": max_traversal_steps,
                       "reconstructed_object_bytes": max_total_object_bytes,
                       "input_file_bytes": max_total_file_bytes}
        if any(v <= 0 for v in self.limits.values()):
            raise ValueError("budget limits must be positive")
        self.used = {key: 0 for key in self.limits}
        self.exhausted = set()

    def take(self, key, amount=1):
        if amount < 0:
            raise ValueError("negative budget charge")
        if self.used[key] + amount > self.limits[key]:
            self.exhausted.add(key)
            raise LimitExceeded("budget_exhausted:" + key)
        self.used[key] += amount

    def snapshot(self):
        return {"scope": "entire_batch_when_shared_otherwise_single_probe",
                "limits": dict(self.limits), "used": dict(self.used),
                "exhausted": sorted(self.exhausted),
                "traversal_step_unit": "aligned block scan, node visit, ENT entry or DAT hop",
                "wall_clock_deadline_enforced": False}


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


def datawindow_signature(data, segments, complete):
    """Detect a text signature in either encoding; absence remains unproven."""
    matches = []
    if data is not None:
        lowered = data.lower()
        for encoding in ("ascii", "utf-16le"):
            positions = []
            for term in ("datawindow", "table", "column"):
                needle = term.encode(encoding)
                offset = lowered.find(needle)
                if offset < 0:
                    break
                positions.append({"term": term, "object_offset": offset,
                                  "file_spans": physical_spans(segments, offset, len(needle))})
            else:
                matches.append({"encoding": encoding, "occurrences": positions})
    status = "not_evaluated" if data is None else "detected" if matches else "not_detected_in_available_bytes"
    return {"datawindow_text_signature_candidate": True if matches else None,
            "datawindow_text_signature_detection": {
                "status": status, "input_complete": complete,
                "encodings_checked": ["ascii", "utf-16le"] if data is not None else [],
                "matches": matches, "absence_proven": False,
                "is_parsed_DataWindow_definition": False}}


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
    def __init__(self, data, header, max_object_bytes=32 * 1024 * 1024, hint_limit=100,
                 budget=None):
        self.data, self.header = data, header
        self.max_object_bytes, self.hint_limit = max_object_bytes, hint_limit
        self.budget = budget if budget is not None else Budget()
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
            try:
                self.budget.take("traversal_steps")
            except LimitExceeded as exc:
                errors.append(str(exc))
                break
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
            try:
                self.budget.take("reconstructed_object_bytes", length)
            except LimitExceeded as exc:
                errors.append(str(exc))
                break
            spans.append({"object_offset": len(out), "file_offset": pointer + 10,
                          "bytes": length, "block_offset": pointer, "next_block_raw": next_pointer})
            out.extend(self.data[pointer + 10:pointer + 10 + length])
            pointer = next_pointer
        if len(out) != declared:
            errors.append("DAT_bytes_differ_from_declared_size")
        return bytes(out), spans, errors

    def node(self, offset):
        self.budget.take("traversal_steps")
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
            self.budget.take("traversal_steps")
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
            self.budget.take("objects")
            blob, spans, errors = self.chain(pointer, size)
            obj = {"entry_offset": pos, "node_offset": offset, "name": name,
                   "evidence_class": "container_field_observation", "confidence": "medium",
                   "confidence_scope": "container_layout_only_PB9_object_semantics_not_validated",
                   "name_raw_sha256": sha(raw_name), "name_encoding": self.encoding,
                   "entry_extension": name.rsplit(".", 1)[-1].lower() if "." in name else None,
                   "type_evidence": "entry_extension_only_runtime_class_not_decoded",
                   "entry_format_version": self.data[pos + 4:pos + 8 + delta].decode(self.encoding, errors="replace"),
                   "declared_bytes": size, "first_data_block_raw": pointer,
                   "comment_bytes_declared": comment_size, "data_segments": spans,
                   "chain_status": "complete" if not errors else "incomplete", "errors": errors,
                   "logical_data_sha256": sha(blob) if blob is not None and not errors else None,
                   "function_event_table_status": "not_decoded"}
            obj.update(datawindow_signature(blob, spans, complete=blob is not None and not errors))
            if blob is not None:
                obj.update(string_hints(blob, spans, self.hint_limit))
                if obj["entry_extension"] in {"win", "men", "fun", "udo", "app", "str"} and len(blob) >= 12:
                    obj["compiled_header_observation"] = {
                        "object_offset": 0, "first_six_u16_le": list(struct.unpack_from("<6H", blob)),
                        "file_spans": physical_spans(spans, 0, 12),
                        "interpretation": "raw_header_words_only_no_PB9_layout_validated"}
            self.objects.append(obj)
            info["entries_parsed"] += 1
            pos += self.entry_size + name_size
            if self.budget.exhausted:
                self.errors.append({"offset": pos, "error": "shared_budget_exhausted_remaining_entries_unprocessed"})
                break
        return info

    def parse(self):
        start = self.header + self.header_size
        if self.data[start:start + 4] != b"FRE*":
            self.errors.append({"offset": start, "error": "expected_FRE_after_header"})
        # Locate first physical NOD after header/bitmap. Tree links then define reachability.
        root = None
        try:
            for p in range(start, len(self.data) - 3071, 512):
                self.budget.take("traversal_steps")
                if self.data[p:p + 4] == b"NOD*":
                    root = p
                    break
        except LimitExceeded as exc:
            self.errors.append({"offset": start, "error": str(exc)})
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
            if self.budget.exhausted:
                break
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


def probe_bytes(data, max_object_bytes=32 * 1024 * 1024, hint_limit=100,
                max_file_bytes=DEFAULT_MAX_FILE_BYTES, max_objects=DEFAULT_MAX_OBJECTS,
                max_traversal_steps=DEFAULT_MAX_TRAVERSAL_STEPS,
                max_total_object_bytes=DEFAULT_MAX_TOTAL_OBJECT_BYTES, budget=None):
    if min(max_object_bytes, hint_limit, max_file_bytes) <= 0:
        raise ValueError("limits must be positive")
    budget = budget if budget is not None else Budget(max_objects, max_traversal_steps, max_total_object_bytes)
    libraries, rejected, trailers, budget_errors = [], [], [], []
    if len(data) > max_file_bytes:
        return {"schema_version": 2, "bytes": len(data), "sha256": None,
                "status": "file_size_limit_rejected", "libraries": [],
                "max_file_bytes": max_file_bytes, "budget": budget.snapshot()}
    try:
        for off in range(0, len(data), 512):
            budget.take("traversal_steps")
            if data[off:off + 4] == b"HDR*":
                try:
                    libraries.append(Library(data, off, max_object_bytes, hint_limit, budget).parse())
                except Invalid as exc:
                    rejected.append({"offset": off, "error": str(exc)})
            if budget.exhausted:
                break
        if not budget.exhausted:
            for p in range(0, max(0, len(data) - 7), 512):
                budget.take("traversal_steps")
                if data[p:p + 4] == b"TRL*":
                    trailers.append({"offset": p, "header_pointer_raw": u32(data, p + 4)})
    except LimitExceeded as exc:
        budget_errors.append(str(exc))
    for trailer in trailers:
        trailer["matches_valid_header"] = trailer["header_pointer_raw"] in {l["header_offset"] for l in libraries}
    return {"schema_version": 2, "bytes": len(data), "sha256": sha(data), "libraries": libraries,
            "trailer_candidates": trailers, "rejected_headers": rejected,
            "budget_errors": budget_errors, "budget": budget.snapshot(),
            "status": "partial" if budget.exhausted or budget_errors or any(l["status"] == "partial" for l in libraries)
                      else "no_supported_container" if not libraries else "container_parsed"}


def batch(manifest, payload_root, output, max_object_bytes, hint_limit,
          max_file_bytes=DEFAULT_MAX_FILE_BYTES, max_total_file_bytes=DEFAULT_MAX_TOTAL_FILE_BYTES,
          max_objects=DEFAULT_MAX_OBJECTS, max_traversal_steps=DEFAULT_MAX_TRAVERSAL_STEPS,
          max_total_object_bytes=DEFAULT_MAX_TOTAL_OBJECT_BYTES):
    import csv
    with manifest.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    selected = [r for r in rows if Path(r["original_destination"].replace("\\", "/")).suffix.lower() == ".pbd"
                or Path(r["original_destination"].replace("\\", "/")).name.lower() in
                {"run_zw8.exe", "rhzw8_mfq.exe", "rhzw8_cb.exe", "rhzw9_cn0.exe", "rhzw9_fp0.exe", "rh_hlp.exe", "filesmove.exe"}]
    if output.resolve().is_relative_to(payload_root.resolve()):
        raise ValueError("output must be outside the input payload tree")
    if min(max_object_bytes, hint_limit, max_file_bytes) <= 0:
        raise ValueError("limits must be positive")
    budget = Budget(max_objects, max_traversal_steps, max_total_object_bytes, max_total_file_bytes)
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
        elif budget.exhausted:
            entry["status"] = "batch_budget_exhausted_unprocessed"
        else:
            size = path.stat().st_size
            remaining_bytes = budget.limits["input_file_bytes"] - budget.used["input_file_bytes"]
            if size > max_file_bytes:
                entry["status"] = "file_size_limit_rejected"
                index.append(entry)
                continue
            if size != int(row["bytes"]):
                entry["status"] = "hash_or_size_mismatch_rejected"
                index.append(entry)
                continue
            if size > remaining_bytes:
                budget.exhausted.add("input_file_bytes")
                entry["status"] = "total_file_bytes_limit_rejected"
                index.append(entry)
                continue
            # Bound the read even if the file grows after stat().
            with path.open("rb") as stream:
                data = stream.read(min(max_file_bytes, remaining_bytes) + 1)
            try:
                budget.take("input_file_bytes", len(data))
            except LimitExceeded:
                entry["status"] = "total_file_bytes_limit_rejected"
                index.append(entry)
                continue
            if len(data) > max_file_bytes:
                entry["status"] = "file_size_limit_rejected"
            elif len(data) != int(row["bytes"]) or sha(data) != row["sha256"]:
                entry["status"] = "hash_or_size_mismatch_rejected"
            else:
                if row["sha256"] not in cache:
                    report = probe_bytes(data, max_object_bytes, hint_limit, max_file_bytes,
                                         budget=budget)
                    name = row["sha256"] + ".json"
                    (output / name).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    cache[row["sha256"]] = (name, report["status"])
                entry["report"], entry["status"] = cache[row["sha256"]]
        index.append(entry)
    result = {"schema_version": 2, "probe_version": VERSION, "format_source": FORMAT_SOURCE,
              "script_sha256": sha(Path(__file__).read_bytes()), "manifest_sha256": sha(manifest.read_bytes()),
              "limits": {"max_object_bytes": max_object_bytes, "max_file_bytes": max_file_bytes,
                         "name_hint_limit_per_object": hint_limit}, "budget": budget.snapshot(),
              "raw_objects_exported": False, "original_program_executed": False,
              "records": index, "status_counts": dict(collections.Counter(r["status"] for r in index))}
    (output / "index.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(index), "unique_reports": len(cache), "status_counts": result["status_counts"]}))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--payload-root", type=Path, required=True,
                        help="Directory containing payloads-static-readonly/ from the existing extraction")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-object-bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--hint-limit", type=int, default=100)
    parser.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES,
                        help="Per physical file; rejects before reading oversized inputs")
    parser.add_argument("--max-total-file-bytes", type=int, default=DEFAULT_MAX_TOTAL_FILE_BYTES,
                        help="Total physical bytes read across the entire batch, including duplicates")
    parser.add_argument("--max-objects", type=int, default=DEFAULT_MAX_OBJECTS,
                        help="Total ENT entries analyzed across all libraries/files in this batch")
    parser.add_argument("--max-traversal-steps", type=int, default=DEFAULT_MAX_TRAVERSAL_STEPS,
                        help="Total block scans, node visits, entries and DAT hops across this batch")
    parser.add_argument("--max-total-object-bytes", type=int, default=DEFAULT_MAX_TOTAL_OBJECT_BYTES,
                        help="Total reconstructed DAT bytes, including overlapping chains")
    args = parser.parse_args()
    if min(args.max_object_bytes, args.hint_limit, args.max_file_bytes, args.max_total_file_bytes,
           args.max_objects, args.max_traversal_steps, args.max_total_object_bytes) <= 0:
        parser.error("limits must be positive")
    if args.output.resolve().is_relative_to(args.payload_root.resolve()):
        parser.error("output must be outside the input payload tree")
    batch(args.manifest, args.payload_root, args.output, args.max_object_bytes, args.hint_limit,
          args.max_file_bytes, args.max_total_file_bytes, args.max_objects,
          args.max_traversal_steps, args.max_total_object_bytes)


if __name__ == "__main__":
    main()
