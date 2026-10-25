"""Read-only official name evidence, explicitly not a numbered posting chart."""
from pathlib import Path

from rules.runtime import ROOT, RuleError, _local_path, _require, _schema, _source_refs, _unique, read_json


def validate_enterprise_evidence(data: dict, sources: dict, package: dict, root: Path = ROOT) -> dict:
    _schema(data, "enterprise-evidence", root)
    _source_refs(data, sources)
    _source_refs({"sourceRefs": data["sourceRefs"]}, sources, current_only=True)
    names = data["namedAccounts"]
    _unique([n["semanticId"] for n in names], "enterprise semantic ID")
    _unique([n["name"] for n in names], "enterprise evidenced account name")
    _require(len(names) == data["officialNameCount"], "Enterprise official-name count mismatch")
    for name in names:
        _source_refs(name, sources, current_only=True)
    _unique([u["id"] for u in data["formalUpdates"]], "enterprise update ID")
    name_set = {n["name"] for n in names}
    for update in data["formalUpdates"]:
        _source_refs(update, sources, current_only=True)
        _require(set(update["verifiedNames"]) <= name_set, "Update refers to an unevidenced account name")
    _unique([a["id"] for a in data["retrievalAttempts"]], "enterprise retrieval attempt ID")
    _require(any("403" in a["outcome"] and a["id"] == "2006-guide-rar" for a in data["retrievalAttempts"]), "Missing original-guide denial record")
    _require(set(data["unverifiedEngineeringSampleCodes"]) == {a["code"] for a in package["accounts"]}, "Unverified sample-code inventory mismatch")
    _require(all(a["origin"] == "EngineeringExampleCode" for a in package["accounts"]), "Name-only evidence cannot promote numeric codes")
    _require(not any(sources[r["sourceId"]]["status"] == "Draft" for n in names for r in n["sourceRefs"]), "Draft cannot establish a current account")
    return {"officialNamedAccounts": len(names), "verifiedNumericCodes": 0,
            "completeCurrentChart": False, "original2006AttachmentBlocked": True}


def load_enterprise_evidence(root: Path = ROOT) -> dict:
    """Return verified names with accountCode=None; never infer familiar numbers."""
    from rules.runtime import load_bundle
    _, packages, _ = load_bundle(root)
    package = next(p for p in packages.values() if p["regime"] == "Enterprise")
    path = _local_path(root, package["officialNameEvidencePath"])
    data = read_json(path)
    sources = {s["id"]: s for s in read_json(root / "sources.json")["sources"]}
    validate_enterprise_evidence(data, sources, package, root)
    return data


def require_verified_enterprise_posting_chart(root: Path = ROOT) -> None:
    """Explicit integration guard until official numeric-code evidence is obtained."""
    load_enterprise_evidence(root)
    raise RuleError("Enterprise official numeric posting chart unavailable: original2006 attachment HTTP403; current numbered guides not obtained. Name metadata cannot authorize engineering sample codes.")
