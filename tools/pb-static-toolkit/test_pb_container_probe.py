"""Synthetic-format regression tests; no original program bytes."""
import struct
import unittest
import contextlib
import csv
import io
import json
import tempfile
from pathlib import Path
from unittest import mock
import pb_container_probe as probe


def fixture(unicode=False, embedded=False, data=b"w_fixture_only\x00commit\x00", second=False):
    base = 1024 if embedded else 0
    header_size = 1024 if unicode else 512
    bitmap = base + header_size
    node = bitmap + 512
    block = node + 3072
    b = bytearray(block + (1024 if second else 512) + (512 if embedded else 0))
    b[base:base+4] = b"HDR*"
    enc = "utf-16le" if unicode else "cp936"
    product = "PowerBuilder".encode(enc)
    b[base+4:base+4+len(product)] = product
    vpos = 32 if unicode else 18
    ver = "0600".encode(enc)
    b[base+vpos:base+vpos+len(ver)] = ver
    b[bitmap:bitmap+4] = b"FRE*"
    b[node:node+4] = b"NOD*"
    name = ("w_fixture_only.win\x00").encode(enc)
    ent = b"ENT*" + ver + struct.pack("<IIIHH", block, len(data), 0, 0, len(name)) + name
    struct.pack_into("<H", b, node+16, 3040-len(ent))
    struct.pack_into("<H", b, node+20, 1)
    b[node+32:node+32+len(ent)] = ent
    first = data[:502]
    b[block:block+4] = b"DAT*"
    struct.pack_into("<IH", b, block+4, block+512 if second else 0, len(first))
    b[block+10:block+10+len(first)] = first
    if second:
        rest=data[502:]
        b[block+512:block+516] = b"DAT*"
        struct.pack_into("<IH", b, block+516, 0, len(rest))
        b[block+522:block+522+len(rest)] = rest
    if embedded:
        b[:2]=b"MZ"
        trailer=len(b)-512
        b[trailer:trailer+4]=b"TRL*"
        struct.pack_into("<I", b, trailer+4, base)
    return b, node, block


