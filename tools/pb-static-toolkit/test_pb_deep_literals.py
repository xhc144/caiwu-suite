"""Fictional instruction/property fixtures; no target bytes or target profile."""
import struct
import unittest
from pb_deep_common import ObjectView
from pb_deep_literals import routine_candidates


def fixture(prefix=b'', literal_pointer=24, descriptor_kind=12, name_pointer=8,
            literal=None, name_upper=0, suffix=b''):
    literal = '虚构菜单'.encode('cp936')+b'\0' if literal is None else literal
    code = prefix + struct.pack('<HHHHHHHIHHHH',
        30,29,16,name_upper,287,2,56,literal_pointer,304,1,133,0) + suffix
    pool = b'padding\0text\0'+b'\0'*3+struct.pack('<IH',name_pointer,7)+b'\0'*2+literal
    mapping=struct.pack('<IHH',16,descriptor_kind,1)
    payload=code+pool+mapping
    split=len(code)+25
    view=ObjectView({'object_id':'fictional:1'},payload,
        [{'object_offset':0,'file_offset':1000,'bytes':split},
         {'object_offset':split,'file_offset':5000,'bytes':len(payload)-split}],{})
    routine={'code_offset':0,'code_bytes':len(code),'line_offset':len(code),'line_count':0,
             'constants':{'data':pool,'offset':len(code),'map':mapping,'map_offset':len(code)+len(pool)}}
    return view,routine


class LiteralAssignmentTests(unittest.TestCase):
    def test_record_bound_chinese_assignment_and_physical_spans(self):
        result,errors=routine_candidates(*fixture())
        self.assertEqual(errors,[])
        self.assertEqual(len(result),1)
        item=result[0]
        self.assertEqual(item['property_name']['value'],'text')
        self.assertEqual(item['literal_text']['value'],'虚构菜单')
        self.assertEqual(len(item['literal_text']['file_spans']),2)
        self.assertFalse(item['effective_property_value_proven'])
        self.assertIsNone(item['event_binding'])

    def test_pointer_cannot_fall_back_to_nearby_string(self):
        result,errors=routine_candidates(*fixture(literal_pointer=999))
        self.assertEqual(result,[])
        self.assertIn('outside declared constant buffer',errors[0])

    def test_descriptor_map_kind_must_be_exact(self):
        result,errors=routine_candidates(*fixture(descriptor_kind=13))
        self.assertEqual(result,[])
        self.assertIn('constant_map_not_exact',errors[0])

    def test_missing_property_name_remains_unknown(self):
        result,errors=routine_candidates(*fixture(name_pointer=0xffffffff))
        self.assertEqual(result,[])
        self.assertEqual(errors,['property_name_absent_sentinel'])

    def test_tagged_literal_pointer_keeps_raw_pointer(self):
        result,errors=routine_candidates(*fixture(literal_pointer=0x80000018))
        self.assertEqual(errors,[])
        self.assertEqual(result[0]['literal_reference']['value'],0x80000018)
        self.assertEqual(result[0]['literal_text']['value'],'虚构菜单')

    def test_nonzero_descriptor_upper_operand_rejected(self):
        result,errors=routine_candidates(*fixture(name_upper=1))
        self.assertEqual(result,[])
        self.assertEqual(errors,['unsupported_assignment_shape_operands'])

    def test_branch_into_middle_rejects_shape(self):
        result,errors=routine_candidates(*fixture(prefix=struct.pack('<HH',1,6)))
        self.assertEqual(result,[])
        self.assertEqual(errors,['branch_enters_assignment_shape_interior'])

    def test_branch_to_shape_start_does_not_prove_execution(self):
        result,errors=routine_candidates(*fixture(prefix=struct.pack('<HH',1,4)))
        self.assertEqual(errors,[])
        self.assertFalse(result[0]['runtime_execution_proven'])

    def test_unknown_instruction_prevents_resynchronization(self):
        result,errors=routine_candidates(*fixture(suffix=struct.pack('<H',600)))
        self.assertEqual(result,[])
        self.assertEqual(errors,['routine_boundary_audit_failed'])

    def test_invalid_cp936_does_not_invent_caption(self):
        result,errors=routine_candidates(*fixture(literal=b'bad\x90\x08\0'))
        self.assertEqual(result,[])
        self.assertIn('invalid cp936',errors[0])


if __name__ == '__main__':
    unittest.main()
