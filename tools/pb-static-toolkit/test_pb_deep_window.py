"""Synthetic PB9-layout boundary tests; no original program/sample bytes."""
import struct
import unittest
from pb_deep_common import ObjectView
from pb_deep_window import decode_view, structural_layout


def pool(data=b'       \0'):
    return struct.pack('<II',len(data),0)+data


def lookup(entries):
    names=bytearray(b'       \0')
    items=bytearray()
    for name,a,array,value,flags,typ in entries:
        loc=len(names);names+=name.encode('cp936')+b'\0'
        items+=struct.pack('<IIIIHH',a,array,loc,value,flags,typ)
    return b'\x10\0\x32\0\x0b\0'+pool(bytes(names))+struct.pack('<H',len(items))+items


def fixture(property_flags=0x0500):
    constants=b'       \0window\0w_synthetic\0Title A\0'
    title_offset=constants.index(b'Title A')
    head=struct.pack('<HHIIIII',0xc1,3,0x4074,8,0,0,8)
    symbol=struct.pack('<IHHHH',8,0,0x4074,0x4074,0x0101)
    types=lookup([('_initsrc',0,65535,0,0x1500,0),('window',0,65535,0,0x1540,0),
                  ('w_synthetic',0,65535,1,0x1500,0)])
    slots=struct.pack('<8H',0x85,0x8000,0,0,0,0,0,0)+struct.pack('<8H',0x81,0x8002,0,0,0,0,0,0)
    definition=struct.pack('<16H',0x8001,0xc000,*([0]*14))
    props=lookup([('width',8,65535,321,property_flags,1),
                  ('title',8,65535,0x80000000|title_offset,0x1100,6)])
    body=struct.pack('<H',0)+lookup([])+props
    data=(head+struct.pack('<H',1)+symbol+pool(constants)+lookup([])+struct.pack('<HH',2,1)+
          pool()+pool()+types+lookup([])+slots+definition+body)
    source={'object_id':'synthetic:1','name':'w_synthetic.win','extension':'win'}
    # A synthetic DAT boundary deliberately crosses a property record.
    split=len(data)-27
    segments=[{'object_offset':0,'file_offset':100,'bytes':split},
              {'object_offset':split,'file_offset':20000,'bytes':len(data)-split}]
    return ObjectView(source,data,segments,{})


