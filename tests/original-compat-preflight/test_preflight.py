"""Fictional byte fixtures only; no original executable or ledger is read."""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[2] / "tools/original-compat-preflight/preflight.py"
SPEC = importlib.util.spec_from_file_location("original_compat_preflight", MODULE_PATH)
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)


def fictional_pe(file_version=(8, 2, 3, 4), product_version=(8, 9, 10, 11)):
    """Minimal PE32 resource tree with a numeric version, not an executable."""
    data = bytearray(0x600)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 60, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<HH", data, 0x84, 0x14c, 1)
    struct.pack_into("<H", data, 0x94, 224)
    optional = 0x98
    struct.pack_into("<H", data, optional, 0x10b)
    struct.pack_into("<I", data, optional + 92, 16)
    struct.pack_into("<II", data, optional + 112, 0x1000, 0x400)
    section = optional + 224
    data[section:section + 8] = b".rsrc\0\0\0"
    struct.pack_into("<IIII", data, section + 8, 0x400, 0x1000, 0x400, 0x200)
    resource = 0x200
    struct.pack_into("<HH", data, resource + 12, 0, 1)
    struct.pack_into("<II", data, resource + 16, 16, 0x80000020)
    struct.pack_into("<HH", data, resource + 0x20 + 12, 0, 1)
    struct.pack_into("<II", data, resource + 0x20 + 16, 1, 0x80000040)
    struct.pack_into("<HH", data, resource + 0x40 + 12, 0, 1)
    struct.pack_into("<II", data, resource + 0x40 + 16, 1033, 0x60)
    blob = bytearray(92)
    struct.pack_into("<HHH", blob, 0, len(blob), 52, 0)
    blob[6:38] = "VS_VERSION_INFO\0".encode("utf-16le")
    def halves(version):
        return (version[0] << 16 | version[1], version[2] << 16 | version[3])
    struct.pack_into("<13I", blob, 40, 0xFEEF04BD, 0x10000,
                     *halves(file_version), *halves(product_version), *([0] * 7))
    struct.pack_into("<IIII", data, resource + 0x60, 0x1100, len(blob), 0, 0)
    data[resource + 0x100:resource + 0x100 + len(blob)] = blob
    return bytes(data)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, name, data=b"fictional-data"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def report(self, *paths, **kwargs):
        return preflight.collect(paths, **kwargs)

    def cli(self, args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = preflight.main(args)
        return status, out.getvalue(), err.getvalue()

    def test_hash_size_and_no_database_version_claim(self):
        content = b"fictional database bytes\x00\xff"
        path = self.write("sample.db", content)
        before = path.stat()
        report = self.report(path)
        item = report["files"][0]
        self.assertEqual("complete", report["inventory_status"])
        self.assertEqual(len(content), item["bytes"])
        self.assertEqual(hashlib.sha256(content).hexdigest(), item["sha256"])
        self.assertEqual("not_assessed", report["compatibility_status"])
        self.assertEqual("not_assessed", report["original_ledger_usability"])
        self.assertIsNone(item["hints"]["database_file_format_version"])
        self.assertIsNone(item["hints"]["database_engine_version"])
        self.assertEqual(before.st_mtime_ns, path.stat().st_mtime_ns)
        self.assertEqual(before.st_mode, path.stat().st_mode)
        self.assertEqual(content, path.read_bytes())

    def test_config_secrets_and_absolute_paths_are_not_collected(self):
        secret = "fake-credential-do-not-collect-123"
        contents = f"[db]\npassword={secret}\nConnectString=UID=test;PWD={secret};DBF=hidden.db\n".encode()
        path = self.write("Rhzw8.ini", contents)
        report = self.report(path)
        serialized = json.dumps(report)
        self.assertNotIn(secret, serialized)
        self.assertNotIn("ConnectString", serialized)
        self.assertNotIn("hidden.db", serialized)
        self.assertNotIn(str(self.root), serialized)
        self.assertFalse(report["scope"]["configuration_values_collected"])
        self.assertEqual(hashlib.sha256(contents).hexdigest(), report["files"][0]["sha256"])

    def test_paths_require_explicit_opt_in(self):
        path = self.write("input.db")
        report = self.report(path, include_paths=True)
        self.assertEqual(str(path), report["files"][0]["selected_path"])

    def test_no_implicit_directory_scan_or_config_path_follow(self):
        database = self.write("sample.db")
        self.write("sample.log", b"not-selected")
        config = self.write("Rhzw8.ini", b"DBF=other.db\nPWD=fake\n")
        self.write("other.db", b"not-selected-either")
        report = self.report(database, config)
        self.assertEqual(["sample.db", "Rhzw8.ini"], [f["name"] for f in report["files"]])
        self.assertIn("log_association_not_declared", report["database_coverage"][0]["gaps"])
        self.assertEqual([], report["operator_declared_associations"])

    def test_same_stem_log_is_only_a_name_candidate(self):
        database, log = self.write("sample.db"), self.write("sample.log")
        report = self.report(database, log)
        candidate = report["database_coverage"][0]["selected_name_candidates"][0]
        self.assertEqual("same_stem_selected_log_only", candidate["basis"])
        self.assertFalse(candidate["association_verified"])
        self.assertIn("log_association_not_declared", report["database_coverage"][0]["gaps"])

    def test_declared_relationships_do_not_prove_association(self):
        database, log, config = self.write("sample.db"), self.write("different-name.log"), self.write("settings.ini")
        report = self.report(database, log, config, relationships=[("log", database, log), ("config", database, config)])
        relationships = report["operator_declared_associations"]
        self.assertTrue(all(r["selected_files_recorded"] for r in relationships))
        self.assertTrue(all(not r["content_association_verified"] for r in relationships))
        self.assertIn("log_association_not_engine_verified", report["database_coverage"][0]["gaps"])

    def test_missing_declared_log_is_a_gap(self):
        database, missing = self.write("sample.db"), self.root / "expected.log"
        report = self.report(database, missing, relationships=[("log", database, missing)])
        self.assertEqual("incomplete", report["inventory_status"])
        self.assertEqual("missing", report["files"][1]["status"])
        self.assertIsNone(report["files"][1]["sha256"])
        self.assertIn("declared_log_file_unavailable_or_unstable", report["database_coverage"][0]["gaps"])
        self.assertFalse(missing.exists())

    def test_unselected_or_self_relationship_is_rejected_before_read(self):
        database, log = self.write("sample.db"), self.root / "unselected.log"
        for relationship in [("log", database, log), ("log", database, database)]:
            with self.subTest(relationship=relationship):
                with mock.patch.object(preflight, "inspect_file") as reader:
                    with self.assertRaises(preflight.InputError):
                        self.report(database, relationships=[relationship])
                    reader.assert_not_called()

    def test_nonstandard_database_filename_can_be_explicitly_declared(self):
        database, log = self.write("ledger.data"), self.write("log.data")
        report = self.report(database, log, database_files=[database], relationships=[("log", database, log)])
        self.assertEqual("F001", report["database_coverage"][0]["database_input_id"])

    def test_same_name_files_in_different_directories_are_separate(self):
        a, b = self.write("one/sample.db", b"first"), self.write("two/sample.db", b"second")
        report = self.report(a, a, b)
        self.assertEqual(2, len(report["files"]))
        self.assertNotEqual(report["files"][0]["sha256"], report["files"][1]["sha256"])

    def test_directory_and_fifo_are_rejected_without_open(self):
        paths = [self.root]
        if hasattr(os, "mkfifo"):
            fifo = self.root / "pipe.db"
            os.mkfifo(fifo)
            paths.append(fifo)
        with mock.patch.object(preflight, "open_regular_readonly") as reader:
            report = self.report(*paths)
            reader.assert_not_called()
        self.assertTrue(all(f["status"] == "rejected" for f in report["files"]))

    @unittest.skipUnless(hasattr(os, "symlink"), "symlink unavailable")
    def test_symlink_file_and_parent_are_not_followed(self):
        target = self.write("real/source.db")
        link = self.root / "alias.db"
        link.symlink_to(target)
        parent = self.root / "alias-dir"
        parent.symlink_to(target.parent, target_is_directory=True)
        with mock.patch.object(preflight, "open_regular_readonly") as reader:
            report = self.report(link, parent / target.name)
            reader.assert_not_called()
        self.assertTrue(all(f["status"] == "rejected" for f in report["files"]))

    def test_permission_denial_does_not_modify_or_echo_error(self):
        path = self.write("private.db")
        with mock.patch.object(preflight, "open_regular_readonly", side_effect=PermissionError("fake-secret-raw-path")):
            report = self.report(path)
        self.assertEqual("unreadable", report["files"][0]["status"])
        self.assertNotIn("fake-secret", json.dumps(report))
        self.assertEqual(b"fictional-data", path.read_bytes())

    def test_size_and_total_budgets_never_emit_partial_hash(self):
        a, b = self.write("a.db", b"12345"), self.write("b.db", b"67890")
        report = self.report(a, b, max_file_bytes=4)
        self.assertTrue(all(f["status"] == "limit_exceeded" for f in report["files"]))
        self.assertTrue(all(f["sha256"] is None for f in report["files"]))
        report = self.report(a, b, max_total_bytes=7)
        self.assertEqual("recorded", report["files"][0]["status"])
        self.assertEqual("limit_exceeded", report["files"][1]["status"])
        self.assertIsNone(report["files"][1]["sha256"])

    def test_file_count_budget_rejects_before_reads(self):
        a, b = self.write("a.db"), self.write("b.db")
        with mock.patch.object(preflight, "inspect_file") as reader:
            with self.assertRaises(preflight.InputError):
                self.report(a, b, max_files=1)
            reader.assert_not_called()

    def test_changed_during_hash_or_metadata_has_no_hash_or_version(self):
        path = self.write("sample.db", b"original-bytes")
        original = preflight.static_hints
        def change_then_read(*args):
            with path.open("ab") as stream:
                stream.write(b"changed")
            return original(*args)
        with mock.patch.object(preflight, "static_hints", side_effect=change_then_read):
            report = self.report(path)
        item = report["files"][0]
        self.assertEqual("unstable", item["status"])
        self.assertIsNone(item["sha256"])
        self.assertNotIn("hints", item)

    def test_atomic_replacement_is_not_accepted_as_stable_input(self):
        path = self.write("sample.db", b"original")
        replacement = self.write("replacement.data", b"different")
        original = preflight.static_hints
        def replace_then_read(*args):
            replacement.replace(path)
            return original(*args)
        with mock.patch.object(preflight, "static_hints", side_effect=replace_then_read):
            item = self.report(path)["files"][0]
        self.assertEqual("unstable", item["status"])
        self.assertIsNone(item["sha256"])
        self.assertNotIn("hints", item)

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "O_NOFOLLOW"), "POSIX path descriptor check")
    def test_parent_replaced_by_symlink_between_check_and_open_is_not_followed(self):
        source = self.write("parent/source.db", b"selected-data")
        elsewhere = self.write("elsewhere/source.db", b"unselected-data")
        original = preflight.check_components
        calls = 0
        def swap_parent(path, *args, **kwargs):
            nonlocal calls
            original(path, *args, **kwargs)
            calls += 1
            # inspect_file's first check followed by open_regular_readonly's check.
            if calls == 2:
                source.parent.rename(self.root / "original-parent")
                source.parent.symlink_to(elsewhere.parent, target_is_directory=True)
        with mock.patch.object(preflight, "check_components", side_effect=swap_parent):
            item = self.report(source)["files"][0]
        self.assertNotEqual("recorded", item["status"])
        self.assertIsNone(item["sha256"])
        self.assertEqual(b"unselected-data", elsewhere.read_bytes())

    def test_readonly_descriptor_is_used_and_closed(self):
        path = self.write("sample.db")
        real_open = os.open
        observed = []
        def recording_open(*args, **kwargs):
            observed.append(args[1])
            return real_open(*args, **kwargs)
        with mock.patch.object(os, "open", side_effect=recording_open):
            report = self.report(path)
        self.assertEqual("recorded", report["files"][0]["status"])
        self.assertTrue(observed)
        self.assertTrue(all((flags & os.O_ACCMODE) == os.O_RDONLY for flags in observed))

    def test_empty_file_has_known_hash_but_unknown_format(self):
        report = self.report(self.write("empty.db", b""))
        self.assertEqual(hashlib.sha256(b"").hexdigest(), report["files"][0]["sha256"])
        self.assertIsNone(report["files"][0]["hints"]["database_file_format_version"])

    def test_sqlite_signature_does_not_become_original_compatibility(self):
        report = self.report(self.write("misnamed.db", b"SQLite format 3\0" + bytes(64)))
        self.assertEqual("SQLite_format_3", report["files"][0]["hints"]["file_signature"])
        self.assertEqual("not_assessed", report["compatibility_status"])

    def test_filename_is_only_an_unverified_hint(self):
        report = self.report(self.write("dbeng9.exe", b"not-a-PE"))
        hint = report["files"][0]["hints"]["filename_version_hint"]
        self.assertEqual(9, hint["major"])
        self.assertFalse(hint["verified"])
        self.assertIsNone(report["files"][0]["hints"]["database_engine_version"])

    def test_numeric_pe_version_is_declared_metadata_not_db_version(self):
        report = self.report(self.write("dbeng9.exe", fictional_pe()))
        hints = report["files"][0]["hints"]
        self.assertEqual("x86", hints["pe"]["architecture"])
        self.assertEqual("PE32", hints["pe"]["format"])
        self.assertEqual("8.2.3.4", hints["pe"]["declared_versions"][0]["file_version"])
        self.assertEqual("8.9.10.11", hints["pe"]["declared_versions"][0]["product_version"])
        self.assertEqual(9, hints["filename_version_hint"]["major"])
        self.assertIsNone(hints["database_engine_version"])

    def test_pe32_plus_resource_directory_uses_its_own_offsets(self):
        data = bytearray(fictional_pe())
        old_section = bytes(data[0x98 + 224:0x98 + 224 + 40])
        data[0x98 + 224:0x98 + 224 + 40] = bytes(40)
        data[0x98 + 240:0x98 + 240 + 40] = old_section
        struct.pack_into("<H", data, 0x84, 0x8664)
        struct.pack_into("<H", data, 0x94, 240)
        struct.pack_into("<H", data, 0x98, 0x20b)
        struct.pack_into("<I", data, 0x98 + 108, 16)
        struct.pack_into("<II", data, 0x98 + 128, 0x1000, 0x400)
        hints = self.report(self.write("library.dll", data))["files"][0]["hints"]
        self.assertEqual("PE32+", hints["pe"]["format"])
        self.assertEqual("x64", hints["pe"]["architecture"])
        self.assertEqual("8.2.3.4", hints["pe"]["declared_versions"][0]["file_version"])

    def test_unicode_names_roundtrip_without_console_encoding_dependency(self):
        source = self.write("合成账套-😀.db")
        status, out, err = self.cli(["--file", str(source)])
        self.assertEqual((0, ""), (status, err))
        out.encode("ascii")
        self.assertEqual(source.name, json.loads(out)["files"][0]["name"])

    def test_malformed_pe_offsets_cycles_and_version_blob_are_bounded(self):
        malformed = []
        a = bytearray(fictional_pe())
        struct.pack_into("<I", a, 60, 0xffffffff)
        malformed.append(a)
        a = bytearray(fictional_pe())
        struct.pack_into("<I", a, 0x214, 0x80000000)
        malformed.append(a)
        a = bytearray(fictional_pe())
        struct.pack_into("<I", a, 0x328, 0x12345678)
        malformed.append(a)
        for index, data in enumerate(malformed):
            with self.subTest(index=index):
                report = self.report(self.write(f"bad-{index}.exe", data))
                item = report["files"][0]
                self.assertEqual("recorded", item["status"])
                self.assertEqual("malformed_or_unsupported_no_version_claim", item["hints"]["pe_metadata_status"])
                self.assertNotIn("pe", item["hints"])

    def test_large_resource_directory_does_not_disable_hash(self):
        data = bytearray(fictional_pe())
        struct.pack_into("<I", data, 0x98 + 116, 2 * 1024**2)
        report = self.report(self.write("large.exe", data))
        item = report["files"][0]
        self.assertEqual("recorded", item["status"])
        self.assertEqual("resource_directory_exceeds_metadata_limit", item["hints"]["pe"]["version_status"])
        self.assertEqual([], item["hints"]["pe"]["declared_versions"])

    def test_metadata_budget_is_cumulative_across_version_leaves(self):
        per_leaf = preflight.MAX_METADATA_BYTES // 4
        data = bytearray(0x800 + per_leaf)
        original = fictional_pe()
        data[:len(original)] = original
        # Sixteen language leaves reference one large synthetic version blob.
        # The old per-read limit would read it sixteen times (> 4 MiB).
        resource = 0x200
        struct.pack_into("<HH", data, resource + 0x40 + 12, 0, 16)
        for i in range(16):
            struct.pack_into("<II", data, resource + 0x40 + 16 + i * 8, 1000 + i, 0x100 + i * 16)
            struct.pack_into("<IIII", data, resource + 0x100 + i * 16, 0x1600, per_leaf, 0, 0)
        data[0x800:0x800 + 92] = original[0x300:0x300 + 92]
        raw_size = len(data) - resource
        struct.pack_into("<IIII", data, 0x98 + 224 + 8, raw_size, 0x1000, raw_size, resource)
        source = self.write("many-languages.exe", data)
        with mock.patch.object(preflight, "read_range", wraps=preflight.read_range) as reader:
            item = self.report(source)["files"][0]
        actual_metadata_bytes = sum(call.args[2] for call in reader.call_args_list)
        self.assertLessEqual(actual_metadata_bytes, preflight.MAX_METADATA_BYTES)
        self.assertEqual("recorded", item["status"])
        self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])
        self.assertEqual("cumulative_metadata_budget_exceeded_no_version_claim", item["hints"]["pe_metadata_status"])
        self.assertNotIn("pe", item["hints"])
        self.assertEqual(actual_metadata_bytes, item["hints"]["metadata_bytes_read"])
        self.assertEqual(preflight.MAX_METADATA_BYTES, item["hints"]["metadata_byte_limit"])

    def test_valid_pe_without_version_resource_remains_unknown(self):
        data = bytearray(fictional_pe())
        struct.pack_into("<II", data, 0x98 + 112, 0, 0)
        item = self.report(self.write("no-version.exe", data))["files"][0]
        self.assertEqual("recorded", item["status"])
        self.assertEqual("not_present", item["hints"]["pe"]["version_status"])
        self.assertIsNone(item["hints"]["database_engine_version"])

    def test_network_and_url_syntax_rejected_before_reads(self):
        for path in ["https://example.invalid/file.db", "//server/share/file.db", "\\\\server\\share\\file.db"]:
            with self.subTest(path=path), mock.patch.object(preflight, "inspect_file") as reader:
                with self.assertRaises(preflight.InputError):
                    self.report(path)
                reader.assert_not_called()

    def test_parent_components_are_rejected_before_lexical_normalization(self):
        for value in ["local/link/../file.db", "../file.db", "local\\link\\..\\file.db", "C:..\\file.db"]:
            with self.subTest(value=value), mock.patch.object(preflight.os.path, "abspath") as normalize:
                with self.assertRaises(preflight.InputError):
                    preflight.local_path(value)
                normalize.assert_not_called()

    @unittest.skipUnless(hasattr(os, "symlink"), "symlink unavailable")
    def test_symlink_then_parent_input_cannot_hash_a_different_file(self):
        local_file = self.write("local/file.db", b"local-bytes")
        outside_file = self.write("outside/file.db", b"outside-bytes")
        outside_sub = outside_file.parent / "sub"
        outside_sub.mkdir()
        link = local_file.parent / "link"
        link.symlink_to(outside_sub, target_is_directory=True)
        selected = link / ".." / "file.db"
        # The OS resolves this to outside/file.db, not local/file.db.
        self.assertEqual(b"outside-bytes", selected.read_bytes())
        with mock.patch.object(preflight, "inspect_file", wraps=preflight.inspect_file) as reader:
            with self.assertRaises(preflight.InputError):
                self.report(selected)
            reader.assert_not_called()
        self.assertEqual(b"local-bytes", local_file.read_bytes())
        self.assertEqual(b"outside-bytes", outside_file.read_bytes())

    @unittest.skipUnless(hasattr(os, "symlink"), "symlink unavailable")
    def test_symlink_then_parent_output_cannot_redirect_report(self):
        source = self.write("local/input.db")
        outside_sub = self.root / "outside/sub"
        outside_sub.mkdir(parents=True)
        link = source.parent / "link"
        link.symlink_to(outside_sub, target_is_directory=True)
        selected_output = link / ".." / "report.json"
        with mock.patch.object(preflight, "inspect_file", wraps=preflight.inspect_file) as reader:
            status, out, err = self.cli(["--file", str(source), "--output", str(selected_output)])
            self.assertEqual(2, status)
            reader.assert_not_called()
        self.assertEqual("", out)
        self.assertIn("parent_directory_component_rejected", err)
        self.assertFalse((source.parent / "report.json").exists())
        self.assertFalse((outside_sub.parent / "report.json").exists())

    def test_cli_new_report_and_existing_output_never_overwritten(self):
        source = self.write("sample.db")
        output = self.root / "report.json"
        status, out, err = self.cli(["--database", str(source), "--output", str(output)])
        self.assertEqual((0, "", ""), (status, out, err))
        self.assertEqual("not_assessed", json.loads(output.read_text())["compatibility_status"])
        previous = output.read_bytes()
        status, out, err = self.cli(["--file", str(source), "--output", str(output)])
        self.assertEqual(2, status)
        self.assertEqual(previous, output.read_bytes())
        status, _, _ = self.cli(["--file", str(source), "--output", str(source)])
        self.assertEqual(2, status)
        self.assertEqual(b"fictional-data", source.read_bytes())

    def test_existing_output_is_rejected_before_input_reads(self):
        source, output = self.write("input.db"), self.write("keep.json", b"keep")
        with mock.patch.object(preflight, "inspect_file") as reader:
            status, _, _ = self.cli(["--file", str(source), "--output", str(output)])
            reader.assert_not_called()
        self.assertEqual(2, status)
        self.assertEqual(b"keep", output.read_bytes())

    def test_missing_selected_input_cannot_be_created_as_report(self):
        missing = self.root / "missing.db"
        with mock.patch.object(preflight, "inspect_file") as reader:
            status, out, err = self.cli(["--file", str(missing), "--output", str(missing)])
            reader.assert_not_called()
        self.assertEqual(2, status)
        self.assertEqual("", out)
        self.assertIn("report_destination_is_selected_input", err)
        self.assertFalse(missing.exists())

    def test_native_python_cli_reads_only_synthetic_files(self):
        source = self.write("fictional.db", b"not-an-actual-database")
        config = self.write("Rhzw8.ini", b"PWD=fake-native-cli-secret\nDBF=not-selected.db")
        result = subprocess.run([sys.executable, "-B", str(MODULE_PATH), "--database", str(source),
                                 "--file", str(config), "--config-for", str(source), str(config)],
                                capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(0, result.returncode, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(2, len(report["files"]))
        self.assertEqual("not_assessed", report["compatibility_status"])
        self.assertNotIn("fake-native-cli-secret", result.stdout + result.stderr)
        self.assertNotIn("not-selected.db", result.stdout + result.stderr)
        self.assertFalse(report["scope"]["engines_started"])
        self.assertEqual(b"not-an-actual-database", source.read_bytes())

    def test_cli_missing_file_exits_one_but_keeps_inventory(self):
        missing = self.root / "missing.db"
        status, out, err = self.cli(["--file", str(missing)])
        self.assertEqual(1, status)
        self.assertEqual("", err)
        self.assertEqual("missing", json.loads(out)["files"][0]["status"])

    def test_cli_no_files_rejected_and_unknown_secret_argument_not_echoed(self):
        status, out, err = self.cli([])
        self.assertEqual(2, status)
        self.assertEqual("", out)
        captured = io.StringIO()
        with contextlib.redirect_stderr(captured):
            with self.assertRaises(SystemExit) as stopped:
                preflight.main(["--password", "fake-secret-never-echo"])
        self.assertEqual(2, stopped.exception.code)
        self.assertNotIn("fake-secret", captured.getvalue())

    @unittest.skipUnless(hasattr(os, "symlink"), "symlink unavailable")
    def test_output_symlink_is_not_followed(self):
        source = self.write("sample.db")
        target = self.write("keep.json", b"unchanged")
        output = self.root / "alias.json"
        output.symlink_to(target)
        status, _, _ = self.cli(["--file", str(source), "--output", str(output)])
        self.assertEqual(2, status)
        self.assertEqual(b"unchanged", target.read_bytes())


if __name__ == "__main__":
    unittest.main()
