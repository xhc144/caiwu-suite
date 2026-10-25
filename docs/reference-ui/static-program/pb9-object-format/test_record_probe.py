"""Independent synthetic records; no external parser or target data executed."""
import struct
import unittest
import record_probe as p


class RecordTests(unittest.TestCase):
    def test_header_offsets(self):
        b=struct.pack("<HHIIIIIH",0xC1,2,3,4,5,6,7,8)
        r=p.decode_record("entry_header",b,0xC1,100)
        self.assertEqual(r["fields"]["leading_12byte_record_count"],8)
        self.assertEqual(r["fields"]["modified_timestamp_candidate"],5)
        self.assertEqual(r["offset"],100)
        self.assertFalse(r["target_layout_validated"])

    def test_unknown_version_not_guessed(self):
        with self.assertRaises(p.InvalidRecord):p.decode_record("entry_header",b"\0"*26,0xEE)

    def test_disagreeing_header_version_rejected(self):
        with self.assertRaises(p.InvalidRecord):p.decode_record("entry_header",b"\xc4\0"+b"\0"*24,0xC1)

    def test_exact_lengths(self):
        for kind,size in p.FIXED_BYTES.items():
            for length in [size-1,size+1]:
                with self.assertRaises(p.InvalidRecord):p.decode_record(kind,b"\0"*length,0xC1)

    def test_inheritance_is_not_own_type(self):
        b=struct.pack("<16H",0x8001,0x8002,3,0,0,0,0,0,10,0,0,4,5,6,7,0)
        f=p.decode_record("object_definition",b,0xC1)["fields"]
        self.assertEqual(f["inherit_type_candidate"]["raw"],0x8001)
        self.assertEqual(f["parent_type_candidate"]["raw"],0x8002)
        self.assertEqual(f["uninterpreted_6byte_table_count"],5)

    def test_function_indexes_flags_and_offsets(self):
        b=bytearray(48)
        struct.pack_into("<I",b,0,0x80000010)
        struct.pack_into("<HH",b,20,7,3)
        struct.pack_into("<HBBH",b,28,0x4004,2,0x15,55)
        f=p.decode_record("function_definition",b,0xC4)["fields"]
        self.assertEqual(f["global_dispatch_slot_candidate"],7)
        self.assertEqual(f["ref_index_raw"],3)
        self.assertEqual(f["parameter_count"],2)
        self.assertTrue(f["event_candidate"] and f["external_candidate"] and f["private_candidate"])
        self.assertTrue(f["name_pool_ref"]["bit31_set"])
        self.assertFalse(f["name_pool_ref"]["bounds_checked_against_pool"])

    def test_parameter_flag_precedence_matches_read_rule(self):
        b=bytearray(12);b[10]=6
        f=p.decode_record("parameter",b,0xC1)["fields"]
        self.assertTrue(f["read_only_candidate"])
        self.assertFalse(f["reference_candidate_if_not_read_only"])

    def test_event_triples_remain_low_evidence(self):
        r=p.decode_record("event_triple",struct.pack("<HHH",1,2,3),0xC1)
        self.assertIn("legacy_PB6",r["evidence_tier"])
        self.assertFalse(r["target_layout_validated"])

    def test_type_family_preserved(self):
        self.assertEqual(p.type_ref(0x4001)["source_lookup_candidate"],"system_type_table")
        self.assertEqual(p.type_ref(0x8001)["source_lookup_candidate"],"entry_type_table")
        self.assertEqual(p.type_ref(0xC000)["source_lookup_candidate"],"sentinel_unresolved")
        self.assertEqual(p.type_ref(0x5000)["source_lookup_candidate"],"unsupported")

    def test_descriptor_keeps_receiver_requirement(self):
        f=p.decode_record("call_target_descriptor",struct.pack("<HHI",7,0x8002,20),0xC1)["fields"]
        self.assertEqual(f["dispatch_slot_candidate"],7)
        self.assertTrue(f["receiver_type_and_inheritance_still_required"])

    def test_no_scan_without_instruction_boundary(self):
        with self.assertRaises(p.InvalidRecord):p.decode_instruction_at_known_boundary(b"\x05\0",0xC1)

    def test_unknown_opcode_stops(self):
        with self.assertRaises(p.InvalidRecord):p.decode_instruction_at_known_boundary(b"\xff\xff",0xC1,True)

    def test_object_call_fragment(self):
        r=p.decode_instruction_at_known_boundary(struct.pack("<HIHH",41,16,2,7),0xC1,True,40)
        self.assertTrue(r["fields"]["call_flags"]["post_candidate"])
        self.assertTrue(r["fields"]["call_flags"]["dynamic_candidate"])
        self.assertTrue(r["fields"]["call_flags"]["event_candidate"])
        self.assertIsNone(r["call_edge"])

    def test_transaction_opcode_is_profile_hypothesis(self):
        r=p.decode_instruction_at_known_boundary(struct.pack("<H",5),0xC1,True)
        self.assertEqual(r["meaning_candidate"],"commit_candidate")
        self.assertFalse(r["target_layout_validated"])

    def test_truncated_instruction_rejected(self):
        with self.assertRaises(p.InvalidRecord):p.decode_instruction_at_known_boundary(struct.pack("<HI",41,0),0xC1,True)


if __name__=="__main__":unittest.main()
