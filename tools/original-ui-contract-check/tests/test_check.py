"""Synthetic regression tests: no GUI, binary, credentials or original installer."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))
import check  # noqa: E402

REPO = TOOL.parents[1]
FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name):
    return check.load_json(FIXTURES / name)


def run(data, case="login.startup", product="qingsong/main"):
    return check.evaluate(REPO, data, (product,), (case,))


class ContractCheckTests(unittest.TestCase):
    def test_absent_observations_are_not_tested(self):
        report = run({"schema_version": 1, "windows": []})
        self.assertEqual(report["comparison"], "incomplete")
        self.assertEqual(report["counts"]["matched"], 0)
        self.assertEqual(report["counts"]["mismatch"], 0)
        self.assertGreater(report["counts"]["not-tested"], 0)
        self.assertEqual(report["runtime_acceptance"], "not-tested")
        self.assertEqual(report["exit_code"], 3)

    def test_synthetic_match_never_becomes_runtime_acceptance(self):
        report = run(fixture("login-relative-match.synthetic.json"))
        self.assertEqual(report["comparison"], "matched")
        self.assertEqual(report["counts"]["mismatch"], 0)
        self.assertEqual(report["counts"]["not-tested"], 0)
        self.assertGreater(report["counts"]["unknown"], 0)
        self.assertEqual(report["runtime_acceptance"], "not-tested")
        self.assertEqual(report["exit_code"], 3)

    def test_preview_split_login_decision_is_detected(self):
        report = run(fixture("regression-split-login.synthetic.json"))
        failures = {x["id"] for x in report["mismatches"]}
        self.assertIn("control.ddlb_1.presence", failures)
        self.assertIn("control.em_1.presence", failures)
        self.assertIn("control.cb_ok.text", failures)
        self.assertEqual(report["exit_code"], 1)
        self.assertEqual(report["runtime_acceptance"], "not-tested")

    def test_original_book_button_vertical_order_is_enforced(self):
        report = run(fixture("regression-book-button-order.synthetic.json"), "book.manage")
        positions = [x for x in report["mismatches"] if x["kind"] == "position"]
        self.assertEqual([x["id"] for x in positions], ["position.above.cb_4.cb_5"])
        self.assertEqual(report["exit_code"], 1)

    def test_preview_save_close_key_and_header_decisions_are_detected(self):
        report = run(fixture("regression-editor-save-close.synthetic.json"), "editor.standard")
        failures = {x["id"]: x for x in report["mismatches"]}
        self.assertIn("menu.m_operation/m_operation_save.shortcut", failures)
        self.assertEqual(failures["menu.m_operation/m_operation_save.shortcut"]["expected"], "F5")
        self.assertIn("menu.m_operation/m_operation_save.text", failures)
        self.assertIn("position.above.em_pzrq.ddlb_pzlx", failures)
        self.assertIn("entry.original-runtime-caller", {x["id"] for x in report["unknowns"]})

    def test_wrong_entry_cannot_satisfy_same_object(self):
        data = fixture("login-relative-match.synthetic.json")
        data["windows"][0]["entry"] = "event:some-other-caller"
        report = run(data)
        self.assertEqual(report["cases"][0]["checks"][0]["status"], "not-tested")
        self.assertTrue(any("unregistered" in x.get("reason", "") for x in report["mismatches"]))

    def test_another_registered_entry_still_cannot_satisfy_startup(self):
        data = fixture("login-relative-match.synthetic.json")
        data["windows"][0]["entry"] = "menu:m_frame_zw/m_system/m_system_trans"
        report = run(data)
        self.assertEqual(report["counts"]["matched"], 0)
        self.assertEqual(len(report["out_of_scope_observations"]), 1)
        self.assertEqual(report["comparison"], "incomplete")

    def test_product_identity_is_not_silently_reused(self):
        report = run(fixture("login-relative-match.synthetic.json"), product="minfeiqi/main")
        self.assertEqual(report["counts"]["matched"], 0)
        self.assertEqual(report["comparison"], "incomplete")

    def test_partial_enumeration_does_not_prove_a_control_is_absent(self):
        data = fixture("regression-split-login.synthetic.json")
        data["windows"][0]["coverage"]["controls"] = "partial"
        report = run(data)
        self.assertIn("control.ddlb_1.presence", {x["id"] for x in report["not_tested"]})
        self.assertNotIn("control.ddlb_1.presence", {x["id"] for x in report["mismatches"]})

    def test_unsupplied_text_is_not_an_automatic_match(self):
        data = fixture("login-relative-match.synthetic.json")
        del next(c for c in data["windows"][0]["controls"] if c["id"] == "cb_ok")["text"]
        report = run(data)
        self.assertIn("control.cb_ok.text", {x["id"] for x in report["not_tested"]})
        self.assertEqual(report["comparison"], "incomplete")

    def test_relative_positions_do_not_require_a_pbu_pixel_multiplier(self):
        data = fixture("login-relative-match.synthetic.json")
        for c in data["windows"][0]["controls"]:
            b = c["bounds"]
            b["x"] = b["x"] * 13 + 1234
            b["width"] *= 13
            b["y"] = b["y"] * 7 - 1000
            b["height"] *= 7
        report = run(data)
        self.assertEqual(report["comparison"], "matched")

    def test_different_coordinate_spaces_are_not_compared(self):
        data = fixture("login-relative-match.synthetic.json")
        data["windows"][0]["controls"][0]["bounds"]["space"] = "another-window"
        report = run(data)
        self.assertTrue(any("different spaces" in x.get("reason", "") for x in report["not_tested"]))
        self.assertEqual(report["counts"]["mismatch"], 0)

    def test_visibility_is_unknown_instead_of_inferred_from_design_default(self):
        data = fixture("login-relative-match.synthetic.json")
        data["windows"][0]["controls"][0]["visible"] = False
        report = run(data)
        self.assertIn("control.ddlb_1.visibility", {x["id"] for x in report["unknowns"]})
        self.assertTrue(any(x["kind"] == "position" for x in report["not_tested"]))

    def test_schema_column_array_does_not_become_visual_order(self):
        data = fixture("regression-book-button-order.synthetic.json")
        data["windows"][0]["tables"] = [{"control": "dw_1", "columns": ["dm", "tz_name", "sm"]}]
        first = run(data, "book.manage")
        data["windows"][0]["tables"][0]["columns"].reverse()
        second = run(data, "book.manage")
        for report in (first, second):
            self.assertIn("columns.dw_1.order", {x["id"] for x in report["unknowns"]})
            self.assertFalse(any(x["kind"] == "column-order" for x in report["mismatches"]))

    def test_declared_uia_provenance_is_not_authenticated_runtime_acceptance(self):
        data = fixture("login-relative-match.synthetic.json")
        data["provenance"] = {"kind": "uia", "description": "Self-declaration in a synthetic test"}
        for c in data["windows"][0]["controls"]:
            c["bounds"]["unit"] = "pixels"
        report = run(data)
        self.assertEqual(report["comparison"], "matched")
        self.assertEqual(report["runtime_acceptance"], "not-established")
        self.assertEqual(report["exit_code"], 3)

    def test_claimed_uia_cannot_use_abstract_coordinates(self):
        data = fixture("login-relative-match.synthetic.json")
        data["provenance"]["kind"] = "uia"
        with self.assertRaises(check.InputError):
            run(data)

    def test_observed_menu_relative_order_is_compared_independently(self):
        data = fixture("regression-editor-save-close.synthetic.json")
        data["windows"][0]["menus"][0]["children"] = [
            {"id":"m_operation_add", "text":"插入一行 Ctrl+I", "shortcut":"Control+I"},
            {"id":"m_operation_save", "text":"存盘 F5", "shortcut":"F5"},
        ]
        report = run(data, "editor.standard")
        self.assertIn("menu.m_operation.order", {x["id"] for x in report["mismatches"]})
        self.assertNotIn("menu.m_operation/m_operation_add.shortcut", {x["id"] for x in report["mismatches"]})

    def test_duplicate_window_identity_is_rejected(self):
        data = fixture("login-relative-match.synthetic.json")
        data["windows"].append(copy.deepcopy(data["windows"][0]))
        with self.assertRaises(check.InputError):
            run(data)

    def test_same_f4_key_does_not_make_the_wrong_editor_action_match(self):
        data = fixture("regression-editor-save-close.synthetic.json")
        data["windows"][0]["menus"][0]["children"] = [
            {"id":"m_operation_find", "text":"凭证审核 F4", "shortcut":"F4"}
        ]
        report = run(data, "editor.standard")
        self.assertIn("menu.m_operation/m_operation_find.text", {x["id"] for x in report["mismatches"]})
        self.assertNotIn("menu.m_operation/m_operation_find.shortcut", {x["id"] for x in report["mismatches"]})

    def test_baseline_relation_drift_is_an_error_not_a_false_match(self):
        baseline = {key: check.load_json(REPO / "docs/original-analysis/json" / f"{key}.json")
                    for key in ("windows", "menus", "datawindows")}
        controls = baseline["windows"]["qingsong/main"]["w_login"]["controls"]
        next(c for c in controls if c["name"] == "cb_new")["props"]["x"] = "99999"
        with self.assertRaisesRegex(check.InputError, "baseline drift"):
            check.compare_window("qingsong/main", check.CASES[0], None, **baseline)

    def test_source_table_visibility_is_never_runtime_evidence(self):
        data = fixture("regression-editor-save-close.synthetic.json")
        data["windows"][0]["menus"][0]["children"] = [
            {"id":"m_operation_cn", "text":"读出纳", "visible": True}
        ]
        report = run(data, "editor.standard")
        check_item = next(x for x in report["unknowns"]
                          if x["id"] == "menu.m_operation/m_operation_cn.visibility")
        self.assertEqual(check_item["expected"]["design_visible"], False)
        self.assertIs(check_item["observed"], True)

    def test_boolean_schema_version_is_not_accepted_as_integer_one(self):
        with self.assertRaises(check.InputError):
            run({"schema_version":True, "windows":[]})

    def test_duplicate_control_identity_is_rejected(self):
        data = fixture("login-relative-match.synthetic.json")
        data["windows"][0]["controls"].append(copy.deepcopy(data["windows"][0]["controls"][0]))
        with self.assertRaises(check.InputError):
            run(data)

    def assert_duplicate_observation_rejected(self, original, replacement, key):
        raw = (FIXTURES / "login-relative-match.synthetic.json").read_text()
        self.assertIn(original, raw)
        raw = raw.replace(original, replacement, 1)
        with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()) as err:
            path = Path(directory) / "duplicate.json"
            output = Path(directory) / "report.json"
            path.write_text(raw, encoding="utf-8")
            with self.assertRaisesRegex(check.InputError, "Duplicate JSON key"):
                check.load_json(path)
            code = check.main(["--repo", str(REPO), "--product", "qingsong/main",
                               "--case", "login.startup", "--observations", str(path),
                               "--output", str(output)])
            self.assertEqual(code, 2)
            self.assertIn("input-error", err.getvalue())
            self.assertIn(f"Duplicate JSON key: {key!r}", err.getvalue())
            self.assertFalse(output.exists())

    def test_duplicate_id_key_cannot_hide_a_wrong_id(self):
        self.assert_duplicate_observation_rejected(
            '"id":"cb_ok"', '"id":"wrong_id","id":"cb_ok"', "id")

    def test_duplicate_text_key_cannot_hide_a_wrong_caption(self):
        self.assert_duplicate_observation_rejected(
            '"text":"Y. 确认"', '"text":"保存并关闭","text":"Y. 确认"', "text")

    def test_duplicate_entry_key_cannot_hide_a_wrong_entry(self):
        self.assert_duplicate_observation_rejected(
            '"entry": "event:w_frame.open"',
            '"entry":"event:wrong-caller","entry":"event:w_frame.open"', "entry")

    def test_same_value_and_escaped_duplicate_keys_are_also_rejected(self):
        self.assert_duplicate_observation_rejected(
            '"id":"cb_ok"', r'"id":"cb_ok","\u0069d":"cb_ok"', "id")

    def test_duplicate_baseline_keys_are_rejected_at_root_and_nested_depth(self):
        for raw, key in (
            ('{"qingsong/main":{},"qingsong/main":{}}', "qingsong/main"),
            ('{"qingsong/main":{"w_login":{"props":{"text":"wrong","text":"correct"}}}}', "text"),
        ):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()) as err:
                repo = Path(directory)
                baseline = repo / "docs/original-analysis/json"
                baseline.mkdir(parents=True)
                (baseline / "windows.json").write_text(raw, encoding="utf-8")
                output = repo / "report.json"
                code = check.main(["--repo", str(repo), "--product", "qingsong/main",
                                   "--case", "login.startup", "--output", str(output)])
                self.assertEqual(code, 2)
                self.assertIn(f"Duplicate JSON key: {key!r}", err.getvalue())
                self.assertFalse(output.exists())

    def test_invalid_coordinate_numbers_are_rejected(self):
        for invalid in (float("nan"), float("inf"), True):
            with self.subTest(value=invalid):
                data = fixture("login-relative-match.synthetic.json")
                data["windows"][0]["controls"][0]["bounds"]["x"] = invalid
                with self.assertRaises(check.InputError):
                    run(data)

    def test_cli_400_digit_coordinate_returns_input_error_without_traceback(self):
        data = fixture("login-relative-match.synthetic.json")
        data["windows"][0]["controls"][0]["bounds"]["x"] = 10 ** 399
        with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()) as err, redirect_stdout(io.StringIO()) as out:
            path = Path(directory) / "large-coordinate.json"
            output = Path(directory) / "report.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            code = check.main(["--repo", str(REPO), "--product", "qingsong/main",
                               "--case", "login.startup", "--observations", str(path),
                               "--output", str(output)])
            self.assertEqual(code, 2)
            self.assertIn("input-error: invalid finite bounds", err.getvalue())
            self.assertNotIn("Traceback", err.getvalue())
            self.assertEqual(out.getvalue(), "")
            self.assertFalse(output.exists())

    def test_cli_10000_json_levels_return_input_error_without_traceback(self):
        raw = '{"schema_version":1,"windows":' + "[" * 10000 + "0" + "]" * 10000 + "}"
        with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()) as err, redirect_stdout(io.StringIO()) as out:
            path = Path(directory) / "deep.json"
            output = Path(directory) / "report.json"
            path.write_text(raw, encoding="utf-8")
            code = check.main(["--observations", str(path), "--output", str(output)])
            self.assertEqual(code, 2)
            self.assertIn("input-error: JSON nesting too deep", err.getvalue())
            self.assertNotIn("Traceback", err.getvalue())
            self.assertEqual(out.getvalue(), "")
            self.assertFalse(output.exists())

    def test_all_profiles_resolve_in_three_existing_source_products(self):
        report = check.evaluate(REPO, {"schema_version":1, "windows":[]})
        self.assertEqual(len(report["cases"]), 39)
        self.assertEqual(report["counts"]["matched"], 0)
        self.assertEqual(report["counts"]["mismatch"], 0)

    def test_cli_without_capture_has_non_success_exit_code_and_report(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            path = Path(directory) / "report.json"
            code = check.main(["--repo", str(REPO), "--product", "qingsong/main",
                               "--case", "login.startup", "--output", str(path)])
            self.assertEqual(code, 3)
            self.assertEqual(json.loads(path.read_text())["runtime_acceptance"], "not-tested")

    def test_cli_malformed_observation_is_input_error(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()) as err:
            path = Path(directory) / "bad.json"
            path.write_text('{"schema_version":1,"windows":NaN}')
            self.assertEqual(check.main(["--observations", str(path)]), 2)
            self.assertIn("input-error", err.getvalue())


if __name__ == "__main__":
    unittest.main()
