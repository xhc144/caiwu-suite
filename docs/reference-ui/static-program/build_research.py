#!/usr/bin/env python3
"""Rebuild metadata-derived JSON. No original payloads or execution required."""
import argparse
import collections
import csv
import hashlib
import itertools
import json
from pathlib import Path, PureWindowsPath

BASE_COMMIT = "dc6e08cca3df4788f400de2ca62bd18b3fa0c92d"
SOURCE_HASHES = {
    "all-payload-file-list.csv": "0582118a3c76b38c1dbc497d6fb553ab8e0ff073eb84d0744726018624f56666",
    "program-types.json": "8977b1162db8b3af1db152adb0c57fa13d9c69e69b3ae556da61662691b71e7a",
}
MAINS = {"run_zw8.exe", "rhzw8_mfq.exe", "rhzw8_cb.exe"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def grouped(items, key):
    out = collections.defaultdict(list)
    for item in items:
        out[key(item)].append(item)
    return out


def basename(path):
    return PureWindowsPath(path).name.lower()


def emit(root, name, data, compact=False):
    (root / name).write_text(json.dumps(data, ensure_ascii=False, indent=None if compact else 2,
                                      separators=(",", ":") if compact else None) + "\n", encoding="utf-8")


def build(source, output):
    provenance = {"repository": "xhc144/caiwu-suite", "source_commit": BASE_COMMIT,
                  "source_binary_bytes_available_in_this_task": False,
                  "evidence_tier": "derived_from_coordinator_binary_metadata_not_locally_reparsed",
                  "sources": []}
    for name, expected in SOURCE_HASHES.items():
        data = (source / name).read_bytes()
        actual = sha(data)
        if actual != expected:
            raise ValueError("pinned metadata SHA256 mismatch: " + name)
        provenance["sources"].append({"path": "docs/reference-static/" + name,
                                       "sha256": actual, "bytes": len(data)})
    raw = list(csv.DictReader((source / "all-payload-file-list.csv").open(encoding="utf-8-sig", newline="")))
    packages = json.loads((source / "program-types.json").read_text())["packages"]
    records = []
    for row in raw:
        records.append({"id": row["installer"] + ":" + row["record"],
                        "package": row["installer"], "record": int(row["record"]),
                        "destination": row["original_destination"], "bytes": int(row["bytes"]),
                        "sha256": row["sha256"], "materialized_relative_path": row["materialized_relative_path"],
                        "extension": PureWindowsPath(row["original_destination"]).suffix.lower()})
    bypackage = grouped(records, lambda r: r["package"])
    byhash = grouped(records, lambda r: r["sha256"])
    match = grouped(records, lambda r: (r["package"], r["destination"].lower(), r["sha256"]))
    nodes, pe_metadata = [], {}
    for pi, pkg in enumerate(packages):
        for fi, pe in enumerate(pkg["pe_files"]):
            candidates = match[(pkg["installer"], pe["destination"].lower(), pe["sha256"])]
            # Same-path/same-hash repeated FILE records also repeat PE metadata.
            used = {n["record_id"] for n in nodes}
            r = next(r for r in candidates if r["id"] not in used)
            ref = "/packages/" + str(pi) + "/pe_files/" + str(fi)
            node = {"record_id": r["id"], "metadata_json_pointer": ref,
                    "evidence_class": "direct_fact_in_pinned_coordinator_metadata", "confidence": "high",
                    "architecture": pe["architecture"], "clr_directory_bytes": pe["clr_directory_bytes"],
                    "resource_leaf_count": pe["resource_leaf_count"], "imports": pe["imports"]}
            nodes.append(node)
            pe_metadata[r["id"]] = pe
    edges = []
    for node in nodes:
        pkg = node["record_id"].split(":")[0]
        for dll in node["imports"]:
            candidates = [r for r in bypackage[pkg] if basename(r["destination"]) == dll.lower()]
            exacthashes = {r["sha256"] for r in candidates}
            edges.append({"source_record_id": node["record_id"], "imported_dll": dll,
                          "evidence_class": "direct_DLL_name_import_in_pinned_metadata", "confidence": "high",
                          "candidate_binding_evidence_class": "basename_inference", "candidate_binding_confidence": "low" if candidates else "unknown",
                          "candidate_record_ids": [r["id"] for r in candidates],
                          "resolution": "not_bundled_or_external" if not candidates else
                          "one_content_candidate_runtime_resolution_unverified" if len(exacthashes) == 1 else
                          "multiple_content_candidates_runtime_resolution_unknown"})
    def stats(rs):
        peers = [n for n in nodes if n["record_id"] in {r["id"] for r in rs}]
        return {"file_records": len(rs), "unique_sha256": len({r["sha256"] for r in rs}),
                "record_bytes": sum(r["bytes"] for r in rs),
                "unique_content_bytes": sum(v[0]["bytes"] for v in grouped(rs, lambda r: r["sha256"]).values()),
                "extension_counts": dict(sorted(collections.Counter(r["extension"] for r in rs).items())),
                "pe_records": len(peers), "pe_unique_sha256": len({next(r["sha256"] for r in rs if r["id"] == n["record_id"]) for n in peers}),
                "pe_resource_leaves": sum(n["resource_leaf_count"] for n in peers)}
    collisions = []
    for pkg, rs in bypackage.items():
        for path, same in grouped(rs, lambda r: r["destination"].lower()).items():
            if len(same) > 1:
                collisions.append({"package": pkg, "destination_casefold": path,
                                   "record_ids": [r["id"] for r in same],
                                   "distinct_sha256": sorted({r["sha256"] for r in same}),
                                   "final_installed_content": "unknown_install_overwrite_rules_not_analysed"})
    pbd = [r for r in records if r["extension"] == ".pbd"]
    pbd_families = []
    for name, rs in sorted(grouped(pbd, lambda r: basename(r["destination"])).items()):
        pbd_families.append({"name": name, "records": [{k: r[k] for k in ("id", "sha256", "bytes")} for r in rs],
                             "content_comparison_confidence": "high", "content_comparison_basis": "pinned_manifest_hashes_not_local_byte_comparison",
                             "same_size": len({r["bytes"] for r in rs}) == 1,
                             "same_content": len({r["sha256"] for r in rs}) == 1,
                             "business_semantics": "unknown_without_object_index_and_validated_code_references"})
    resource = []
    for pkg in packages:
        ns = [n for n in nodes if n["record_id"].startswith(pkg["installer"] + ":")]
        resource.append({"package": pkg["installer"], "total_leaf_records": sum(n["resource_leaf_count"] for n in ns),
                         "top_modules": sorted([{"record_id": n["record_id"], "destination": next(r["destination"] for r in records if r["id"] == n["record_id"]),
                                                  "leaves": n["resource_leaf_count"]} for n in ns], key=lambda n: (-n["leaves"], n["record_id"]))[:10]})
    summary = {"schema_version": 1, "provenance": provenance,
               "total": stats(records), "packages": {pkg: stats(rs) for pkg, rs in sorted(bypackage.items())},
               "main_programs": [{"record": r, "pe_metadata": pe_metadata[r["id"]]} for r in records if basename(r["destination"]) in MAINS],
               "pbd_records": len(pbd), "pbd_unique_sha256": len({r["sha256"] for r in pbd}),
               "same_destination_collisions": collisions,
               "direct_import_edge_records": len(edges), "all_pe_records_have_zero_clr_directory": all(n["clr_directory_bytes"] == 0 for n in nodes),
               "pairwise_content_sharing": [{"packages": [a,b], "common_unique_sha256": len({r["sha256"] for r in bypackage[a]} & {r["sha256"] for r in bypackage[b]})}
                                             for a,b in itertools.combinations(sorted(bypackage),2)],
               "semantic_call_graph": {"status": "blocked_pending_coordinator_probe_results", "edges": []},
               "claims_not_supported": ["complete_source_recovery", "all_business_calls_resolved", "PBD_number_is_business_module", "resource_leaf_is_window", "installed_database_version_from_folder_name", "bundled_module_is_actually_called", "hash_difference_proves_business_logic_difference"]}
    inventory = {"schema_version": 1, "provenance": provenance, "records": records,
                 "content_groups": [{"sha256": h, "bytes": rs[0]["bytes"], "record_ids": [r["id"] for r in rs]} for h,rs in sorted(byhash.items())]}
    graph = {"schema_version": 1, "provenance": provenance, "edge_kind": "PE_import_descriptor_DLL_name",
             "import_symbols_and_offsets": "not_present_in_coordinator_summary",
             "candidate_matching": "case_insensitive_basename_in_same_package_not_loader_resolution",
             "nodes": nodes, "edges": edges, "pbd_object_dependencies": {"status": "not_parsed", "edges": []}}
    request = {"schema_version": 1, "action": "run_pb_container_probe_locally_and_return_metadata_only",
               "reason": "original_bytes_not_present_in_this_task_existing_extraction_must_be_reused",
               "do_not_redownload_or_reextract": True, "raw_byte_transfer_required": False,
               "first_batch": [r for r in records if basename(r["destination"]) in MAINS],
               "second_batch": [r for r in pbd if basename(r["destination"]) != "pbdwr90.pbd"],
               "configuration_followup": [r for r in records if basename(r["destination"]) == "rhzw8.ini"],
               "configuration_policy": "Return section/key names and connection/engine/library-search hints with value hashes and file offsets; redact passwords, server addresses and license material",
               "coordinator_output_needed": ["index.json", "each main EXE report", "each distinct PBD content report", "errors with offsets; no silent fallback"],
               "still_unknown": ["events/functions table layout compatibility with PB9", "object inheritance", "p-code call sites", "persistent write/read transaction order", "database engine actually selected", "runtime library search order"]}
    output.mkdir(parents=True,exist_ok=True)
    emit(output,"inventory.json",inventory,True)
    emit(output,"dependencies.json",graph,True)
    emit(output,"summary.json",summary)
    emit(output,"package-comparison.json",{"schema_version":1,"pbd_families":pbd_families,"resource_distribution":resource})
    emit(output,"coordinator-request.json",request)
    print(json.dumps({"records":len(records),"unique_sha256":len(byhash),"pe_records":len(nodes),"imports":len(edges),"pbd_unique_sha256":summary["pbd_unique_sha256"]}))


if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    build(args.source,args.output)