class WindowLayoutTests(unittest.TestCase):
    def test_record_bound_property_values_and_split_provenance(self):
        v=fixture();r=decode_view(v)
        self.assertEqual(r['structure_status'],'parsed_bounded_complete_consumption')
        self.assertEqual(r['bytes_consumed'],len(v.payload))
        c=r['classes'][0]
        self.assertEqual(c['class_type']['name'],'w_synthetic')
        self.assertEqual(c['inherit_type']['name'],'window')
        self.assertIsNone(c['parent_type']['name'])
        props={p['name']['value']:p for p in c['properties']}
        self.assertEqual(props['width']['value'],321)
        self.assertEqual(props['title']['value'],'Title A')
        self.assertEqual(props['title']['value_status'],'parsed_constant_pool_string')
        self.assertEqual(sum(s['bytes'] for s in props['width']['record']['file_spans']),20)
        self.assertEqual(len(props['width']['record']['file_spans']),2)

    def test_truncated_payload_rejected(self):
        v=fixture();v.payload=v.payload[:-1]
        r=decode_view(v)
        self.assertEqual(r['status'],'unknown')
        self.assertEqual(r['classes'],[])

    def test_trailing_bytes_rejected(self):
        v=fixture();v.payload+=b'\0'
        r=decode_view(v)
        self.assertEqual(r['status'],'unknown')
        self.assertIn('trailing unclassified',r['unknowns'][-1])

    def test_version_gate_rejected(self):
        v=fixture();v.payload=b'\xc2'+v.payload[1:]
        self.assertEqual(decode_view(v)['status'],'unknown')

    def test_out_of_pool_name_is_not_replaced_by_nearby_string(self):
        v=fixture();layout=structural_layout(v.payload)
        p=layout['classes'][0]['properties']['items'][0]['record_offset']
        data=bytearray(v.payload);struct.pack_into('<I',data,p+8,0x7ffffffe);v.payload=bytes(data)
        self.assertEqual(decode_view(v)['status'],'unknown')

    def test_unresolved_class_type_rejected(self):
        v=fixture();layout=structural_layout(v.payload)
        data=bytearray(v.payload);struct.pack_into('<H',data,layout['classes'][0]['definition_offset'],0x8fff);v.payload=bytes(data)
        self.assertEqual(decode_view(v)['status'],'unknown')

    def test_array_property_not_interpreted_as_scalar(self):
        r=decode_view(fixture(0x2500))
        width=r['classes'][0]['properties'][0]
        self.assertEqual(width['value_status'],'unknown')
        self.assertIsNone(width['value'])

    def test_special_invalid_encoding_not_interpreted(self):
        r=decode_view(fixture(0x1d00))
        self.assertEqual(r['classes'][0]['properties'][0]['value_status'],'unknown')

    def test_invalid_literal_encoding_preserves_other_parsed_fields(self):
        v=fixture();v.payload=v.payload.replace(b'Title A',b'ab\x90\x08xyz')
        r=decode_view(v)
        self.assertEqual(r['status'],'partial')
        self.assertEqual(r['classes'][0]['properties'][0]['value'],321)
        title=r['classes'][0]['properties'][1]
        self.assertEqual(title['value_status'],'unknown_string_encoding')
        self.assertIn('value_raw_sha256',title)
        self.assertEqual(title['value_field']['bytes'],8)

    def test_descriptor_only_variant_retains_uninterpreted_words(self):
        v=fixture();layout=structural_layout(v.payload)
        data=bytearray(v.payload);struct.pack_into('<H',data,layout['slots'][0][0],0x8b);v.payload=bytes(data)
        r=decode_view(v)
        self.assertEqual(r['structure_status'],'parsed_bounded_complete_consumption')
        self.assertEqual(r['descriptor_slots'][0]['variant'],5)
        self.assertEqual(r['descriptor_slots'][0]['status'],'descriptor_only_source_reference')

    def test_inheritance_and_containment_use_separate_declared_indices(self):
        v=fixture();layout=structural_layout(v.payload)
        data=bytearray(v.payload);struct.pack_into('<H',data,layout['classes'][0]['definition_offset']+2,0x8002);v.payload=bytes(data)
        r=decode_view(v)
        relations={e['relation']:e for e in r['relationships']}
        self.assertEqual(relations['declared_inherits_type']['target_type_name'],'window')
        self.assertIsNone(relations['declared_inherits_type']['target_local_class_slot_offset'])
        self.assertEqual(relations['declared_contained_by_type']['target_type_name'],'w_synthetic')
        self.assertEqual(relations['declared_contained_by_type']['target_local_class_slot_offset'],layout['classes'][0]['slot_offset'])
        self.assertNotEqual(relations['declared_inherits_type']['declaration_field']['object_offset'],
                            relations['declared_contained_by_type']['declaration_field']['object_offset'])

    def test_noncanonical_boolean_is_not_reported_as_true(self):
        v=fixture();layout=structural_layout(v.payload)
        p=layout['classes'][0]['properties']['items'][0]['record_offset']
        data=bytearray(v.payload);struct.pack_into('<I',data,p+12,2);struct.pack_into('<H',data,p+18,7);v.payload=bytes(data)
        r=decode_view(v)
        width=r['classes'][0]['properties'][0]
        self.assertEqual(width['value_status'],'unknown')
        self.assertIn('noncanonical boolean',width['unknown_reason'])


if __name__=='__main__':
    unittest.main()
