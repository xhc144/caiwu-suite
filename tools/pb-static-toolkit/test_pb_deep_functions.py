import struct
import unittest
from pb_deep_common import ObjectView
from pb_deep_functions import decode_definition,LayoutError


def fixture():
    data=bytearray(128)
    # A deliberately different +4 word guards against accidentally using PB5's parameter offset.
    struct.pack_into('<IIIII',data,0,0,0xdeadbeef,0,65535,0xdeadbeef)
    struct.pack_into('<HBBH',data,28,2,1,1,123)
    struct.pack_into('<H',data,44,65535)
    names=b'on_test\0arg\0'
    data[64:64+len(names)]=names
    struct.pack_into('<IIHBB',data,96,8,65535,6,2,0)
    view=ObjectView({},bytes(data),[{'object_offset':0,'file_offset':1000,'bytes':128}],{})
    layout={'function_const':{'offset':64,'data':names},'parameter_const':{'offset':96,'data':bytes(data[96:108])}}
    return view,layout


class FunctionTableTests(unittest.TestCase):
    def test_pb9_parameter_offset_and_exact_binding(self):
        view,layout=fixture()
        result=decode_definition(view,layout,0,lambda t:{'raw':t})
        self.assertEqual(result['parameters'][0]['name']['value'],'arg')
        self.assertEqual(result['parameters'][0]['mode'],'reference')
        self.assertTrue(result['is_event_definition'])
        self.assertEqual(result['name']['file_spans'][0]['file_offset'],1064)
        self.assertEqual(result['call_edges'],[])

    def test_parameter_pool_boundary_is_enforced(self):
        view,layout=fixture();layout['parameter_const']['data']=b''
        with self.assertRaisesRegex(LayoutError,'parameter list'):
            decode_definition(view,layout,0,lambda t:{'raw':t})

    def test_absent_alias_does_not_read_unused_library_pointer(self):
        view,layout=fixture()
        result=decode_definition(view,layout,0,lambda t:{'raw':t})
        self.assertNotIn('external_library',result)


if __name__=='__main__':
    unittest.main()
