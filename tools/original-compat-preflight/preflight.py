#!/usr/bin/env python3
"""Inventory explicitly selected local files without opening a database engine.

Only file metadata, SHA256 and bounded numeric PE metadata leave the reader.
Configuration/archive/database contents and connection credentials are not parsed.
Python 3.10+, standard library only; no original software or sample is bundled.
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys


TOOL_VERSION = "0.1.0"
SCHEMA_VERSION = "original-compat-preflight-1"
CHUNK_BYTES = 1024 * 1024
MAX_METADATA_BYTES = 1024 * 1024
RELATION_KINDS = ("log", "config", "report", "dbspace", "attachment")


class InputError(ValueError):
    pass


class MetadataError(ValueError):
    pass


class StableReadError(OSError):
    pass


def local_path(raw):
    """Normalize syntax without resolving symlinks or discovering other files."""
    value = os.fspath(raw)
    if not value or "\x00" in value or "://" in value or value.startswith(("\\\\", "//")):
        raise InputError("local_regular_file_required")
    return Path(os.path.abspath(value))


def path_key(path):
    return os.path.normcase(str(path))


def is_link_or_reparse(info):
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def check_components(path, allow_missing_leaf=False):
    current = Path(path.anchor)
    parts = path.parts[1:]
    for index, part in enumerate(parts):
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            if allow_missing_leaf and index == len(parts) - 1:
                return
            raise
        if is_link_or_reparse(info):
            raise InputError("symlink_or_reparse_point_rejected")


def open_without_links(path, flags, mode=0o666):
    """Pin each path component on POSIX; no permission or attribute changes."""
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if os.name == "posix" and nofollow and os.open in os.supports_dir_fd:
        directory = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | nofollow)
        try:
            for part in path.parts[1:-1]:
                next_directory = os.open(part, os.O_RDONLY | os.O_DIRECTORY | nofollow, dir_fd=directory)
                os.close(directory)
                directory = next_directory
            return os.open(path.name, flags | nofollow, mode, dir_fd=directory)
        finally:
            os.close(directory)
    return os.open(path, flags | nofollow, mode)


def open_regular_readonly(path):
    """Never follow a symlink; use directory descriptors on supporting POSIX."""
    check_components(path)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = open_without_links(path, flags)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or is_link_or_reparse(info):
            raise InputError("local_regular_file_required")
        check_components(path)
        if identity(info) != identity(path.lstat()):
            raise StableReadError("file_changed")
        return os.fdopen(descriptor, "rb", closefd=True)
    except BaseException:
        os.close(descriptor)
        raise


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read_range(stream, offset, size, file_size):
    if offset < 0 or size < 0 or size > MAX_METADATA_BYTES or offset + size > file_size:
        raise MetadataError("metadata_bounds")
    stream.seek(offset)
    value = stream.read(size)
    if len(value) != size:
        raise MetadataError("metadata_truncated")
    return value


def version_blob(blob):
    """Read VS_FIXEDFILEINFO only, never localized strings or arbitrary text."""
    if len(blob) < 6:
        raise MetadataError("version_bounds")
    length, value_length, kind = struct.unpack_from("<HHH", blob)
    key = "VS_VERSION_INFO\0".encode("utf-16le")
    if length > len(blob) or length < 6 + len(key) or blob[6:6 + len(key)] != key:
        raise MetadataError("version_key")
    offset = (6 + len(key) + 3) & ~3
    if kind != 0 or value_length != 52 or offset + 52 > length:
        raise MetadataError("version_value")
    fields = struct.unpack_from("<13I", blob, offset)
    if fields[0] != 0xFEEF04BD or fields[1] != 0x00010000:
        raise MetadataError("version_signature")
    def numeric(ms, ls):
        return ".".join(str(n) for n in (ms >> 16, ms & 0xffff, ls >> 16, ls & 0xffff))
    return {"file_version": numeric(fields[2], fields[3]),
            "product_version": numeric(fields[4], fields[5]),
            "basis": "PE_RT_VERSION_VS_FIXEDFILEINFO",
            "meaning": "file_declared_numeric_metadata_only"}


def pe_metadata(stream, file_size):
    """Bounded PE header/resource walk. No library loading or execution."""
    dos = read_range(stream, 0, 64, file_size)
    pe_offset = struct.unpack_from("<I", dos, 60)[0]
    header = read_range(stream, pe_offset, 24, file_size)
    if header[:4] != b"PE\0\0":
        raise MetadataError("pe_signature")
    machine, section_count = struct.unpack_from("<HH", header, 4)
    optional_size = struct.unpack_from("<H", header, 20)[0]
    if not 1 <= section_count <= 96 or not 96 <= optional_size <= 4096:
        raise MetadataError("pe_header")
    optional = read_range(stream, pe_offset + 24, optional_size, file_size)
    magic = struct.unpack_from("<H", optional)[0]
    if magic == 0x10b:
        count_offset, directory_offset, format_name = 92, 96, "PE32"
    elif magic == 0x20b:
        count_offset, directory_offset, format_name = 108, 112, "PE32+"
    else:
        raise MetadataError("pe_optional_header")
    if len(optional) < count_offset + 4:
        raise MetadataError("pe_directory_bounds")
    result = {"format": format_name, "machine_code": machine,
              "architecture": {0x14c: "x86", 0x8664: "x64", 0xaa64: "arm64"}.get(machine, "unknown"),
              "declared_versions": [], "version_status": "not_present"}
    directory_count = struct.unpack_from("<I", optional, count_offset)[0]
    if directory_count <= 2:
        return result
    if len(optional) < directory_offset + 24:
        raise MetadataError("pe_directory_bounds")
    resource_rva, resource_size = struct.unpack_from("<II", optional, directory_offset + 16)
    if not resource_rva or not resource_size:
        return result
    if resource_size > MAX_METADATA_BYTES:
        result["version_status"] = "resource_directory_exceeds_metadata_limit"
        return result
    raw_sections = read_range(stream, pe_offset + 24 + optional_size, section_count * 40, file_size)
    sections = []
    for offset in range(0, len(raw_sections), 40):
        _virtual_size, rva, raw_size, raw_offset = struct.unpack_from("<IIII", raw_sections, offset + 8)
        sections.append((rva, raw_size, raw_offset))
    def file_offset(rva, size):
        matches = [(raw + rva - base) for base, raw_size, raw in sections
                   if base <= rva and rva + size <= base + raw_size]
        if len(matches) != 1:
            raise MetadataError("resource_mapping")
        return matches[0]
    resource = read_range(stream, file_offset(resource_rva, resource_size), resource_size, file_size)
    seen = set()
    def entries(offset):
        if offset in seen or offset + 16 > len(resource):
            raise MetadataError("resource_directory_cycle_or_bounds")
        seen.add(offset)
        named, numbered = struct.unpack_from("<HH", resource, offset + 12)
        count = named + numbered
        if count > 256 or offset + 16 + count * 8 > len(resource):
            raise MetadataError("resource_entries_bounds")
        return [struct.unpack_from("<II", resource, offset + 16 + i * 8) for i in range(count)]
    roots = [target for name, target in entries(0) if name == 16]
    leaves = []
    for root in roots:
        if not root & 0x80000000:
            raise MetadataError("resource_type_directory")
        for _, name_target in entries(root & 0x7fffffff):
            if not name_target & 0x80000000:
                raise MetadataError("resource_name_directory")
            for _, data_target in entries(name_target & 0x7fffffff):
                if data_target & 0x80000000 or data_target + 16 > len(resource):
                    raise MetadataError("resource_leaf_bounds")
                data_rva, data_size = struct.unpack_from("<II", resource, data_target)
                if len(leaves) >= 16:
                    raise MetadataError("version_leaf_limit")
                leaves.append(read_range(stream, file_offset(data_rva, data_size), data_size, file_size))
    versions = []
    for leaf in leaves:
        value = version_blob(leaf)
        if value not in versions:
            versions.append(value)
    result["declared_versions"] = versions
    if versions:
        result["version_status"] = "declared_numeric_metadata" if len(versions) == 1 else "multiple_declared_values"
    return result


def static_hints(path, stream, file_size):
    hints = {"database_file_format_version": None, "database_engine_version": None,
             "application_schema_version": None}
    prefix = read_range(stream, 0, min(16, file_size), file_size)
    if prefix == b"SQLite format 3\0":
        hints["file_signature"] = "SQLite_format_3"
        hints["note"] = "SQLite_signature_is_not_original_SQL_Anywhere_compatibility"
    elif prefix.startswith(b"MZ"):
        try:
            hints["pe"] = pe_metadata(stream, file_size)
        except MetadataError:
            hints["pe_metadata_status"] = "malformed_or_unsupported_no_version_claim"
    else:
        hints["file_signature"] = "not_identified_by_this_tool"
    match = re.fullmatch(r"db(?:eng|srv|odbc|serv|con|lib|tool|lgen)(\d+)\.(?:exe|dll)", path.name, re.I)
    if match:
        hints["filename_version_hint"] = {"major": int(match.group(1)), "basis": "filename_only", "verified": False}
    return hints


def file_kind(path):
    suffix = path.suffix.lower()
    return {".db": "database_candidate", ".log": "log_candidate", ".mlg": "log_candidate",
            ".ini": "configuration_candidate", ".vts": "report_candidate",
            ".acd": "archive_or_template_candidate", ".exe": "executable_candidate",
            ".dll": "library_candidate"}.get(suffix, "unclassified_file")


def inspect_file(path, input_id, max_file_bytes, remaining_bytes, include_paths=False):
    item = {"input_id": input_id, "name": path.name, "kind": file_kind(path),
            "status": "not_read", "bytes": None, "sha256": None, "issues": []}
    if include_paths:
        item["selected_path"] = str(path)
    consumed = 0
    try:
        # Reject special files before opening; fstat repeats the check after open.
        check_components(path)
        if not stat.S_ISREG(path.lstat().st_mode):
            raise InputError("local_regular_file_required")
        with open_regular_readonly(path) as stream:
            before = os.fstat(stream.fileno())
            item["bytes"] = before.st_size
            if before.st_size > max_file_bytes or before.st_size > remaining_bytes:
                item["status"] = "limit_exceeded"
                item["issues"].append("file_or_total_byte_budget_exceeded")
                return item, consumed
            digest = hashlib.sha256()
            while True:
                # The extra byte detects growth without accepting unbounded input.
                allowance = min(max_file_bytes, remaining_bytes) - consumed
                chunk = stream.read(min(CHUNK_BYTES, allowance + 1))
                if not chunk:
                    break
                consumed += len(chunk)
                if consumed > min(max_file_bytes, remaining_bytes):
                    raise StableReadError("file_changed_or_budget_exceeded")
                digest.update(chunk)
            hints = static_hints(path, stream, before.st_size)
            after = os.fstat(stream.fileno())
            check_components(path)
            if consumed != before.st_size or identity(before) != identity(after) or identity(before) != identity(path.lstat()):
                raise StableReadError("file_changed_during_read")
            item.update(status="recorded", sha256=digest.hexdigest(), hints=hints)
    except FileNotFoundError:
        item["status"] = "missing"
        item["issues"].append("selected_file_not_found")
    except PermissionError:
        item["status"] = "unreadable"
        item["issues"].append("read_permission_denied_no_retry_or_permission_change")
    except StableReadError:
        item["status"] = "unstable"
        item["issues"].append("file_changed_no_hash_or_version_claim")
    except InputError as error:
        item["status"] = "rejected"
        item["issues"].append(str(error))
    except OSError:
        item["status"] = "read_failed"
        item["issues"].append("filesystem_read_failed_no_raw_error_or_path")
    except MetadataError:
        item["status"] = "unstable"
        item["issues"].append("file_changed_or_metadata_unreadable_no_hash_claim")
    return item, consumed


def write_new_report(path, value):
    check_components(path, allow_missing_leaf=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    descriptor = open_without_links(path, flags)
    try:
        check_components(path)
        if identity(os.fstat(descriptor)) != identity(path.lstat()):
            raise StableReadError("report_path_changed")
        stream = os.fdopen(descriptor, "w", encoding="utf-8", closefd=True)
    except BaseException:
        os.close(descriptor)
        raise
    with stream:
        stream.write(value)


def collect(selected, relationships=(), database_files=(), max_file_bytes=2 * 1024**3,
            max_total_bytes=4 * 1024**3, max_files=256, include_paths=False):
    if not selected or min(max_file_bytes, max_total_bytes, max_files) <= 0:
        raise InputError("explicit_files_and_positive_limits_required")
    paths = []
    by_path = {}
    for raw in selected:
        path = local_path(raw)
        key = path_key(path)
        if key not in by_path:
            by_path[key] = len(paths)
            paths.append(path)
    if len(paths) > max_files:
        raise InputError("selected_file_count_exceeds_limit")
    databases = {path_key(p) for p in paths if p.suffix.lower() == ".db"}
    for raw in database_files:
        key = path_key(local_path(raw))
        if key not in by_path:
            raise InputError("declared_database_must_be_selected")
        databases.add(key)
    resolved = []
    for kind, source, target in relationships:
        if kind not in RELATION_KINDS:
            raise InputError("unsupported_relationship_kind")
        source_key, target_key = path_key(local_path(source)), path_key(local_path(target))
        if source_key not in by_path or target_key not in by_path or source_key == target_key:
            raise InputError("relationship_requires_two_distinct_explicitly_selected_files")
        if source_key not in databases:
            raise InputError("relationship_source_must_be_declared_database_or_db_candidate")
        entry = (kind, by_path[source_key], by_path[target_key])
        if entry not in resolved:
            resolved.append(entry)
    files, consumed = [], 0
    for index, path in enumerate(paths):
        item, read_bytes = inspect_file(path, f"F{index + 1:03d}", max_file_bytes,
                                        max_total_bytes - consumed, include_paths)
        consumed += read_bytes
        files.append(item)
    associations = []
    for kind, source, target in resolved:
        associations.append({"kind": kind, "database_input_id": files[source]["input_id"],
                             "related_input_id": files[target]["input_id"],
                             "basis": "operator_declared_not_engine_verified",
                             "selected_files_recorded": files[source]["status"] == files[target]["status"] == "recorded",
                             "content_association_verified": False})
    coverage = []
    for key in sorted(databases, key=lambda k: by_path[k]):
        index = by_path[key]
        declared = [r for r in associations if r["database_input_id"] == files[index]["input_id"]]
        gaps = ["database_format_and_engine_version_unverified", "schema_and_ledger_mapping_unverified",
                "backup_consistency_and_restore_unverified", "external_dependency_completeness_unknown"]
        if files[index]["status"] != "recorded":
            gaps.append("database_file_unavailable_or_unstable")
        for kind in ("log", "config", "report"):
            related = [r for r in declared if r["kind"] == kind]
            gaps.append(f"{kind}_association_not_engine_verified" if related else f"{kind}_association_not_declared")
            if any(not r["selected_files_recorded"] for r in related):
                gaps.append(f"declared_{kind}_file_unavailable_or_unstable")
        for kind in ("dbspace", "attachment"):
            if any(not r["selected_files_recorded"] for r in declared if r["kind"] == kind):
                gaps.append(f"declared_{kind}_file_unavailable_or_unstable")
        candidates = []
        for other_index, path in enumerate(paths):
            if other_index == index:
                continue
            reason = None
            if path.suffix.lower() in (".log", ".mlg") and path.stem.casefold() == paths[index].stem.casefold():
                reason = "same_stem_selected_log_only"
            elif path.name.casefold() == "rhzw8.ini":
                reason = "known_configuration_filename_only"
            elif path.suffix.lower() == ".vts":
                reason = "selected_report_filename_only"
            if reason:
                candidates.append({"input_id": files[other_index]["input_id"], "basis": reason,
                                   "association_verified": False})
        coverage.append({"database_input_id": files[index]["input_id"], "gaps": gaps,
                         "selected_name_candidates": candidates})
    return {"schema_version": SCHEMA_VERSION, "tool_version": TOOL_VERSION,
            "generated_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "inventory_status": "complete" if all(f["status"] == "recorded" for f in files) else "incomplete",
            "compatibility_status": "not_assessed", "original_ledger_usability": "not_assessed",
            "scope": {"selection": "explicit_files_only_no_directory_scan", "sources_opened_readonly": True,
                      "engines_started": False, "database_connections_created": False, "uploads": False,
                      "configuration_values_collected": False, "absolute_paths_included": include_paths},
            "files": files, "operator_declared_associations": associations, "database_coverage": coverage,
            "unresolved": ["No database was opened; schema, log ownership, encryption, permissions and business compatibility remain unknown.",
                           "Only explicitly selected files were checked; absent selections do not prove files are absent on disk.",
                           "A complete inventory is not a validated backup, original-ledger open result or migration approval."]}


class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "invalid arguments; use --help (argument values are not echoed)\n")


def positive_integer(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("positive integer required") from None
    if number <= 0:
        raise argparse.ArgumentTypeError("positive integer required")
    return number


def main(argv=None):
    parser = QuietParser(description=__doc__)
    parser.add_argument("--file", action="append", default=[], help="Explicit file; repeat for every selected dependency, including a known missing file.")
    parser.add_argument("--database", action="append", default=[], help="Explicit database candidate; also selects this file, regardless of suffix.")
    for kind in RELATION_KINDS:
        parser.add_argument(f"--{kind}-for", action="append", nargs=2, default=[], metavar=("DATABASE", "RELATED_FILE"),
                            help="Operator-declared relationship; both files must be explicitly selected.")
    parser.add_argument("--max-file-bytes", type=positive_integer, default=2 * 1024**3)
    parser.add_argument("--max-total-bytes", type=positive_integer, default=4 * 1024**3)
    parser.add_argument("--max-files", type=positive_integer, default=256)
    parser.add_argument("--include-paths", action="store_true", help="Explicit opt-in to include absolute selected paths in the local report.")
    parser.add_argument("--output", help="Create a NEW local JSON report exclusively; never overwrite. Default: stdout.")
    parser.add_argument("--version", action="version", version=TOOL_VERSION)
    args = parser.parse_args(argv)
    try:
        output = local_path(args.output) if args.output else None
        if output is not None:
            if any(path_key(output) == path_key(local_path(raw)) for raw in args.file + args.database):
                raise InputError("report_destination_is_selected_input")
            check_components(output, allow_missing_leaf=True)
            if output.exists():
                raise InputError("report_destination_already_exists_no_overwrite")
        relationships = [(kind, source, target) for kind in RELATION_KINDS
                         for source, target in getattr(args, kind + "_for")]
        report = collect(args.file + args.database, relationships, args.database,
                         args.max_file_bytes, args.max_total_bytes, args.max_files, args.include_paths)
        # ASCII JSON remains valid on consoles whose encoding cannot print filenames.
        value = json.dumps(report, ensure_ascii=True, indent=2) + "\n"
        if output is not None:
            write_new_report(output, value)
        else:
            print(value, end="")
        return 0 if report["inventory_status"] == "complete" else 1
    except InputError as error:
        print("preflight_input_error: " + str(error), file=sys.stderr)
        return 2
    except OSError:
        print("preflight_io_error: no input permissions changed; no raw path or error echoed", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