class ContainerProbeTests(unittest.TestCase):
    def test_ansi_index_and_offsets(self):
        b,n,d=fixture()
        result=probe.probe_bytes(b)
        obj=result["libraries"][0]["objects"][0]
        self.assertEqual(result["status"],"container_parsed")
        self.assertEqual(obj["name"],"w_fixture_only.win")
        self.assertEqual(obj["entry_offset"],n+32)
        self.assertEqual(obj["data_segments"][0]["file_offset"],d+10)
        self.assertEqual(obj["logical_data_sha256"],probe.sha(b"w_fixture_only\x00commit\x00"))
        self.assertEqual(obj["name_hints"][0]["local_matching_entry_offsets"],[n+32])
        self.assertEqual(result["libraries"][0]["call_graph"]["edges"],[])

    def test_unicode_index(self):
        b,_,_=fixture(unicode=True,data="w_fixture_only\x00审核".encode("utf-16le"))
        result=probe.probe_bytes(b)
        self.assertEqual(result["libraries"][0]["header_encoding"],"utf-16le")
        self.assertIn("审核",[h["term"] for h in result["libraries"][0]["objects"][0]["keyword_hints"]])

    def test_embedded_exe_absolute_offsets_and_trailer(self):
        b,_,_=fixture(embedded=True)
        result=probe.probe_bytes(b)
        self.assertEqual(result["libraries"][0]["header_offset"],1024)
        self.assertTrue(result["trailer_candidates"][0]["matches_valid_header"])

    def test_chained_data_and_cross_boundary_span(self):
        data=b"x"*499+b"w_fixture_only\x00"
        b,_,d=fixture(data=data,second=True)
        obj=probe.probe_bytes(b)["libraries"][0]["objects"][0]
        self.assertEqual(obj["logical_data_sha256"],probe.sha(data))
        spans=probe.physical_spans(obj["data_segments"],499,9)
        self.assertEqual(spans,[{"file_offset":d+509,"bytes":3},{"file_offset":d+522,"bytes":6}])

    def test_cycle_is_partial(self):
        b,_,d=fixture()
        struct.pack_into("<I",b,d+4,d)
        result=probe.probe_bytes(b)
        self.assertEqual(result["status"],"partial")
        self.assertIn("DAT_chain_cycle",result["libraries"][0]["objects"][0]["errors"])

    def test_corrupt_entry_stays_partial(self):
        b,n,_=fixture()
        b[n+32:n+36]=b"BAD*"
        self.assertEqual(probe.probe_bytes(b)["status"],"partial")

    def test_truncated_data_stays_partial(self):
        b,_,d=fixture()
        self.assertEqual(probe.probe_bytes(b[:d+11])["status"],"partial")

    def test_forged_header_rejected(self):
        b=bytearray(512);b[:4]=b"HDR*"
        result=probe.probe_bytes(b)
        self.assertEqual(result["status"],"no_supported_container")
        self.assertTrue(result["rejected_headers"])

    def test_object_limit_is_reported(self):
        b,_,_=fixture()
        result=probe.probe_bytes(b,max_object_bytes=1)
        self.assertEqual(result["status"],"partial")
        self.assertIn("object_exceeds_byte_limit",result["libraries"][0]["objects"][0]["errors"])

    def test_bad_dat_length_rejected(self):
        b,_,d=fixture()
        struct.pack_into("<H",b,d+8,503)
        result=probe.probe_bytes(b)
        self.assertIn("invalid_DAT_length",result["libraries"][0]["objects"][0]["errors"])

    def test_datawindow_ascii_case_insensitive(self):
        b,_,d=fixture(data=b"DaTaWiNdOw table COLUMN")
        obj=probe.probe_bytes(b)["libraries"][0]["objects"][0]
        self.assertIs(obj["datawindow_text_signature_candidate"],True)
        detection=obj["datawindow_text_signature_detection"]
        self.assertEqual(detection["status"],"detected")
        self.assertEqual(detection["matches"][0]["encoding"],"ascii")
        self.assertEqual(detection["matches"][0]["occurrences"][0]["file_spans"][0]["file_offset"],d+10)
        self.assertFalse(detection["is_parsed_DataWindow_definition"])

    def test_datawindow_utf16le_regression(self):
        b,_,_=fixture(unicode=True,data="DataWindow table column".encode("utf-16le"))
        obj=probe.probe_bytes(b)["libraries"][0]["objects"][0]
        self.assertIs(obj["datawindow_text_signature_candidate"],True)
        self.assertEqual(obj["datawindow_text_signature_detection"]["matches"][0]["encoding"],"utf-16le")
        self.assertIn("datawindow",[h["term"] for h in obj["keyword_hints"]])

    def test_not_detected_does_not_claim_absence(self):
        b,_,_=fixture(data=b"some non-matching data")
        obj=probe.probe_bytes(b)["libraries"][0]["objects"][0]
        self.assertIsNone(obj["datawindow_text_signature_candidate"])
        detection=obj["datawindow_text_signature_detection"]
        self.assertEqual(detection["status"],"not_detected_in_available_bytes")
        self.assertTrue(detection["input_complete"])
        self.assertFalse(detection["absence_proven"])

    def test_no_cross_encoding_combination(self):
        b,_,_=fixture(data=b"datawindow\x00"+"table column".encode("utf-16le"))
        obj=probe.probe_bytes(b)["libraries"][0]["objects"][0]
        self.assertIsNone(obj["datawindow_text_signature_candidate"])

    def test_skipped_object_reports_not_evaluated(self):
        b,_,_=fixture()
        obj=probe.probe_bytes(b,max_object_bytes=1)["libraries"][0]["objects"][0]
        self.assertIsNone(obj["datawindow_text_signature_candidate"])
        self.assertEqual(obj["datawindow_text_signature_detection"]["status"],"not_evaluated")
        self.assertEqual(obj["datawindow_text_signature_detection"]["encodings_checked"],[])

    def test_file_size_budget_rejects_probe(self):
        b,_,_=fixture()
        result=probe.probe_bytes(b,max_file_bytes=len(b)-1)
        self.assertEqual(result["status"],"file_size_limit_rejected")
        self.assertEqual(result["libraries"],[])

    def test_object_count_budget_across_entries(self):
        b,n,_=fixture()
        entry_size=24+struct.unpack_from("<H",b,n+32+22)[0]
        b[n+32+entry_size:n+32+entry_size*2]=b[n+32:n+32+entry_size]
        struct.pack_into("<H",b,n+20,2)
        result=probe.probe_bytes(b,max_objects=1)
        self.assertEqual(result["status"],"partial")
        self.assertEqual(len(result["libraries"][0]["objects"]),1)
        self.assertEqual(result["budget"]["used"]["objects"],1)
        self.assertIn("objects",result["budget"]["exhausted"])

    def test_total_reconstructed_budget_counts_duplicate_chains(self):
        b,n,_=fixture()
        entry_size=24+struct.unpack_from("<H",b,n+32+22)[0]
        b[n+32+entry_size:n+32+entry_size*2]=b[n+32:n+32+entry_size]
        struct.pack_into("<H",b,n+20,2)
        declared=struct.unpack_from("<I",b,n+32+12)[0]
        result=probe.probe_bytes(b,max_total_object_bytes=declared)
        self.assertEqual(result["status"],"partial")
        objects=result["libraries"][0]["objects"]
        self.assertEqual(objects[0]["chain_status"],"complete")
        self.assertEqual(objects[1]["chain_status"],"incomplete")
        self.assertIn("reconstructed_object_bytes",result["budget"]["exhausted"])

    def test_global_traversal_budget_stops_header_scan(self):
        b,_,_=fixture()
        result=probe.probe_bytes(b,max_traversal_steps=1)
        self.assertEqual(result["status"],"partial")
        self.assertLessEqual(result["budget"]["used"]["traversal_steps"],1)
        self.assertIn("traversal_steps",result["budget"]["exhausted"])


class BatchProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.root=self.base/"payloads"
        self.root.mkdir()
        self.manifest=self.base/"manifest.csv"
        self.output=self.base/"output"
        self.data=bytes(fixture()[0])

    def row(self,name="input.pbd",record="1",data=None):
        data=self.data if data is None else data
        return {"record":record,"installer":"synthetic","original_destination":"<INSTALL>\\input.pbd",
                "bytes":str(len(data)),"sha256":probe.sha(data),"materialized_relative_path":name}

    def run_batch(self,rows,**limits):
        with self.manifest.open("w",newline="",encoding="utf-8") as stream:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]))
            writer.writeheader();writer.writerows(rows)
        with contextlib.redirect_stdout(io.StringIO()):
            result=probe.batch(self.manifest,self.root,self.output,32*1024*1024,100,**limits)
        self.assertEqual(result,json.loads((self.output/"index.json").read_text()))
        return result

    def assert_rejected_without_payload_read(self,row,status,**limits):
        original_open=Path.open
        protected=(self.root/row["materialized_relative_path"]).resolve()
        def guarded_open(path,*args,**kwargs):
            if path.resolve()==protected:
                self.fail("Rejected payload was opened")
            return original_open(path,*args,**kwargs)
        with mock.patch.object(Path,"open",guarded_open):
            result=self.run_batch([row],**limits)
        self.assertEqual(result["records"][0]["status"],status)
        self.assertEqual(list(self.output.glob("*.json")),[self.output/"index.json"])

    def test_relative_path_escape_rejected_before_read(self):
        (self.base/"escape.pbd").write_bytes(self.data)
        self.assert_rejected_without_payload_read(self.row("../escape.pbd"),"path_outside_payload_root_rejected")

    def test_absolute_path_escape_rejected_before_read(self):
        escape=self.base/"escape.pbd";escape.write_bytes(self.data)
        self.assert_rejected_without_payload_read(self.row(str(escape)),"path_outside_payload_root_rejected")

    def test_symlink_escape_rejected_before_read(self):
        escape=self.base/"escape.pbd";escape.write_bytes(self.data)
        (self.root/"link.pbd").symlink_to(escape)
        self.assert_rejected_without_payload_read(self.row("link.pbd"),"path_outside_payload_root_rejected")

    def test_size_mismatch_rejected_before_read(self):
        (self.root/"input.pbd").write_bytes(self.data)
        row=self.row();row["bytes"]=str(len(self.data)+1)
        self.assert_rejected_without_payload_read(row,"hash_or_size_mismatch_rejected")

    def test_hash_mismatch_rejected_before_parser(self):
        (self.root/"input.pbd").write_bytes(self.data)
        row=self.row();row["sha256"]="0"*64
        with mock.patch.object(probe,"probe_bytes",side_effect=AssertionError("Parser must not receive mismatched input")):
            result=self.run_batch([row])
        self.assertEqual(result["records"][0]["status"],"hash_or_size_mismatch_rejected")
        self.assertEqual(result["budget"]["used"]["objects"],0)

    def test_oversized_file_rejected_before_read(self):
        (self.root/"input.pbd").write_bytes(self.data)
        self.assert_rejected_without_payload_read(self.row(),"file_size_limit_rejected",max_file_bytes=len(self.data)-1)

    def test_total_file_read_budget_shared_between_records(self):
        (self.root/"one.pbd").write_bytes(self.data)
        (self.root/"two.pbd").write_bytes(self.data)
        result=self.run_batch([self.row("one.pbd"),self.row("two.pbd","2")],max_total_file_bytes=len(self.data))
        self.assertEqual(result["records"][0]["status"],"container_parsed")
        self.assertEqual(result["records"][1]["status"],"total_file_bytes_limit_rejected")
        self.assertEqual(result["budget"]["used"]["input_file_bytes"],len(self.data))

    def test_objects_budget_shared_between_distinct_files(self):
        second=bytes(fixture(data=b"different data")[0])
        (self.root/"one.pbd").write_bytes(self.data)
        (self.root/"two.pbd").write_bytes(second)
        result=self.run_batch([self.row("one.pbd"),self.row("two.pbd","2",second)],max_objects=1)
        self.assertEqual(result["records"][0]["status"],"container_parsed")
        self.assertEqual(result["records"][1]["status"],"partial")
        self.assertEqual(result["budget"]["used"]["objects"],1)
        self.assertIn("objects",result["budget"]["exhausted"])

    def test_output_in_input_tree_rejected(self):
        self.output=self.root/"output"
        with self.assertRaisesRegex(ValueError,"outside the input"):
            self.run_batch([self.row()])

    def test_nonpositive_budget_rejected(self):
        with self.assertRaisesRegex(ValueError,"positive"):
            self.run_batch([self.row()],max_objects=0)


if __name__=="__main__":
    unittest.main()
