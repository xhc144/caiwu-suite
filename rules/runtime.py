"""Data validation and review-only helpers. No accounting store or UI dependency.

All signed net amounts are debit-positive / credit-negative decimal strings.
Normal account direction never prohibits a legitimate opposite-side balance.
"""
from __future__ import annotations

from datetime import date
from decimal import Context, Decimal, InvalidOperation, localcontext
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent
PROFILES = {
    "SmallBusiness": {"EligibleSmallBusiness"},
    "Nonprofit": {"EligibleNonprofit"},
    "Enterprise": {"DualListedOrSpecifiedOverseas", "OtherDomesticListed", "NonfinancialUnlisted"},
}


class RuleError(ValueError):
    """Invalid data, unsupported scope, or required manual review."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuleError(message)


def _unique(values: list[Any], label: str) -> None:
    _require(len(values) == len(set(values)), f"Duplicate {label}")


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    _unique([k for k, _ in pairs], "JSON object key")
    return dict(pairs)


def read_json(path: Path) -> Any:
    def invalid_number(value: str) -> None:
        raise RuleError(f"Non-finite JSON number: {value}")
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_pairs,
                          parse_constant=invalid_number)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise RuleError(f"Invalid UTF-8 JSON {path.name}: {exc}") from exc


def _schema(data: dict, kind: str, root: Path = ROOT) -> None:
    _require(kind in {"package", "catalog", "sources", "migration", "nonprofit-scenarios", "enterprise-evidence"}, "Unknown schema kind")
    schema = read_json(root / "schema" / f"{kind}.schema.json")
    Draft202012Validator.check_schema(schema)
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(data),
                    key=lambda e: str(list(e.path)))
    if errors:
        error = errors[0]
        raise RuleError(f"{kind} schema {list(error.path)}: {error.message}")


def _source_refs(data: Any, sources: dict[str, dict], current_only: bool = False) -> None:
    if isinstance(data, dict):
        for item in data.get("sourceRefs", []):
            sid = item["sourceId"]
            _require(sid in sources, f"Unknown source {sid}")
            if current_only:
                _require(sources[sid]["status"] == "OfficialCurrent", f"Noncurrent source {sid}")
        for value in data.values():
            _source_refs(value, sources, current_only)
    elif isinstance(data, list):
        for value in data:
            _source_refs(value, sources, current_only)


def _local_path(root: Path, relative: str) -> Path:
    p = Path(relative)
    _require(not p.is_absolute() and ".." not in p.parts, f"Unsafe relative path {relative}")
    target = (root / p).resolve()
    _require(target.is_relative_to(root.resolve()), f"Path escapes bundle: {relative}")
    return target


def validate_sources(data: dict, root: Path = ROOT) -> dict[str, dict]:
    _schema(data, "sources", root)
    _unique([s["id"] for s in data["sources"]], "source ID")
    for source in data["sources"]:
        host = urlsplit(source["url"]).hostname or ""
        _require(host.endswith(".gov.cn"), f"Nonofficial source host: {host}")
        local, digest, count = (source[k] for k in ("localPath", "sha256", "bytes"))
        if local is None:
            _require(digest is None and count is None, "Missing bytes cannot have a hash/size claim")
            _require(source["verification"] != "OfficialBytesRetrieved", "Missing official bytes")
        else:
            _require(digest is not None and count is not None, "Archived source needs hash and size")
            raw = _local_path(root, local).read_bytes()
            _require(len(raw) == count and sha256(raw).hexdigest() == digest, f"Source hash/size mismatch: {local}")
    return {s["id"]: s for s in data["sources"]}


def validate_package(data: dict, sources: dict[str, dict], root: Path = ROOT) -> None:
    _schema(data, "package", root)
    _source_refs(data, sources, current_only=True)
    _require(set(data["scope"]["includedProfiles"]) <= PROFILES[data["regime"]], "Regime/profile mismatch")
    if data["legalEffectiveFrom"]:
        _require(data["supportedPeriodsFrom"] >= data["legalEffectiveFrom"], "Supported date before legal effect")
    if data["effectiveUntil"]:
        _require(data["effectiveUntil"] >= data["supportedPeriodsFrom"], "Invalid effective interval")
    accounts = data["accounts"]
    for field in ("code", "id"):
        _unique([a[field] for a in accounts], f"account {field}")
    by_code = {a["code"]: a for a in accounts}
    official = [a for a in accounts if a["origin"] == "OfficialFirstLevel"]
    count = data["coverage"]["officialBaseCount"]
    if data["coverage"]["firstLevelAccounts"] == "CompleteOfficialBaseSnapshot":
        _require(count == len(official), "Official base count does not match first-level snapshot")
        _require(sorted(a["ordinal"] for a in official) == list(range(1, count + 1)), "Noncontiguous official ordinals")
    else:
        _require(count is None and not official, "Example accounts cannot claim official completeness")
    for a in accounts:
        _require(a["name"].strip() == a["name"], "Account name contains outer whitespace")
        if a["isContra"]:
            _require(a["category"] == "Asset" and a["normalDirection"] == "Credit", "Contra asset must be credit-normal")
        elif a["category"] in {"Asset", "Cost", "Expense"}:
            _require(a["normalDirection"] == "Debit", "Asset/cost/expense direction mismatch")
        else:
            _require(a["normalDirection"] == "Credit", "Liability/equity/income direction mismatch")
        parent = a["parentCode"]
        _require((parent is not None) == (a["origin"] == "LocalDetail"), "Local detail requires a parent; first-level accounts cannot have a parent")
        _require(a["origin"] == "LocalDetail" or len(a["code"]) == 4, "First-level account must have a four-digit code")
        if parent is not None:
            _require(a["origin"] == "LocalDetail", "Official first-level account cannot acquire a parent")
            _require(parent in by_code and parent != a["code"], "Missing/self parent")
            _require(a["code"].startswith(parent) and len(a["code"]) == len(parent) + 2, "Parent/code segment mismatch")
            _require(by_code[parent]["category"] == a["category"], "Parent/child category mismatch")
            _require(by_code[parent]["normalDirection"] == a["normalDirection"], "Parent/child direction mismatch")
            _require(by_code[parent]["restrictionPolicy"] == a["restrictionPolicy"], "Parent/child restriction mismatch")
        seen = {a["code"]}
        while parent is not None:
            _require(parent not in seen and parent in by_code, "Cyclic/missing account parent")
            seen.add(parent)
            parent = by_code[parent]["parentCode"]
    _unique([r["id"] for r in data["reports"]], "report ID")
    expected_report_coverage = "MetadataAndRepresentativeRows" if any(r["rows"] for r in data["reports"]) else "MetadataOnly"
    _require(data["coverage"]["reports"] == expected_report_coverage, "Package report coverage mismatch")
    for report in data["reports"]:
        _unique([r["id"] for r in report["rows"]], "report row ID")
        _unique(report["columns"], "report column")
        variants = report.get("columnVariants", [])
        _unique([v["period"] for v in variants], "report column variant period")
        for variant in variants:
            _unique(variant["columns"], "variant column")
            _require(bool(variant["columns"]) == (variant["status"] == "DefinedMetadata"), "Column variant coverage mismatch")
        _require(bool(report["rows"]) == (report["coverage"] == "MetadataAndRepresentativeRows"), "Report coverage mismatch")
        for row in report["rows"]:
            _unique([(t["accountCode"], t["measure"]) for t in row["terms"]], "report term")
            refs = [t["accountCode"] for t in row["terms"]]
            _require(all(c in by_code for c in refs), "Unknown report account reference")
            for c in refs:
                parent = by_code[c]["parentCode"]
                while parent is not None:
                    _require(parent not in refs, "Report would double count parent and child")
                    parent = by_code[parent]["parentCode"]
            if row["restrictionColumns"]:
                _require(data["regime"] == "Nonprofit", "Restriction columns on non-nonprofit report")
                _require(all(by_code[c]["restrictionPolicy"] == "Required" for c in refs), "Restriction/report mismatch")
    if data["regime"] == "Nonprofit":
        _require("restrictionRules" in data and "firstAdoptionComparatives" in data, "Missing nonprofit metadata")
        rules = data["restrictionRules"]
        _require(rules["closingTargets"] == {"Unrestricted": "3101", "Restricted": "3102"}, "Wrong nonprofit closing targets")
        _require(all(c in by_code for c in rules["closingTargets"].values()), "Missing closing target")
        _require(set(rules["manualReviewAccounts"]) == {a["code"] for a in accounts if a["restrictionPolicy"] == "ReviewRequired"}, "Manual review list mismatch")
        for a in accounts:
            if a["category"] in {"Income", "Expense"}:
                _require(a["restrictionPolicy"] in {"Required", "ReviewRequired"}, "Missing income/expense restriction classification")
    else:
        _require("restrictionRules" not in data and "firstAdoptionComparatives" not in data, "Unexpected nonprofit policy")


def validate_migration(data: dict, target: dict, sources: dict[str, dict], root: Path = ROOT) -> None:
    _schema(data, "migration", root)
    _source_refs(data, sources, current_only=True)
    _require(data["toPackageId"] == target["id"], "Wrong migration target version")
    _require(data["fromDate"] < data["toDate"], "Invalid migration date boundary")
    by_code = {a["code"]: a for a in target["accounts"]}
    _unique([(m["fromCode"], m["fromName"]) for m in data["mappings"]], "migration source semantic key")
    _unique([m["code"] for m in data["sameCodeConflicts"]], "conflict code")
    for m in data["mappings"]:
        a = by_code.get(m["toCode"])
        _require(a is not None and a["name"] == m["toName"], "Migration target meaning mismatch")
        if a["category"] in {"Income", "Expense"}:
            _require(m["action"] == "ZeroBalanceOnly", "Cannot carry old income/expense balances")
    for c in data["sameCodeConflicts"]:
        _require(c["code"] in by_code and by_code[c["code"]]["name"] == c["newName"], "Conflict target mismatch")
        _require(c["oldName"] != c["newName"], "Spurious same-code conflict")
        mapping = [m for m in data["mappings"] if m["fromCode"] == c["code"] and m["fromName"] == c["oldName"]]
        _require(len(mapping) == 1 and mapping[0]["toCode"] != c["code"], "Unresolved same-code semantic conflict")


def load_bundle(root: Path = ROOT) -> tuple[dict, dict[str, dict], dict]:
    sources = validate_sources(read_json(root / "sources.json"), root)
    catalog = read_json(root / "catalog.json")
    _schema(catalog, "catalog", root)
    _source_refs(catalog, sources)
    _unique([e["id"] for e in catalog["entries"]], "catalog ID")
    packages = {}
    for entry in catalog["entries"]:
        if not entry["selectable"]:
            _require(entry["path"] is None and entry["sha256"] is None, "Unimplemented entries must be metadata only")
            continue
        _require(entry["status"] == "OfficialCurrent" and entry["path"] and entry["sha256"], "Draft/future cannot be selected")
        path = _local_path(root, entry["path"])
        _require(sha256(path.read_bytes()).hexdigest() == entry["sha256"], f"Package hash mismatch: {entry['path']}")
        package = read_json(path)
        validate_package(package, sources, root)
        _require((package["id"], package["regime"]) == (entry["id"], entry["regime"]), "Catalog/package identity mismatch")
        packages[package["id"]] = package
    _require({p["regime"] for p in packages.values()} == set(PROFILES), "Missing regime")
    migration = read_json(root / "migrations/nonprofit-2004-to-2026.json")
    _require(migration["toPackageId"] in packages, "Missing migration target package")
    validate_migration(migration, packages[migration["toPackageId"]], sources, root)
    return catalog, packages, migration


def validate_bundle(root: Path = ROOT) -> dict:
    catalog, packages, migration = load_bundle(root)
    result = {"valid": True, "asOf": catalog["asOf"], "packages": len(packages),
            "accountCounts": {p["regime"]: len(p["accounts"]) for p in packages.values()},
            "allVerifiedForProduction": False, "completeMigrationValidated": migration["completeMigrationValidated"]}
    from rules.nonprofit_scenarios import validate_scenario_pack
    sources = {s["id"]: s for s in read_json(root / "sources.json")["sources"]}
    nonprofit = next(p for p in packages.values() if p["regime"] == "Nonprofit")
    result["nonprofitSyntheticAcceptance"] = validate_scenario_pack(read_json(root / "scenarios/nonprofit-v2.json"), nonprofit, sources, root)
    from rules.enterprise_evidence import validate_enterprise_evidence
    enterprise = next(p for p in packages.values() if p["regime"] == "Enterprise")
    result["enterpriseOfficialEvidence"] = validate_enterprise_evidence(read_json(_local_path(root, enterprise["officialNameEvidencePath"])), sources, enterprise, root)
    return result


def _date(value: str) -> date:
    _require(isinstance(value, str), "Date must be ISO yyyy-MM-dd")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise RuleError("Date must be ISO yyyy-MM-dd") from exc
    _require(parsed.isoformat() == value, "Date must be ISO yyyy-MM-dd")
    return parsed


def select_package(regime: str, on: str, profile: str, *, eligibility_confirmed: bool = False,
                   early_adopt_cas30: bool = False, root: Path = ROOT) -> dict:
    """Return a reference snapshot, never a production-compliance certification.

    Caller must substantiate eligibility and separately persist ID/version/hash.
    Dates are accounting/report dates, never application installation dates.
    """
    requested = _date(on)
    _require(regime in PROFILES and profile in PROFILES[regime], "Unsupported regime/profile")
    _require(eligibility_confirmed is True, "Human eligibility review required")
    _require(isinstance(early_adopt_cas30, bool), "Early adoption must be boolean")
    _require(not early_adopt_cas30 or regime == "Enterprise", "CAS30 choice applies only to Enterprise")
    catalog, packages, _ = load_bundle(root)
    if regime == "Enterprise":
        change = catalog["enterprisePresentationChange"]
        deadline = _date(change["mandatoryFrom"][profile])
        _require(not early_adopt_cas30 and requested < deadline,
                 "CAS30-2026 is applicable but unimplemented; cannot fall back to 2019 reports")
    candidates = [p for p in packages.values() if p["regime"] == regime
                  and profile in p["scope"]["includedProfiles"]
                  and _date(p["supportedPeriodsFrom"]) <= requested
                  and (p["effectiveUntil"] is None or requested <= _date(p["effectiveUntil"]))]
    _require(len(candidates) == 1, "No unique supported rule version for period; no automatic fallback")
    return candidates[0]


def _money(value: str) -> Decimal:
    _require(isinstance(value, str), "Money must be a decimal string; floats are forbidden")
    _require(re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?", value) is not None,
             "Money must be a canonical decimal string with at most two places")
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise RuleError("Invalid decimal money") from exc
    _require(amount.is_finite(), "Non-finite money")
    _require(amount.as_tuple().exponent >= -2, "Money precision exceeds two decimal places")
    _require(amount.copy_abs() <= Decimal("92233720368547758.07"), "Money exceeds signed Int64-cent adapter range")
    return amount


def evaluate_sample_row(package: dict, report_id: str, row_id: str, facts: list[dict], *, restriction: str | None = None) -> Decimal:
    """Evaluate only a representative row from explicit facts; missing input errors.

    Each fact: accountCode, measure, restriction (None/Unrestricted/Restricted), value.
    Parent facts already aggregate children. Never add a child fact a second time.
    """
    reports = [r for r in package["reports"] if r["id"] == report_id]
    _require(len(reports) == 1, "Unknown report")
    rows = [r for r in reports[0]["rows"] if r["id"] == row_id]
    _require(len(rows) == 1, "Row is not implemented")
    row = rows[0]
    _require(restriction in (row["restrictionColumns"] if row["restrictionColumns"] else [None]), "Wrong restriction column")
    by_code = {a["code"]: a for a in package["accounts"]}
    values = {}
    for fact in facts:
        _require(set(fact) == {"accountCode", "measure", "restriction", "value"}, "Unknown/missing fact field")
        code, measure, dim = (fact[k] for k in ("accountCode", "measure", "restriction"))
        _require(code in by_code and measure in {"closing_net_debit", "period_net_debit"}, "Unknown fact account/measure")
        policy = by_code[code]["restrictionPolicy"]
        _require(dim in (["Unrestricted", "Restricted"] if policy != "NotApplicable" else [None]), "Missing/wrong fact restriction")
        _require(policy != "ReviewRequired", "Account treatment requires manual review")
        key = code, measure, dim
        _require(key not in values, "Duplicate fact; aggregate explicitly before row evaluation")
        values[key] = _money(fact["value"])
    with localcontext(Context(prec=40)):
        result = Decimal("0.00")
        for term in row["terms"]:
            key = term["accountCode"], term["measure"], restriction
            _require(key in values, f"Missing report fact {key}; missing is not zero")
            result += values[key] * term["coefficient"]
    _require(result.copy_abs() <= Decimal("92233720368547758.07"), "Report result exceeds cent adapter range")
    return result


def nonprofit_closing_route(package: dict, account_code: str, restriction: str, *, evidence_kind: str | None = None) -> str:
    """Review-only routing for classified income/expense, not a posting operation."""
    _require(package["regime"] == "Nonprofit" and "restrictionRules" in package, "Nonprofit policy required")
    accounts = [a for a in package["accounts"] if a["code"] == account_code]
    _require(len(accounts) == 1 and accounts[0]["category"] in {"Income", "Expense"}, "Income/expense account required")
    _require(accounts[0]["restrictionPolicy"] == "Required", "Manual accountant review required")
    rules = package["restrictionRules"]
    _require(restriction in rules["dimensionValues"], "Explicit restriction classification required")
    if restriction == "Restricted":
        _require(evidence_kind in rules["evidenceRequiredForRestricted"], "External restriction evidence required; internal budget alone is insufficient")
    return rules["closingTargets"][restriction]


def migration_candidate(migration: dict, *, from_version: str, code: str, name: str, balance: str) -> dict:
    """Resolve an evidence-backed candidate for a workpaper, never migrate a balance."""
    _require(from_version == migration["fromRegimeVersion"], "Unknown original regime version")
    amount = _money(balance)
    candidates = [m for m in migration["mappings"] if (m["fromCode"], m["fromName"]) == (code, name)]
    _require(len(candidates) == 1, "No verified semantic mapping; code-only fallback forbidden")
    candidate = candidates[0]
    _require(candidate["action"] != "ManualClassification", "Balance classification and accountant review required")
    _require(candidate["action"] != "ZeroBalanceOnly" or amount == 0, "Old income/expense balance must be zero; never carry it forward")
    return {**candidate, "isExecutable": False, "completeMigrationValidated": False}
