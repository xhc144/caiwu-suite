"""Synthetic known-boundary/descriptor tests, no original commercial bytes."""
import struct
import unittest
import hashlib
from pb_deep_common import ObjectView
from pb_deep_window import LayoutError
from pb_deep_calls import (walk,audit_boundaries,decode_descriptor,decode_super,
                           PB90_ARG_WORDS,PREFIX_ARG_WORDS)


def descriptor_fixture():
    code=struct.pack('<HIHH',41,32,2,4)
    pool=bytearray(40)
    pool[8:18]=b'gf_sample\0'
    struct.pack_into('<HHI',pool,32,12,0xc000,8)
    data=code+b'\0'*10+pool+struct.pack('<IHH',32,13,1)
    split=55
    view=ObjectView({'object_id':'synthetic:1'},data,
                    [{'object_offset':0,'file_offset':1000,'bytes':split},
                     {'object_offset':split,'file_offset':5000,'bytes':len(data)-split}],{})
    routine={'constants':{'offset':20,'data':bytes(pool),'map_offset':60,
                          'map':struct.pack('<IHH',32,13,1)}}
    return view,routine


class CallBoundaryTests(unittest.TestCase):
    def test_factual_pb90_map_has_expected_shape(self):
        self.assertEqual(len(PB90_ARG_WORDS),547)
        self.assertEqual(sum(PB90_ARG_WORDS),537)
        self.assertEqual(PB90_ARG_WORDS[18],5)
        self.assertEqual(PB90_ARG_WORDS[41],4)
        self.assertEqual(PB90_ARG_WORDS[297],1)
        self.assertEqual(hashlib.sha256(bytes(PB90_ARG_WORDS)).hexdigest(),
                         'e5baf8277cd6485b1bd9e80d4f05fa823529dce71cf6e6c437476092b958e78f')

    def test_exact_sequence_and_byte_jump_debug_boundaries(self):
        code=struct.pack('<HHHHHHH',47,1,3,8,0,0,0)
        debug=struct.pack('<4H',1,0,2,8)
        r=audit_boundaries(code,debug)
        self.assertEqual(r['status'],'parsed')
        self.assertEqual(r['boundary_status'],'parsed')
        self.assertEqual(r['consumed'],len(code))
        self.assertEqual(r['jump_target_count'],1)
        self.assertEqual(r['debug_record_count'],2)

    def test_jump_into_operand_rejected_for_broad_decode(self):
        code=struct.pack('<HHHHHHH',47,1,3,6,0,0,0)
        r=audit_boundaries(code)
        self.assertEqual(r['boundary_status'],'partial')
        self.assertEqual(r['invalid_jump_targets'][0]['target'],6)

    def test_debug_into_operand_rejected(self):
        code=struct.pack('<HHHHHHH',47,1,3,8,0,0,0)
        r=audit_boundaries(code,struct.pack('<HH',1,2))
        self.assertEqual(r['boundary_status'],'partial')

    def test_unknown_opcode_stops_without_resynchronizing(self):
        code=struct.pack('<HHIHH',999,41,32,0,0)
        r=walk(code)
        self.assertEqual(r['status'],'partial')
        self.assertEqual(r['consumed'],0)
        self.assertEqual(r['instructions'],[])
        self.assertEqual(r['stop']['opcode'],999)

    def test_small_known_subset_stops_at_first_unlisted_opcode(self):
        code=struct.pack('<7H',18,0,0,0xc000,8,0,312)+struct.pack('<H',0)
        r=walk(code,PREFIX_ARG_WORDS)
        self.assertEqual(r['consumed'],12)
        self.assertEqual(r['stop']['opcode'],312)
        self.assertEqual(len(r['instructions']),1)

    def test_truncated_operands_and_odd_tail(self):
        self.assertEqual(walk(struct.pack('<HH',41,0))['stop']['reason'],'instruction_operands_exceed_routine')
        self.assertEqual(walk(b'\x01')['stop']['reason'],'odd_or_truncated_opcode')

    def test_pb9_version_gate_not_replaced_with_other_version(self):
        self.assertEqual(walk(b'\0'*6,version=0xc4)['status'],'unknown')

    def test_descriptor_bound_to_same_pool_with_split_physical_span(self):
        view,rt=descriptor_fixture()
        r=decode_descriptor(view,rt,0,32,2,4,lambda raw:{'raw':raw,'resolution':'none_sentinel'})
        self.assertEqual(r['name']['value'],'gf_sample')
        self.assertEqual(r['dispatch_slot_candidate']['value'],12)
        self.assertEqual(r['descriptor_type_ref']['value'],0xc000)
        self.assertEqual(len(r['descriptor']['file_spans']),2)
        self.assertEqual(r['constant_map_matches'][0]['kind_raw'],13)
        self.assertIsNone(r['unique_callee_edge'])
        self.assertEqual(r['receiver_type_status'],'not_inferred')

    def test_descriptor_bounds_and_absent_name_sentinel(self):
        view,rt=descriptor_fixture()
        with self.assertRaises(LayoutError):
            decode_descriptor(view,rt,0,34,2,0,lambda raw:{})
        pool=bytearray(rt['constants']['data']);struct.pack_into('<I',pool,36,0xffff);rt['constants']['data']=bytes(pool)
        with self.assertRaisesRegex(LayoutError,'absent sentinel'):
            decode_descriptor(view,rt,0,32,2,0,lambda raw:{})

    def test_name_pointer_not_attributed_to_neighboring_bytes(self):
        view,rt=descriptor_fixture()
        pool=bytearray(rt['constants']['data']);struct.pack_into('<I',pool,36,41);rt['constants']['data']=bytes(pool)
        with self.assertRaises(LayoutError):
            decode_descriptor(view,rt,0,32,2,0,lambda raw:{})


if __name__=='__main__':
    unittest.main()
