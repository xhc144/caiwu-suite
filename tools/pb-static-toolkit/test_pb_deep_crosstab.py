"""Fictional crosstab with three input columns and two rendered columns."""
import struct
import json
import tempfile
import unittest
from pathlib import Path
from pb_deep_dw import analyze, runtime_slots, Invalid
from test_pb_deep_dw import pack_records, view, SLOTS


PROFILE = {**SLOTS, 'crosstab': {name:{'slot':slot} for name,slot in
    [('columns',36),('rows',40),('values',44),('sourcenames',48)]},
    '_crosstab_layout':{'root_processing_slot':384,'processing_value':4,'foreground_root_slot':52,
                        'visual_tag':10,'record_bytes':64,'expression_list_tag':182}}


def fixture(sourcenames='region,period,amount', value_expression='sum(amount for crosstab)',
            count=0, processing=4):
    root=bytearray(938);root[:4]=b'pdw\0';struct.pack_into('<I',root,28,2)
    struct.pack_into('<H',root,384,processing)
    table=bytearray(466);rows=[root,table]
    def add(data):
        rows.append(data);return len(rows)
    for i,name in enumerate(['category','total']):
        ref=add(name.encode()+b'\0');struct.pack_into('<II',table,338+i*64+12,ref,ref)
        struct.pack_into('<H',table,338+i*64+48,i+1)
    query=add(b'PBSELECT(COLUMN(NAME="fiction.region") COLUMN(NAME="fiction.period") COLUMN(NAME="fiction.amount"))\0')
    struct.pack_into('<I',table,108,query)
    band=bytearray(64);band_id=add(band);struct.pack_into('<I',root,52,band_id)
    cross=bytearray(64);cross_id=add(cross);struct.pack_into('<II',band,16,cross_id,cross_id)
    struct.pack_into('<I',cross,16,band_id);struct.pack_into('<I',cross,32,10)
    for slot,text in [(36,'period'),(40,'region'),(44,value_expression)]:
        text_id=add(text.encode()+b'\0')
        expr=struct.pack('<III',182,text_id,count)
        ref=add(expr);struct.pack_into('<I',cross,slot,ref)
    struct.pack_into('<I',cross,48,add(sourcenames.encode()+b'\0'))
    return pack_records(rows)


class CrosstabTests(unittest.TestCase):
    def test_loader_requires_complete_explicit_caller_profile(self):
        raw={'schema_version':'pb-dw-slots-1','layout':'PDW0900',
             'evidence_status':'caller_verified_against_matching_runtime',
             'groups':{'crosstab':PROFILE['crosstab']},'crosstab_layout':PROFILE['_crosstab_layout']}
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'fictional-profile.json';p.write_text(json.dumps(raw))
            self.assertEqual(runtime_slots(p)['_crosstab_layout'],PROFILE['_crosstab_layout'])
            raw['groups']['crosstab']={};p.write_text(json.dumps(raw))
            with self.assertRaisesRegex(Invalid,'property_set_incomplete'):
                runtime_slots(p)

    def test_loader_rejects_out_of_root_processing_field(self):
        layout=dict(PROFILE['_crosstab_layout'],root_processing_slot=938)
        raw={'schema_version':'pb-dw-slots-1','layout':'PDW0900',
             'evidence_status':'caller_verified_against_matching_runtime',
             'groups':{'crosstab':PROFILE['crosstab']},'crosstab_layout':layout}
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'fictional-profile.json';p.write_text(json.dumps(raw))
            with self.assertRaisesRegex(Invalid,'root_offsets'):
                runtime_slots(p)

    def test_input_projection_and_rendered_schema_are_separate(self):
        result=analyze(view(fixture()),PROFILE)
        self.assertEqual(result['errors'],[])
        data=result['decoded_fields']['data_source'];query=data['query']
        self.assertEqual(data['column_count'],2)
        self.assertEqual(len(query['PBSELECT_columns']),3)
        self.assertEqual(data['column_schema_role'],'rendered_crosstab_schema')
        self.assertEqual(query['PBSELECT_column_order_verification'],'crosstab_source_projection_exact_match')
        self.assertEqual(query['crosstab_source_binding']['values_source_name'],'amount')
        self.assertEqual(query['crosstab_source_binding']['database_result_datatypes'],'unknown_not_executed_or_queried')
        self.assertEqual(result['status'],'partial')

    def test_no_caller_profile_keeps_disagreement_unresolved(self):
        result=analyze(view(fixture()),SLOTS)
        self.assertIn('PBSELECT_column_sequence_differs_from_table_binding',result['errors'])
        self.assertNotIn('crosstab_source_binding',result['decoded_fields']['data_source']['query'])

    def test_unknown_processing_does_not_activate_profile(self):
        result=analyze(view(fixture(processing=0)),PROFILE)
        self.assertIn('PBSELECT_column_sequence_differs_from_table_binding',result['errors'])

    def test_sourcenames_must_match_every_query_input_in_order(self):
        result=analyze(view(fixture(sourcenames='period,region,amount')),PROFILE)
        self.assertIn('PBSELECT_column_sequence_differs_from_table_binding',result['errors'])

    def test_missing_source_value_is_not_renamed_or_padded(self):
        result=analyze(view(fixture(value_expression='sum(other for crosstab)')),PROFILE)
        self.assertIn('PBSELECT_column_sequence_differs_from_table_binding',result['errors'])

    def test_unknown_aggregation_remains_unresolved(self):
        result=analyze(view(fixture(value_expression='mystery(amount)')),PROFILE)
        self.assertIn('PBSELECT_column_sequence_differs_from_table_binding',result['errors'])

    def test_expression_list_count_is_bounded(self):
        result=analyze(view(fixture(count=999)),PROFILE)
        self.assertIn('unsupported_profiled_crosstab_expression_list',result['errors'])
        self.assertIn('PBSELECT_column_sequence_differs_from_table_binding',result['errors'])


if __name__ == '__main__':
    unittest.main()
