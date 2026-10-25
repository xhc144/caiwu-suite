from copy import deepcopy
from decimal import localcontext
import unittest

from rules.enterprise_evidence import (
    load_enterprise_evidence, require_verified_enterprise_posting_chart,
    validate_enterprise_evidence,
)
from rules.nonprofit_scenarios import ScenarioError, evaluate_case, validate_scenario_pack
from rules.runtime import ROOT, RuleError, load_bundle, read_json


class RulesV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, packages, _ = load_bundle()
        cls.np = next(p for p in packages.values() if p["regime"] == "Nonprofit")
        cls.enterprise = next(p for p in packages.values() if p["regime"] == "Enterprise")
        cls.sources = {s["id"]: s for s in read_json(ROOT / "sources.json")["sources"]}
        cls.pack = read_json(ROOT / "scenarios/nonprofit-v2.json")
        cls.cases = {c["id"]: c for c in cls.pack["cases"]}

    def test_all_hand_expected_positive_and_rejection_examples(self):
        result = validate_scenario_pack(self.pack, self.np, self.sources)
        self.assertEqual({"cases": 27, "acceptedExamples": 6, "rejectionExamples": 21, "productionCertified": False}, result)
        for case in self.cases.values():
            with self.subTest(case=case["id"]):
                if case["expected"]["errorCode"] is None:
                    self.assertEqual(case["expected"]["result"], evaluate_case(case, self.np))
                else:
                    with self.assertRaises(ScenarioError) as caught:
                        evaluate_case(case, self.np)
                    self.assertEqual(case["expected"]["errorCode"], caught.exception.code)

    def test_equal_amount_donations_affect_different_net_asset_classes(self):
        restricted = evaluate_case(self.cases["gift-restricted"], self.np)["metrics"]
        unrestricted = evaluate_case(self.cases["gift-unrestricted"], self.np)["metrics"]
        self.assertEqual("800.00", restricted["assets"])
        self.assertEqual("800.00", unrestricted["assets"])
        self.assertEqual(("800.00", "0.00"), (restricted["restrictedNetAssets"], restricted["unrestrictedNetAssets"]))
        self.assertEqual(("0.00", "800.00"), (unrestricted["restrictedNetAssets"], unrestricted["unrestrictedNetAssets"]))
        self.assertEqual("0.00", restricted["releasedToUnrestricted"])

    def test_shared_expense_independent_arithmetic_and_two_dimensional_totals(self):
        out = evaluate_case(self.cases["shared-cost-dual-net-assets"], self.np)
        self.assertEqual({"slice-r": "600.00", "slice-u": "400.00"}, out["allocations"]["common-cost"])
        m = out["metrics"]
        # Independent hand calculation: R=1200+3000-600; U=800+2000-400.
        self.assertEqual("3600.00", m["restrictedNetAssets"])
        self.assertEqual("2400.00", m["unrestrictedNetAssets"])
        self.assertEqual("6000.00", m["totalNetAssets"])
        self.assertEqual("6000.00", m["assets"])
        self.assertEqual("4000.00", m["cashChange"])
        self.assertTrue(out["incomeExpenseClosingZero"])

    def test_closing_cannot_change_class_or_individual_grant(self):
        for id in ["reject-closing-class-flip", "reject-closing-grant-swap"]:
            with self.subTest(id=id):
                with self.assertRaises(ScenarioError) as caught:evaluate_case(self.cases[id], self.np)
                self.assertEqual("NP_CLOSE_CLASS_BALANCE", caught.exception.code)

    def test_release_does_not_manufacture_income_or_cash_and_other_grant_survives(self):
        out = evaluate_case(self.cases["full-release-only-reclassifies"], self.np)["metrics"]
        self.assertEqual(("300.00", "700.00", "1000.00"), (out["unrestrictedNetAssets"], out["restrictedNetAssets"], out["totalNetAssets"]))
        self.assertEqual("0.00", out["incomeRestricted"])
        self.assertEqual("0.00", out["incomeUnrestricted"])
        self.assertEqual("0.00", out["cashChange"])
        self.assertEqual(("300.00", "-300.00"), (out["releasedToUnrestricted"], out["releasedFromRestricted"]))

    def test_no_net_asset_reclassification_bypass_via_activity_or_opening(self):
        for id, code in [("reject-hidden-activity-release", "NP_NET_ASSET_OPERATION"), ("reject-opening-disguise", "NP_OPENING_ORDER")]:
            with self.subTest(id=id):
                with self.assertRaises(ScenarioError) as caught:evaluate_case(self.cases[id], self.np)
                self.assertEqual(code, caught.exception.code)

    def test_release_evidence_scope_and_repeated_amounts_are_enforced(self):
        for id in ["reject-release-wrong-grant", "reject-release-internal-budget", "reject-release-empty-conditions", "reject-release-exceeds-grant", "reject-double-release", "reject-unspecified-partial-release", "reject-time-only-release"]:
            with self.subTest(id=id):
                with self.assertRaises(ScenarioError):evaluate_case(self.cases[id], self.np)

    def test_service_donation_has_gross_activity_and_zero_cash(self):
        out = evaluate_case(self.cases["reliable-service-donation-noncash"], self.np)["metrics"]
        self.assertEqual("1000.00", out["incomeUnrestricted"])
        self.assertEqual("1000.00", out["expenseUnrestricted"])
        self.assertEqual("0.00", out["cashChange"])
        self.assertEqual("0.00", out["totalNetAssets"])

    def test_cent_allocation_is_conserved_and_independent_of_input_row_order(self):
        case = deepcopy(self.cases["allocation-cent-conservation"])
        case["allocations"][0]["rows"].reverse()
        out = evaluate_case(case, self.np)
        self.assertEqual({"a": "0.34", "b": "0.34", "c": "0.33"}, out["allocations"]["rounding-101"])

    def test_synthetic_arithmetic_ignores_low_decimal_context(self):
        with localcontext() as context:
            context.prec = 3;context.Emax = 2
            out = evaluate_case(self.cases["shared-cost-dual-net-assets"], self.np)
        self.assertEqual("6000.00", out["metrics"]["assets"])

    def test_fixture_expected_amounts_are_checked_not_generated(self):
        data = deepcopy(self.pack)
        data["cases"][0]["expected"]["result"]["metrics"]["restrictedNetAssets"] = "799.99"
        with self.assertRaisesRegex(ScenarioError, "NP_ORACLE_MISMATCH"):
            validate_scenario_pack(data, self.np, self.sources)

    def test_external_evidence_cannot_be_blank(self):
        for value in ["", "   "]:
            with self.subTest(value=value):
                case = deepcopy(self.cases["gift-restricted"])
                case["restrictions"][0]["evidenceId"] = value
                with self.assertRaisesRegex(ScenarioError, "NP_RESTRICTION_EVIDENCE"):
                    evaluate_case(case, self.np)

    def test_closing_cannot_silently_ignore_release_assessment(self):
        case = deepcopy(self.cases["gift-restricted"])
        case["vouchers"][2]["releaseAssessment"] = deepcopy(self.cases["full-release-only-reclassifies"]["vouchers"][1]["releaseAssessment"])
        with self.assertRaisesRegex(ScenarioError, "NP_RELEASE_SHAPE"):
            evaluate_case(case, self.np)

    def test_expense_line_cannot_be_allocated_twice_with_new_allocation_id(self):
        case = deepcopy(self.cases["shared-cost-dual-net-assets"])
        duplicate = deepcopy(case["allocations"][0]);duplicate["id"] = "same-cost-again"
        case["allocations"].append(duplicate)
        with self.assertRaisesRegex(ScenarioError, "NP_ALLOCATION_REPEATED_LINE"):
            evaluate_case(case, self.np)

    def test_fixture_schema_and_source_binding_rejected_if_corrupt(self):
        for change in ["float", "draft", "certification", "old-period"]:
            with self.subTest(change=change):
                data = deepcopy(self.pack)
                if change == "float":data["cases"][0]["vouchers"][0]["lines"][0]["debit"] = 1000.0
                if change == "draft":data["cases"][0]["sourceRefs"][0]["sourceId"] = "enterprise-chart-draft"
                if change == "certification":data["isProductionCertified"] = True
                if change == "old-period":data["cases"][0]["vouchers"][0]["date"] = "2025-12-31"
                with self.assertRaises(RuleError):validate_scenario_pack(data, self.np, self.sources)

    def test_enterprise_evidence_is_25_names_and_zero_numeric_codes(self):
        data = load_enterprise_evidence()
        self.assertEqual(25, data["officialNameCount"])
        self.assertEqual(0, data["verifiedNumericCodeCount"])
        self.assertTrue(all(n["accountCode"] is None and n["normalDirection"] is None for n in data["namedAccounts"]))
        names = {n["name"] for n in data["namedAccounts"]}
        self.assertTrue({"合同资产", "合同负债", "使用权资产", "租赁负债", "债权投资", "信用减值损失"} <= names)
        self.assertFalse(data["historicalBase"]["original2006ChartRetrieved"])

    def test_familiar_number_or_direction_cannot_be_promoted_from_name_only_evidence(self):
        for field, value in [("accountCode", "1122"), ("normalDirection", "Debit")]:
            with self.subTest(field=field):
                data = load_enterprise_evidence();data["namedAccounts"][0][field] = value
                with self.assertRaisesRegex(RuleError, "schema"):
                    validate_enterprise_evidence(data, self.sources, self.enterprise)
        with self.assertRaisesRegex(RuleError, "numeric posting chart unavailable"):
            require_verified_enterprise_posting_chart()

    def test_formal_update_adoption_dates_and_denial_are_preserved(self):
        data = load_enterprise_evidence()
        updates = {u["id"]: u for u in data["formalUpdates"]}
        self.assertEqual("2018-01-01", updates["revenue-2017"]["adoptedByProfile"]["DualListedOrSpecifiedOverseas"])
        self.assertEqual("2019-01-01", updates["lease-2018"]["adoptedByProfile"]["DualListedOrSpecifiedOverseas"])
        self.assertEqual("2021-01-01", updates["lease-2018"]["adoptedByProfile"]["NonfinancialUnlisted"])
        denial = next(a for a in data["retrievalAttempts"] if a["id"] == "2006-guide-rar")
        self.assertIn("HTTP403", denial["outcome"])
        self.assertFalse(denial["downloaded"])
        self.assertFalse(denial["retryPermitted"])
        self.assertFalse(any(s["url"].endswith("t20170406_2570050.htm") for s in self.sources.values()))


if __name__ == "__main__":
    unittest.main()
