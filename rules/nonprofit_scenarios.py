"""Synthetic Contracts-v2 acceptance oracle, not a ledger service or compliance tool.

Integer cents keep arithmetic independent of the caller's Decimal context. Input
journals and expected results are fixed, independently hand-calculated fixtures.
No voucher is generated, persisted, approved or posted by this module.
"""
from __future__ import annotations

from decimal import Context, localcontext
from pathlib import Path

from rules.runtime import ROOT, RuleError, _date, _money, _schema, _source_refs, read_json


class ScenarioError(RuleError):
    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code


def require(condition: bool, code: str, detail: str) -> None:
    if not condition:
        raise ScenarioError(code, detail)


def cents(value: str) -> int:
    with localcontext(Context(prec=40)):
        return int(_money(value) * 100)


def money(value: int) -> str:
    sign = "-" if value < 0 else ""
    absolute = abs(value)
    return f"{sign}{absolute // 100}.{absolute % 100:02d}"


def _dimension(line: dict, account: dict, restrictions: dict[str, dict]) -> None:
    code, dim, rid = line["accountCode"], line["restrictionClass"], line["restrictionId"]
    require(code != "5601", "NP_MANUAL_TAX_REVIEW", "5601 treatment has unresolved specialist review")
    needs = account["category"] in {"Income", "Expense"}
    if needs:
        require(dim in {"Unrestricted", "Restricted"}, "NP_CLASS_REQUIRED", "income AND expense require an explicit class")
    elif code in {"3101", "3102"}:
        require(dim == ("Unrestricted" if code == "3101" else "Restricted"), "NP_NET_ASSET_CLASS", "net-asset class must match the account")
    else:
        require(dim is None and rid is None, "NP_CLASS_NOT_APPLICABLE", "asset/liability lines use separate funding links, not income/expense classes")
    if dim == "Restricted":
        require(rid in restrictions, "NP_RESTRICTION_EVIDENCE", "restricted income/expense requires a known evidence record")
        evidence = restrictions[rid]
        require(evidence["sourceKind"] != "InternalBudget", "NP_INTERNAL_BUDGET", "board budget alone is not an external restriction")
        require(evidence["sourceKind"] in {"ExternalProvider", "LawOrAdministrativeRegulation"}, "NP_RESTRICTION_EVIDENCE", "external provider or legal evidence required")
        require(isinstance(evidence["evidenceId"], str) and bool(evidence["evidenceId"].strip()) and bool(evidence["conditions"]), "NP_RESTRICTION_EVIDENCE", "evidence and specific conditions required")
    if dim == "Unrestricted":
        require(rid is None, "NP_CLASS_RESTRICTION_MISMATCH", "unrestricted line cannot carry an external restriction ID")


