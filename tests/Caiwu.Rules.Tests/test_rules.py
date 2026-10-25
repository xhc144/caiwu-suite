"""Independent data/negative regression tests; no WPF, SQLite or .NET needed."""
from copy import deepcopy
from decimal import Decimal, localcontext
from hashlib import sha256
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from rules.runtime import (
    ROOT, RuleError, _schema, evaluate_sample_row, load_bundle, migration_candidate,
    nonprofit_closing_route, read_json, select_package, validate_bundle,
    validate_migration, validate_package, validate_sources,
)


def fact(code, value, measure="closing_net_debit", restriction=None):
    return dict(accountCode=code, measure=measure, restriction=restriction, value=value)


class RulesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, packages, cls.migration = load_bundle()
        cls.sources = {s["id"]: s for s in read_json(ROOT / "sources.json")["sources"]}
        cls.packages = {p["regime"]: p for p in packages.values()}

    def check_invalid(self, data, pattern=None):
        with self.assertRaisesRegex(RuleError, pattern or ".+"):
            validate_package(data, self.sources)

    def test_bundle_and_honest_coverage(self):
        result = validate_bundle()
        self.assertTrue(result["valid"])
        self.assertEqual({"SmallBusiness": 66, "Enterprise": 9, "Nonprofit": 56}, result["accountCounts"])
        self.assertFalse(result["allVerifiedForProduction"])
        self.assertFalse(result["completeMigrationValidated"])
        for p in self.packages.values():
            self.assertFalse(p["isVerifiedForProduction"])
            self.assertFalse(p["coverage"]["allCurrentRequirementsCovered"])
            self.assertTrue(all(not r["isCompleteFormulaSet"] for r in p["reports"]))

    def test_official_nonprofit_56_code_set(self):
        # Independent transcription of the table in official PDF pages 47-49.
        expected = """1001 1002 1009 1101 1102 1111 1121 1122 1131 1141 1201 1202 1301
        1401 1402 1403 1421 1501 1502 1505 1506 1509 1601 1602 1701 1801
        2101 2201 2202 2203 2204 2206 2209 2301 2501 2502 2503 2601
        3101 3102 3201 4101 4201 4301 4401 4501 4601 4701 4901
        5101 5201 5301 5401 5501 5601 5901""".split()
        p = self.packages["Nonprofit"]
        self.assertEqual(expected, [a["code"] for a in p["accounts"]])
        a = {a["code"]: a for a in p["accounts"]}
        self.assertEqual("长期待摊费用", a["1701"]["name"])
        self.assertEqual("受托代理资产", a["1801"]["name"])
        self.assertEqual("税金及附加", a["5201"]["name"])
        self.assertEqual("总部拨款收入", a["4701"]["name"])
        self.assertEqual("现金", a["1001"]["name"])

    def test_small_66_base_is_distinct_with_traced_rename(self):
        expected = """1001 1002 1012 1101 1121 1122 1123 1131 1132 1221
        1401 1402 1403 1404 1405 1407 1408 1411 1421 1501 1511
        1601 1602 1604 1605 1606 1621 1622 1701 1702 1801 1901
        2001 2201 2202 2203 2211 2221 2231 2232 2241 2401 2501 2701
        3001 3002 3101 3103 3104 4001 4101 4301 4401 4403
        5001 5051 5111 5301 5401 5402 5403 5601 5602 5603 5711 5801""".split()
        p = self.packages["SmallBusiness"]
        self.assertEqual(expected, [a["code"] for a in p["accounts"]])
        a = {a["code"]: a for a in p["accounts"]}
        self.assertEqual("库存现金", a["1001"]["name"])
        self.assertEqual("税金及附加", a["5403"]["name"])
        self.assertEqual("营业税金及附加", a["5403"]["officialBaseName"])
        self.assertIn("vat-rename", [s["sourceId"] for s in a["5403"]["sourceRefs"]])
        self.assertFalse(any(a["name"] == "资产减值损失" for a in p["accounts"]))

    def test_enterprise_examples_do_not_claim_official_numbers(self):
        p = self.packages["Enterprise"]
        self.assertEqual("EngineeringExamplesOnly", p["coverage"]["firstLevelAccounts"])
        self.assertIsNone(p["coverage"]["officialBaseCount"])
        self.assertTrue(all(a["origin"] == "EngineeringExampleCode" for a in p["accounts"]))
        unverified = {"1002", "1403", "4103", "6001", "6401"}
        for a in p["accounts"]:
            if a["code"] in unverified:
                self.assertEqual("UnverifiedEngineeringExample", a["nameVerification"])
                self.assertTrue(all(s["sourceId"] == "enterprise-guide-access" for s in a["sourceRefs"]))
        self.assertTrue(all(r["coverage"] == "MetadataOnly" for r in p["reports"]))
        self.assertNotEqual({a["code"] for a in p["accounts"]}, {a["code"] for a in self.packages["SmallBusiness"]["accounts"]})

    def test_schema_rejects_unknown_fields_bad_date_wrong_types(self):
        for field, value in [("extra", True), ("supportedPeriodsFrom", "2026-02-30"), ("isVerifiedForProduction", True), ("schemaVersion", 2)]:
            with self.subTest(field=field):
                p = deepcopy(self.packages["SmallBusiness"]);p[field] = value
                self.check_invalid(p, "schema")

    def test_duplicate_codes_and_stable_ids_rejected(self):
        for field in ["code", "id"]:
            with self.subTest(field=field):
                p = deepcopy(self.packages["SmallBusiness"])
                p["accounts"][1][field] = p["accounts"][0][field]
                self.check_invalid(p, "Duplicate")

    def test_non_ascii_and_malformed_code_rejected(self):
        for code in ["１００２", "10x2", " 1002", "10021", "", "10-02"]:
            with self.subTest(code=code):
                p = deepcopy(self.packages["SmallBusiness"]);p["accounts"][1]["code"] = code
                self.check_invalid(p, "schema")

    def test_base_count_omission_and_ordinals_rejected(self):
        p = deepcopy(self.packages["Nonprofit"]);p["accounts"].pop()
        self.check_invalid(p, "count")
        p = deepcopy(self.packages["Nonprofit"]);p["accounts"][1]["ordinal"] = 1
        self.check_invalid(p, "ordinals")

    def test_contra_assets_are_credit_normal(self):
        expected = {"SmallBusiness": {"1407", "1602", "1622", "1702"},
                    "Nonprofit": {"1102", "1131", "1202", "1421", "1502", "1602"}}
        for regime, codes in expected.items():
            accounts = {a["code"]: a for a in self.packages[regime]["accounts"]}
            for code in codes:
                self.assertTrue(accounts[code]["isContra"])
                self.assertEqual("Credit", accounts[code]["normalDirection"])
                p = deepcopy(self.packages[regime])
                next(a for a in p["accounts"] if a["code"] == code)["normalDirection"] = "Debit"
                self.check_invalid(p, "Contra")

    def test_wrong_income_expense_direction_rejected(self):
        for code in ["4101", "5301"]:
            p = deepcopy(self.packages["Nonprofit"])
            a = next(a for a in p["accounts"] if a["code"] == code)
            a["normalDirection"] = "Debit" if code == "4101" else "Credit"
            self.check_invalid(p, "direction")

    def _with_child(self):
        p = deepcopy(self.packages["SmallBusiness"])
        child = deepcopy(p["accounts"][1])
        child.update(code="100201", id="local-bank-a", name="开户行A", parentCode="1002", origin="LocalDetail", ordinal=None)
        p["accounts"].append(child)
        return p

    def test_local_detail_valid_but_not_claimed_statutory(self):
        validate_package(self._with_child(), self.sources)

    def test_orphan_detail_and_nonfour_digit_first_level_rejected(self):
        p = self._with_child();p["accounts"][-1]["parentCode"] = None
        self.check_invalid(p, "requires a parent")
        p = deepcopy(self.packages["SmallBusiness"])
        next(a for a in p["accounts"] if a["code"] == "1604")["code"] = "160401"
        self.check_invalid(p, "four-digit")

    def test_parent_missing_self_cycle_segment_category_rejected(self):
        for changes in [{"parentCode": "9999"}, {"parentCode": "100201"}, {"parentCode": "1001"},
                        {"code": "10020101"}, {"category": "Cost"}, {"normalDirection": "Credit"}]:
            with self.subTest(changes=changes):
                p = self._with_child();p["accounts"][-1].update(changes)
                self.check_invalid(p)

    def test_report_missing_reference_duplicate_rows_double_count_rejected(self):
        p = deepcopy(self.packages["SmallBusiness"])
        p["reports"][0]["rows"][0]["terms"][0]["accountCode"] = "9999"
        self.check_invalid(p, "Unknown report account")
        p = deepcopy(self.packages["SmallBusiness"])
        p["reports"][0]["rows"].append(deepcopy(p["reports"][0]["rows"][0]))
        self.check_invalid(p, "Duplicate report row")
        p = self._with_child()
        p["reports"][0]["rows"][0]["terms"].append(dict(accountCode="100201", measure="closing_net_debit", coefficient=1))
        self.check_invalid(p, "double count")

    def test_unknown_and_draft_source_cannot_authorize_current_package(self):
        for source_id in ["missing", "enterprise-chart-draft", "enterprise-cas30"]:
            with self.subTest(source_id=source_id):
                p = deepcopy(self.packages["Enterprise"])
                p["accounts"][0]["sourceRefs"][0]["sourceId"] = source_id
                self.check_invalid(p, "source")

    def test_valid_source_and_package_hashes_are_enforced(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "rules";shutil.copytree(ROOT, root)
            path = root / "sources/official/small-appendix.pdf"
            path.write_bytes(path.read_bytes() + b"tamper")
            with self.assertRaisesRegex(RuleError, "Source hash/size mismatch"):
                load_bundle(root)
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "rules";shutil.copytree(ROOT, root)
            path = root / "packages/nonprofit.json"
            path.write_text(path.read_text() + " ", encoding="utf-8")
            with self.assertRaisesRegex(RuleError, "Package hash mismatch"):
                load_bundle(root)

    def test_archived_path_traversal_and_fake_missing_byte_hash_rejected(self):
        data = read_json(ROOT / "sources.json")
        data["sources"][0]["localPath"] = "../outside.pdf"
        with self.assertRaisesRegex(RuleError, "Unsafe relative path"):
            validate_sources(data)
        data = read_json(ROOT / "sources.json")
        data["sources"][0]["localPath"] = None
        with self.assertRaisesRegex(RuleError, "Missing bytes"):
            validate_sources(data)

    def test_duplicate_json_keys_invalid_utf8_and_nonfinite_json_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.json"
            for raw in [b'{"code":"1701","code":"1801"}', b'\xff', b'{"amount":NaN}']:
                with self.subTest(raw=raw):
                    p.write_bytes(raw)
                    with self.assertRaises(RuleError):read_json(p)

    def test_current_selection_requires_review_and_scope(self):
        for regime, profile in [("SmallBusiness", "EligibleSmallBusiness"), ("Nonprofit", "EligibleNonprofit"), ("Enterprise", "NonfinancialUnlisted")]:
            with self.subTest(regime=regime):
                self.assertEqual(regime, select_package(regime, "2026-10-25", profile, eligibility_confirmed=True)["regime"])
                with self.assertRaisesRegex(RuleError, "eligibility"):select_package(regime, "2026-10-25", profile)
        for regime, profile in [("Enterprise", "Bank"), ("SmallBusiness", "EligibleNonprofit"), ("Nonprofit", "Government")]:
            with self.assertRaisesRegex(RuleError, "profile"):
                select_package(regime, "2026-10-25", profile, eligibility_confirmed=True)

    def test_old_period_and_invalid_date_never_fall_back(self):
        for value in ["2025-12-31", "2026-1-1", "2026-02-30", "2026-01-01T00:00:00"]:
            with self.subTest(value=value):
                with self.assertRaises(RuleError):select_package("Nonprofit", value, "EligibleNonprofit", eligibility_confirmed=True)
        self.assertEqual("2026-01-01", select_package("Nonprofit", "2026-01-01", "EligibleNonprofit", eligibility_confirmed=True)["legalEffectiveFrom"])

    def test_cas30_three_mandatory_boundaries_and_early_choice_block(self):
        for profile, before, required in [
            ("DualListedOrSpecifiedOverseas", "2026-12-31", "2027-01-01"),
            ("OtherDomesticListed", "2028-12-31", "2029-01-01"),
            ("NonfinancialUnlisted", "2029-12-31", "2030-01-01")]:
            with self.subTest(profile=profile):
                select_package("Enterprise", before, profile, eligibility_confirmed=True)
                with self.assertRaisesRegex(RuleError, "CAS30-2026"):
                    select_package("Enterprise", required, profile, eligibility_confirmed=True)
                with self.assertRaisesRegex(RuleError, "CAS30-2026"):
                    select_package("Enterprise", "2026-10-25", profile, eligibility_confirmed=True, early_adopt_cas30=True)

    def test_draft_or_future_manifest_cannot_be_promoted(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "rules";shutil.copytree(ROOT, root)
            catalog = read_json(root / "catalog.json")
            catalog["entries"][0]["status"] = "Draft"
            (root / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaisesRegex(RuleError, "Draft/future"):
                load_bundle(root)

    def test_exact_decimal_cash_and_contra_asset_sign(self):
        p = self.packages["SmallBusiness"]
        self.assertEqual(Decimal("0.30"), evaluate_sample_row(p, "sb-bs", "cash", [fact("1001", "0.10"), fact("1002", "0.20"), fact("1012", "0.00")]))
        self.assertEqual(Decimal("800.00"), evaluate_sample_row(p, "sb-bs", "fixed-net", [fact("1601", "1000.00"), fact("1602", "-200.00")]))

    def test_money_does_not_inherit_callers_low_precision_or_exponent_limits(self):
        p = self.packages["SmallBusiness"]
        with localcontext() as ctx:
            ctx.prec = 6;ctx.Emax = 2
            amount = evaluate_sample_row(p, "sb-bs", "cash", [fact("1001", "0.00"), fact("1002", "12345.67"), fact("1012", "0.00")])
        self.assertEqual(Decimal("12345.67"), amount)

    def test_result_overflow_is_rejected_after_exact_sum(self):
        p = self.packages["SmallBusiness"]
        with self.assertRaisesRegex(RuleError, "Report result exceeds"):
            evaluate_sample_row(p, "sb-bs", "cash", [fact("1001", "92233720368547758.00"), fact("1002", "1.00"), fact("1012", "0.00")])

    def test_report_period_column_variants_match_official_instructions(self):
        p = self.packages["SmallBusiness"]
        for r in p["reports"]:
            if r["id"] in {"sb-income", "sb-cashflow"}:
                variants = {v["period"]: v for v in r["columnVariants"]}
                self.assertEqual(["本年累计金额", "本月金额"], variants["Monthly"]["columns"])
                self.assertEqual(["本年累计金额", "上年金额"], variants["Annual"]["columns"])
        activity = next(r for r in self.packages["Nonprofit"]["reports"] if r["id"] == "np-activity")
        variants = {v["period"]: v for v in activity["columnVariants"]}
        self.assertTrue(variants["Quarterly"]["columns"][0].startswith("本季度数"))
        self.assertTrue(variants["HalfYearly"]["columns"][0].startswith("本半年度数"))
        self.assertEqual("UnimplementedPresentation", variants["Annual"]["status"])
        self.assertEqual([], variants["Annual"]["columns"])

    def test_contract_hand_calculated_bank_sample(self):
        # Independently specified contract: 100000-10000-1200+20000 = 108800.
        p = self.packages["SmallBusiness"]
        result = evaluate_sample_row(p, "sb-bs", "cash", [fact("1001", "0.00"), fact("1002", "108800.00"), fact("1012", "0.00")])
        self.assertEqual(Decimal("108800.00"), result)
        self.assertEqual(Decimal("20000.00"), evaluate_sample_row(p, "sb-income", "revenue", [fact("5001", "-20000.00", "period_net_debit"), fact("5051", "0.00", "period_net_debit")]))

    def test_report_missing_duplicate_invalid_precision_and_float_fail(self):
        p = self.packages["SmallBusiness"]
        with self.assertRaisesRegex(RuleError, "Missing report fact"):
            evaluate_sample_row(p, "sb-bs", "cash", [])
        for value in [0.1, "0.001", "NaN", "Infinity", "1e999999", "92233720368547758.08", " 1.00", "+1"]:
            with self.subTest(value=value):
                with self.assertRaises(RuleError):
                    evaluate_sample_row(p, "sb-bs", "fixed-net", [fact("1601", value), fact("1602", "0.00")])
        with self.assertRaisesRegex(RuleError, "Duplicate fact"):
            evaluate_sample_row(p, "sb-bs", "cash", [fact("1001", "0.00"), fact("1001", "1.00")])
        with self.assertRaisesRegex(RuleError, "not implemented"):
            evaluate_sample_row(p, "sb-cashflow", "cash-total", [])

    def test_nonprofit_both_income_and_expense_restriction_columns(self):
        p = self.packages["Nonprofit"]
        for dim, amount in [("Restricted", "200.00"), ("Unrestricted", "100.00")]:
            with self.subTest(dim=dim):
                self.assertEqual(Decimal(amount), evaluate_sample_row(p, "np-activity", "admin", [fact("5301", amount, "period_net_debit", dim)], restriction=dim))
                self.assertEqual(Decimal(amount), evaluate_sample_row(p, "np-activity", "donation", [fact("4101", "-" + amount, "period_net_debit", dim)], restriction=dim))
        with self.assertRaisesRegex(RuleError, "restriction"):
            evaluate_sample_row(p, "np-activity", "admin", [fact("5301", "100.00", "period_net_debit")], restriction="Restricted")

    def test_nonprofit_closing_routes_and_internal_budget_do_not_qualify(self):
        p = self.packages["Nonprofit"]
        for code in ["4101", "5301", "5101"]:
            self.assertEqual("3101", nonprofit_closing_route(p, code, "Unrestricted"))
            self.assertEqual("3102", nonprofit_closing_route(p, code, "Restricted", evidence_kind="ExternalProvider"))
            with self.assertRaisesRegex(RuleError, "evidence"):
                nonprofit_closing_route(p, code, "Restricted", evidence_kind="InternalBudget")
        with self.assertRaisesRegex(RuleError, "Manual accountant"):
            nonprofit_closing_route(p, "5601", "Restricted", evidence_kind="LawOrAdministrativeRegulation")
        self.assertFalse(p["restrictionRules"]["restrictedSpendingAutomaticallyReclassifiesNetAssets"])

    def test_missing_nonprofit_expense_classification_rejected(self):
        p = deepcopy(self.packages["Nonprofit"])
        next(a for a in p["accounts"] if a["code"] == "5101")["restrictionPolicy"] = "NotApplicable"
        self.check_invalid(p, "classification")

    def test_first_year_comparative_exception_is_explicitly_2026(self):
        p = self.packages["Nonprofit"]
        self.assertEqual(2026, p["firstAdoptionComparatives"]["year"])
        self.assertFalse(p["firstAdoptionComparatives"]["activityAndCashflowPriorYearRequired"])
        self.assertIn("never silently zero", p["firstAdoptionComparatives"]["missingValueMeaning"])

    def test_migration_semantics_and_all_same_code_conflicts(self):
        m = self.migration
        version = m["fromRegimeVersion"]
        cases = [("1701", "受托代理资产", "1801", "100.00"), ("2401", "预计负债", "2503", "-10.00"),
                 ("5201", "管理费用", "5301", "0.00"), ("5301", "筹资费用", "5401", "0.00"), ("5401", "其他费用", "5901", "0.00")]
        for code, name, target, balance in cases:
            with self.subTest(code=code):
                result = migration_candidate(m, from_version=version, code=code, name=name, balance=balance)
                self.assertEqual(target, result["toCode"])
                self.assertFalse(result["isExecutable"])
                self.assertFalse(result["completeMigrationValidated"])
        with self.assertRaisesRegex(RuleError, "semantic"):
            migration_candidate(m, from_version=version, code="1701", name="长期待摊费用", balance="100.00")
        with self.assertRaisesRegex(RuleError, "version"):
            migration_candidate(m, from_version="other", code="1701", name="受托代理资产", balance="100.00")

    def test_nonzero_old_expense_and_manual_classification_blocked(self):
        m = self.migration;version = m["fromRegimeVersion"]
        for code, name in [("5201", "管理费用"), ("5301", "筹资费用"), ("5401", "其他费用")]:
            with self.assertRaisesRegex(RuleError, "must be zero"):
                migration_candidate(m, from_version=version, code=code, name=name, balance="10.00")
        with self.assertRaisesRegex(RuleError, "classification"):
            migration_candidate(m, from_version=version, code="1506", name="文物文化资产", balance="50.00")
        with self.assertRaisesRegex(RuleError, "semantic"):
            migration_candidate(m, from_version=version, code="9999", name="自设旧科目", balance="0.00")

    def test_wrong_target_code_name_or_balance_transfer_rejected(self):
        for change in [{"toCode": "1701"}, {"toName": "任意改名"}]:
            m = deepcopy(self.migration);m["mappings"][0].update(change)
            with self.assertRaisesRegex(RuleError, "meaning mismatch"):
                validate_migration(m, self.packages["Nonprofit"], self.sources)
        m = deepcopy(self.migration);m["mappings"][4]["action"] = "BalanceCandidate"
        with self.assertRaisesRegex(RuleError, "Cannot carry"):
            validate_migration(m, self.packages["Nonprofit"], self.sources)
        m = deepcopy(self.migration);m["completeMigrationValidated"] = True
        with self.assertRaisesRegex(RuleError, "schema"):
            validate_migration(m, self.packages["Nonprofit"], self.sources)


if __name__ == "__main__":
    unittest.main()
