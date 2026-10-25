"""Synthetic-format regression tests; not validation against caiwu PB9 bytes."""
import struct
import unittest
import pb_container_probe as probe


def fixture(unicode=False, embedded=False, data=b"w_voucher\x00commit\x00", second=False):
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
    name = ("w_voucher.win\x00").encode(enc)
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
        self.assertEqual(obj["name"],"w_voucher.win")
        self.assertEqual(obj["entry_offset"],n+32)
        self.assertEqual(obj["data_segments"][0]["file_offset"],d+10)
        self.assertEqual(obj["logical_data_sha256"],probe.sha(b"w_voucher\x00commit\x00"))
        self.assertEqual(obj["name_hints"][0]["local_matching_entry_offsets"],[n+32])
        self.assertEqual(result["libraries"][0]["call_graph"]["edges"],[])

    def test_unicode_index(self):
        b,_,_=fixture(unicode=True,data="w_voucher\x00审核".encode("utf-16le"))
        result=probe.probe_bytes(b)
        self.assertEqual(result["libraries"][0]["header_encoding"],"utf-16le")
        self.assertIn("审核",[h["term"] for h in result["libraries"][0]["objects"][0]["keyword_hints"]])

    def test_embedded_exe_absolute_offsets_and_trailer(self):
        b,_,_=fixture(embedded=True)
        result=probe.probe_bytes(b)
        self.assertEqual(result["libraries"][0]["header_offset"],1024)
        self.assertTrue(result["trailer_candidates"][0]["matches_valid_header"])

    def test_chained_data_and_cross_boundary_span(self):
        data=b"x"*499+b"w_voucher\x00"
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


if __name__=="__main__":
    unittest.main()