def check_allocation(allocation: dict, accounts: dict[str, dict], restrictions: dict[str, dict]) -> dict[str, str]:
    """Validate one explicitly approved reasonable basis and a chosen cent policy.

    Largest-remainder rounding is an engineering choice, never a statutory rule.
    Ties use the declared unique row ID. No implicit unexplained balancing plug.
    """
    require(allocation["basisApproved"] is True and isinstance(allocation["basisEvidenceId"], str) and bool(allocation["basisEvidenceId"].strip()), "NP_ALLOCATION_BASIS", "reasonable basis needs documented human approval")
    rows = allocation["rows"]
    require(len({r["id"] for r in rows}) == len(rows), "NP_ALLOCATION_DUPLICATE", "duplicate allocation row")
    total = cents(allocation["total"])
    require(total > 0, "NP_ALLOCATION_TOTAL", "positive common expense required")
    require(all(r["weight"] > 0 for r in rows), "NP_ALLOCATION_WEIGHT", "positive rational weights required")
    denominator = sum(r["weight"] for r in rows)
    amounts = {r["id"]: total * r["weight"] // denominator for r in rows}
    remaining = total - sum(amounts.values())
    order = sorted(rows, key=lambda r: (-(total * r["weight"] % denominator), r["id"]))
    for row in order[:remaining]:
        amounts[row["id"]] += 1
    for row in rows:
        require(row["accountCode"] in accounts and accounts[row["accountCode"]]["category"] == "Expense", "NP_ALLOCATION_ACCOUNT", "expense function and restriction class are independent")
        _dimension(row, accounts[row["accountCode"]], restrictions)
        require(cents(row["amount"]) == amounts[row["id"]], "NP_ALLOCATION_AMOUNT", "allocation differs from approved basis/cent policy")
    require(sum(cents(r["amount"]) for r in rows) == total, "NP_ALLOCATION_TOTAL", "cost must be conserved")
    return {key: money(value) for key, value in amounts.items()}


def _check_closing(voucher: dict, accounts: dict[str, dict]) -> None:
    lines = voucher["lines"]
    pl = [l for l in lines if accounts[l["accountCode"]]["category"] in {"Income", "Expense"}]
    net = [l for l in lines if l["accountCode"] in {"3101", "3102"}]
    require(len(pl) == 1 and len(net) == 1 and len(lines) == 2, "NP_CLOSE_SHAPE", "synthetic close contains one classified P/L account and one matching net asset")
    expected = "3102" if pl[0]["restrictionClass"] == "Restricted" else "3101"
    require(net[0]["accountCode"] == expected, "NP_CLOSE_TARGET", "restricted expense cannot close to unrestricted net assets")
    require(net[0]["restrictionId"] == pl[0]["restrictionId"], "NP_CLOSE_RESTRICTION_ID", "closing must preserve the individual restriction identity")
    account = accounts[pl[0]["accountCode"]]
    require((account["category"] == "Income" and cents(pl[0]["debit"]) > 0) or
            (account["category"] == "Expense" and cents(pl[0]["credit"]) > 0),
            "NP_CLOSE_DIRECTION", "these synthetic examples close positive income/expense in the opposite direction")


def _check_release(voucher: dict, restrictions: dict[str, dict]) -> tuple[int, int]:
    assessment = voucher["releaseAssessment"]
    require(assessment is not None and assessment["restrictionId"] in restrictions and isinstance(assessment["evidenceId"], str) and bool(assessment["evidenceId"].strip()), "NP_RELEASE_EVIDENCE", "spending alone never authorizes a release")
    conditions = restrictions[assessment["restrictionId"]]["conditions"]
    satisfied = (assessment["timeSatisfied"] or "Time" not in conditions) and (assessment["purposeSatisfied"] or "Purpose" not in conditions)
    require(assessment["providerRevoked"] or satisfied, "NP_RESTRICTION_NOT_FULLY_RELEASED", "expiry of time does not remove a surviving purpose restriction")
    lines = voucher["lines"]
    require(len(lines) == 2 and {l["accountCode"] for l in lines} == {"3101", "3102"}, "NP_RELEASE_SHAPE", "release transfers between two net asset classes")
    debit = next(l for l in lines if l["accountCode"] == "3102")
    credit = next(l for l in lines if l["accountCode"] == "3101")
    require(debit["restrictionId"] == assessment["restrictionId"], "NP_RELEASE_RESTRICTION_ID", "release evidence and source net assets must identify the same restriction")
    require(cents(debit["debit"]) > 0 and cents(debit["credit"]) == 0 and cents(credit["credit"]) == cents(debit["debit"]) and cents(credit["debit"]) == 0,
            "NP_RELEASE_DIRECTION", "this fixture represents restricted-to-unrestricted release")
    return cents(credit["credit"]), -cents(debit["debit"])


def evaluate_case(case: dict, package: dict) -> dict:
    """Validate classified synthetic inputs and return arithmetic for comparison."""
    accounts = {a["code"]: a for a in package["accounts"]}
    restrictions = {r["id"]: r for r in case["restrictions"]}
    require(len(restrictions) == len(case["restrictions"]), "NP_RESTRICTION_DUPLICATE", "duplicate restriction ID")
    allocation_results = {a["id"]: check_allocation(a, accounts, restrictions) for a in case["allocations"]}
    require(len(allocation_results) == len(case["allocations"]), "NP_ALLOCATION_DUPLICATE", "duplicate allocation ID")
    if case["kind"] == "Allocation":
        require(not case["vouchers"], "NP_ALLOCATION_SHAPE", "standalone allocation has no posting")
        return {"allocations": allocation_results}
    balances = {code: 0 for code in accounts}
    classified_balances: dict[tuple[str, str | None, str | None], int] = {}
    metrics = {k: 0 for k in ["incomeUnrestricted", "incomeRestricted", "expenseUnrestricted", "expenseRestricted", "cashChange", "releasedToUnrestricted", "releasedFromRestricted"]}
    require(len({v["id"] for v in case["vouchers"]}) == len(case["vouchers"]), "NP_VOUCHER_DUPLICATE", "duplicate synthetic voucher ID")
    voucher_by_id = {v["id"]: v for v in case["vouchers"]}
    allocation_links = [(a["voucherId"], r["id"]) for a in case["allocations"] for r in a["rows"]]
    require(len(set(allocation_links)) == len(allocation_links), "NP_ALLOCATION_REPEATED_LINE", "one expense line cannot be allocated twice under different allocation IDs")
    opening_positions = [i for i, v in enumerate(case["vouchers"]) if v["kind"] == "Opening"]
    require(not opening_positions or opening_positions == [0], "NP_OPENING_ORDER", "opening snapshot occurs at most once and only before all activity")
    dates = [_date(v["date"]) for v in case["vouchers"]]
    require(all(d >= _date(package["supportedPeriodsFrom"]) for d in dates), "NP_PERIOD_UNSUPPORTED", "cannot apply the 2026 chart to an earlier period")
    require(dates == sorted(dates), "NP_VOUCHER_ORDER", "synthetic vouchers are evaluated in their supplied chronological order")
    for allocation in case["allocations"]:
        require(allocation["voucherId"] in voucher_by_id, "NP_ALLOCATION_VOUCHER", "allocation must link to the synthetic expense voucher")
        lines = {l["id"]: l for l in voucher_by_id[allocation["voucherId"]]["lines"]}
        for row in allocation["rows"]:
            line = lines.get(row["id"])
            require(line is not None and all(line[k] == row[k] for k in ["accountCode", "restrictionClass", "restrictionId"]) and cents(line["debit"]) == cents(row["amount"]) and cents(line["credit"]) == 0,
                    "NP_ALLOCATION_POSTING", "allocation bridge must preserve function, class and amount")
    for voucher in case["vouchers"]:
        require(voucher["kind"] == "Release" or voucher["releaseAssessment"] is None, "NP_RELEASE_SHAPE", "only an explicit release may carry a release assessment")
        require(len({l["id"] for l in voucher["lines"]}) == len(voucher["lines"]), "NP_LINE_DUPLICATE", "duplicate synthetic voucher line ID")
        debit = credit = 0
        for line in voucher["lines"]:
            code = line["accountCode"]
            require(code in accounts, "NP_UNKNOWN_ACCOUNT", "unknown account")
            _dimension(line, accounts[code], restrictions)
            d, c = cents(line["debit"]), cents(line["credit"])
            require(d >= 0 and c >= 0 and (d > 0) != (c > 0), "NP_LINE_AMOUNT", "one positive side per synthetic line")
            debit += d;credit += c
        require(debit == credit and debit > 0, "NP_UNBALANCED", "synthetic voucher must balance")
        if voucher["kind"] == "Closing":
            _check_closing(voucher, accounts)
            pl = next(l for l in voucher["lines"] if accounts[l["accountCode"]]["category"] in {"Income", "Expense"})
            key = pl["accountCode"], pl["restrictionClass"], pl["restrictionId"]
            before = classified_balances.get(key, 0)
            net = cents(pl["debit"]) - cents(pl["credit"])
            require(before * net < 0 and abs(net) <= abs(before), "NP_CLOSE_CLASS_BALANCE", "cannot close a different class/grant or more than its recorded P/L balance")
        elif voucher["kind"] == "Release":
            u, r = _check_release(voucher, restrictions)
            rid = voucher["releaseAssessment"]["restrictionId"]
            available = -classified_balances.get(("3102", "Restricted", rid), 0)
            require(0 < u <= available, "NP_RELEASE_EXCEEDS_AVAILABLE", "release cannot consume another grant or be repeated beyond the remaining amount")
            require(u == available, "NP_RELEASE_AMOUNT_SCOPE", "full release applies to this entire restriction record; a partial tranche needs a separate evidence scope")
            metrics["releasedToUnrestricted"] += u;metrics["releasedFromRestricted"] += r
        else:
            require(voucher["releaseAssessment"] is None, "NP_RELEASE_SHAPE", "release assessment only on explicit release operation")
            if voucher["kind"] == "Activity":
                require(not any(l["accountCode"] in {"3101", "3102"} for l in voucher["lines"]), "NP_NET_ASSET_OPERATION", "these synthetic Activity examples cannot hide a net-asset reclassification; registered capital needs a separate reviewed operation")
            if voucher["kind"] == "Opening":
                require(not any(accounts[l["accountCode"]]["category"] in {"Income", "Expense"} for l in voucher["lines"]), "NP_OPENING_PL", "old income/expense cannot be carried into opening balances")
                require(any(accounts[l["accountCode"]]["category"] in {"Asset", "Liability"} for l in voucher["lines"]), "NP_OPENING_NOT_RECLASSIFICATION", "a pure net-asset transfer is not an opening snapshot")
        if voucher["cashNature"] == "Noncash":
            require(not any(l["accountCode"] in {"1001", "1002", "1009"} for l in voucher["lines"]), "NP_NONCASH_HAS_CASH", "service donation must not create fictitious cash")
        for line in voucher["lines"]:
            code = line["accountCode"];net = cents(line["debit"]) - cents(line["credit"])
            balances[code] += net
            key = code, line["restrictionClass"], line["restrictionId"]
            classified_balances[key] = classified_balances.get(key, 0) + net
            if voucher["kind"] != "Opening" and code in {"1001", "1002", "1009"}:
                metrics["cashChange"] += net
            if voucher["kind"] == "Activity":
                category = accounts[code]["category"]
                if category in {"Income", "Expense"}:
                    metrics[("income" if category == "Income" else "expense") + line["restrictionClass"]] += -net if category == "Income" else net
    require(all(balances[c] == 0 for c, a in accounts.items() if a["category"] in {"Income", "Expense"}), "NP_UNCLOSED_PL", "all synthetic income/expense classes must close to zero")
    require(all(value == 0 for (code, _, _), value in classified_balances.items() if accounts[code]["category"] in {"Income", "Expense"}), "NP_UNCLOSED_CLASS", "aggregate zero cannot hide residual class/grant balances")
    require(balances["3201"] == 0, "NP_UNSUPPORTED_PRIOR_ADJUSTMENT", "prior-year adjustments need a separate reviewed scenario")
    assets = sum(balances[c] for c, a in accounts.items() if a["category"] == "Asset")
    liabilities = -sum(balances[c] for c, a in accounts.items() if a["category"] == "Liability")
    metrics.update(assets=assets, liabilities=liabilities, unrestrictedNetAssets=-balances["3101"], restrictedNetAssets=-balances["3102"])
    metrics["totalNetAssets"] = metrics["unrestrictedNetAssets"] + metrics["restrictedNetAssets"]
    require(assets == liabilities + metrics["totalNetAssets"], "NP_BALANCE_SHEET", "assets must equal liabilities plus both net-asset classes")
    require(all(abs(n) <= 9223372036854775807 for n in metrics.values()), "NP_TOTAL_OVERFLOW", "aggregate exceeds signed Int64 cents")
    return {"metrics": {k: money(v) for k, v in metrics.items()}, "incomeExpenseClosingZero": True, "allocations": allocation_results}


def validate_scenario_pack(data: dict, package: dict, sources: dict, root: Path = ROOT) -> dict:
    _schema(data, "nonprofit-scenarios", root)
    _source_refs(data, sources, current_only=True)
    require(data["packageId"] == package["id"], "NP_PACKAGE_VERSION", "synthetic acceptance pack must bind to the intended official chart")
    ids = [c["id"] for c in data["cases"]]
    require(len(set(ids)) == len(ids), "NP_CASE_DUPLICATE", "duplicate case ID")
    accepted = rejected = 0
    for case in data["cases"]:
        expected_error = case["expected"]["errorCode"]
        try:
            actual = evaluate_case(case, package)
        except ScenarioError as exc:
            require(expected_error == exc.code, "NP_ORACLE_MISMATCH", f"{case['id']}: expected {expected_error}, actual {exc.code}")
            rejected += 1
        else:
            require(expected_error is None, "NP_ORACLE_MISMATCH", f"{case['id']}: expected rejection {expected_error}, accepted")
            require(actual == case["expected"]["result"], "NP_ORACLE_MISMATCH", f"{case['id']}: independently specified arithmetic disagrees")
            accepted += 1
    return {"cases": len(ids), "acceptedExamples": accepted, "rejectionExamples": rejected, "productionCertified": False}
