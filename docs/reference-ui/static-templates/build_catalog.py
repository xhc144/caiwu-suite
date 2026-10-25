#!/usr/bin/env python3
"""Derive template/data candidates from pinned, already shared metadata only.

Reads git blobs; never downloads installers, opens payloads, runs vendor code,
or parses PB containers. The existing static-program probe remains its owner's.
"""
from __future__ import annotations
import argparse
import collections
import csv
import hashlib
import io
import json
import ntpath
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
DEFAULT_SOURCE = "dc6e08cca3df4788f400de2ca62bd18b3fa0c92d"
DEFAULT_PROBE = "ce6064dc9a6e0831560314b0340d45da63a2f140"
PRODUCTS = ("qingsong-kuaiji-setup", "minfeiqi-setup", "chengben-kuaiji-setup")


def blob(ref: str, path: str) -> bytes:
    if not re.fullmatch(r"[0-9a-f]{40}", ref):
        raise ValueError("Use a full immutable lowercase commit SHA")
    return subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT)


def write_json(name: str, value: object) -> None:
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(name: str, fields: list[str], rows: list[dict]) -> None:
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-ref", default=DEFAULT_SOURCE)
    parser.add_argument("--probe-ref", default=DEFAULT_PROBE)
    args = parser.parse_args()
    source_paths = ["docs/reference-static/README.md", "docs/reference-static/all-payload-file-list.csv",
                    "docs/reference-static/program-types.json", "docs/reference-static/provenance.json"]
    sources = []
    contents = {}
    for ref, paths in [(args.source_ref, source_paths), (args.probe_ref, ["docs/reference-ui/static-program/RUNBOOK.md"])]:
        for path in paths:
            data = blob(ref, path)
            contents[path] = data
            sources.append({"source_id": path, "repository": "xhc144/caiwu-suite", "commit": ref,
                "path": path, "git_blob_sha1": subprocess.check_output(["git", "rev-parse", f"{ref}:{path}"], cwd=ROOT).decode().strip(),
                "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                "read_status": "read_entire_file", "origin": "shared_static_metadata" if path in source_paths else "existing_probe_scope_document",
                "original_payload_bytes_read_here": False})
    records = list(csv.DictReader(io.StringIO(contents[source_paths[1]].decode("utf-8-sig"))))
    program_types = json.loads(contents[source_paths[2]])
    provenance = json.loads(contents[source_paths[3]])
    assert len(records) == provenance["file_count"], "Shared provenance/file-list count mismatch"
    assert len({(r["installer"], r["record"]) for r in records}) == len(records), "Duplicate record identity"
    all_hashes: dict[str, list] = collections.defaultdict(list)
    for record in records:
        assert record["installer"] in PRODUCTS
        assert re.fullmatch(r"[0-9a-f]{64}", record["sha256"])
        assert int(record["bytes"]) > 0
        all_hashes[record["sha256"]].append(record)
    assert all(len({r["bytes"] for r in group}) == 1 for group in all_hashes.values()), "One hash has conflicting sizes"
    pe_joins = 0
    for package in program_types["packages"]:
        subset = [r for r in records if r["installer"] == package["installer"]]
        assert len(subset) == package["file_record_count"]
        keys = {(r["original_destination"], r["sha256"]) for r in subset}
        for pe in package["pe_files"]:
            assert (pe["destination"], pe["sha256"]) in keys, "PE metadata not present in payload manifest"
            pe_joins += 1

    role_by_extension = {".acd": "opaque_acd_candidate", ".xlt": "spreadsheet_template_name_candidate",
                         ".vts": "opaque_vts_candidate", ".db": "vendor_bundled_data_candidate"}
    selected = []
    for record in records:
        path = record["original_destination"]
        extension = ntpath.splitext(path)[1].lower()
        role = role_by_extension.get(extension)
        if ntpath.basename(path).lower() == "rhzw8.ini":
            role = "program_configuration_candidate"
        if role:
            selected.append({"record_id": record["installer"] + ":" + record["record"], **record,
                "extension": extension, "candidate_role": role,
                "role_basis": "filename_or_extension_only_not_content_semantics",
                "content_status": "not_read_here", "formula_status": "not_decoded", "schema_status": "not_decoded"})
    groups: dict[str, list] = collections.defaultdict(list)
    for record in selected:
        groups[record["sha256"]].append(record)
    group_rows = []
    group_objects = []
    for sha, members in sorted(groups.items()):
        representative = min(members, key=lambda r: (PRODUCTS.index(r["installer"]), int(r["record"])))
        names = sorted({ntpath.basename(r["original_destination"]) for r in members})
        roles = sorted({r["candidate_role"] for r in members})
        group_rows.append({"sha256": sha, "bytes": int(representative["bytes"]), "records": len(members),
            "products": "|".join(p for p in PRODUCTS if any(r["installer"] == p for r in members)),
            "names": "|".join(names), "candidate_roles": "|".join(roles),
            "representative_record_id": representative["record_id"],
            "representative_relative_path": representative["materialized_relative_path"]})
        group_objects.append({**group_rows[-1], "record_ids": [r["record_id"] for r in members],
            "evidence": "same_sha256_and_size_in_shared_manifest_not_independent_payload_rehash",
            "content_semantics": "unknown"})

    matrices = []
    acd_names = sorted({ntpath.basename(r["original_destination"]).lower() for r in selected if r["extension"] == ".acd"})
    for name in acd_names:
        matches = [r for r in selected if ntpath.basename(r["original_destination"]).lower() == name]
        assert len(matches) == len(PRODUCTS) and {r["installer"] for r in matches} == set(PRODUCTS)
        match = {r["installer"]: r for r in matches}
        same = len({(r["sha256"], r["bytes"]) for r in matches}) == 1
        matrices.append({"basename": name, "same_manifest_hash_and_size_all_three": same,
            "qingsong_record_id": match[PRODUCTS[0]]["record_id"], "minfeiqi_record_id": match[PRODUCTS[1]]["record_id"],
            "chengben_record_id": match[PRODUCTS[2]]["record_id"],
            "bytes": int(matches[0]["bytes"]) if same else "different",
            "shared_sha256": matches[0]["sha256"] if same else "different"})

    categories = []
    for role in sorted({r["candidate_role"] for r in selected}):
        rows = [r for r in selected if r["candidate_role"] == role]
        categories.append({"candidate_role": role, "records": len(rows), "unique_manifest_sha256": len({r["sha256"] for r in rows}),
            "raw_content_read_here": False})
    products = []
    for product in PRODUCTS:
        rows = [r for r in records if r["installer"] == product]
        products.append({"installer": product, "records": len(rows), "unique_manifest_sha256": len({r["sha256"] for r in rows}),
            "extensions": dict(sorted(collections.Counter(ntpath.splitext(r["original_destination"])[1].lower() for r in rows).items()))})
    requests = []
    for category in categories:
        role = category["candidate_role"]
        requested = {
            "opaque_acd_candidate": "Read bounded signature/encoding for each unique hash, then return format-specific declarative report/form/account-template labels and formula metadata only if actually decoded; purpose still unknown.",
            "spreadsheet_template_name_candidate": "Identify actual byte format first; provide sheet/column labels, ranges, defined names and formula values as metadata. Do not execute macros/external links or export VBA/commercial implementation code.",
            "opaque_vts_candidate": "Identify actual signature/encoding; report explicit record boundaries, labels and formula tokens only if present. Filename alone does not establish function or DB linkage.",
            "vendor_bundled_data_candidate": "Coordinator confirms original vendor payload provenance and blank/synthetic status before schema analysis; return tables, column types, PK/FK/index declarations and schema-only metadata, never user rows or credentials.",
            "program_configuration_candidate": "Coordinator may report only nonsecret structural keys and explicit relative template/book references with credentials/connection secrets removed; filename co-location is not a relationship."
        }[role]
        hashes = sorted({r["sha256"] for r in selected if r["candidate_role"] == role})
        requests.append({"request_id": "PARSE-" + role, "role": role, "records": category["records"], "unique_hashes": hashes,
            "coordinator_action": requested, "status": "pending_coordinator_metadata_not_missing_manifest", "run_vendor_code": False})
    audit = {"schema_version": 2, "scope": "template_and_data_manifest_analysis_only", "source_commit": args.source_ref,
        "existing_probe_commit": args.probe_ref, "sources": sources,
        "summary": {"manifest_records": len(records), "unique_manifest_sha256": len(all_hashes), "candidate_records": len(selected),
            "candidate_unique_manifest_sha256": len(groups), "same_name_acd_comparisons": len(matrices),
            "same_name_acd_all_products_equal": all(r["same_manifest_hash_and_size_all_three"] for r in matrices),
            "pe_metadata_entries_joined_to_manifest": pe_joins},
        "products": products, "categories": categories,
        "source_claim": {"all_payload_hashes_verified_by_source_thread": provenance["all_payload_hashes_verified"], "raw_payloads_uploaded": provenance["raw_payloads_uploaded"]},
        "independent_scope": {"shared_metadata_integrity_and_joins_checked": True, "raw_payloads_read": False,
            "original_program_executed": False, "pb9_bytes_tested": False, "report_formulas_decoded": False,
            "original_db_schema_decoded": False, "real_user_book_read": False},
        "relationship_evidence": {"content_identity_groups": "manifest_hash_and_size_only", "same_folder": "path_co_location_only",
            "db_foreign_keys": "not_available", "template_to_db_bindings": "not_decoded"},
        "existing_pb_probe_reuse": {"path": "docs/reference-ui/static-program/pb_container_probe.py", "runbook": "docs/reference-ui/static-program/RUNBOOK.md",
            "scope_read": "Container/object metadata and bounded string locations; no expressions, SQL bindings or p-code semantics decoded.",
            "owned_elsewhere": True, "rewritten_or_executed_here": False,
            "request": "Coordinator runs existing probe on approved local PB9 bytes and returns metadata keyed by installer:record/hash. Only explicit declarative template metadata may enrich this catalog; text hits alone are not bindings or formulas."},
        "supersedes": {"initial_inventory_status_at": "34f065b6028ebd2102f0520263bae8bd3b7ec09f", "old_missing_manifest_request": "resolved_by_dc6e08_shared_manifest",
            "remaining_gap": "Payload-specific declarative metadata/schema only; not installer download or manifest discovery."},
        "parse_requests": requests}
    write_json("source-audit.json", audit)
    write_json("content-groups.json", {"source_commit": args.source_ref, "groups": group_objects})
    write_json("parse-requests.json", {"source_commit": args.source_ref, "requests": requests,
        "additional_pb_metadata": audit["existing_pb_probe_reuse"]})
    write_csv("source-index.csv", list(sources[0]), sources)
    write_csv("template-data-records.csv", list(selected[0]), selected)
    write_csv("content-groups.csv", list(group_rows[0]), group_rows)
    write_csv("acd-name-matrix.csv", list(matrices[0]), matrices)
    # Replace the obsolete broad material request with exact, hash-addressed targets.
    write_csv("required-materials.csv", ["request_id", "role", "records", "unique_hashes", "coordinator_action", "status"],
        [{k: "|".join(v) if k == "unique_hashes" else v for k, v in r.items() if k != "run_vendor_code"} for r in requests])
    print(json.dumps(audit["summary"], ensure_ascii=False, sort_keys=True))
    print(json.dumps(categories, ensure_ascii=False))


if __name__ == "__main__":
    main()
