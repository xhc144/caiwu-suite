import unittest
from unittest.mock import patch
from pb_deep_common import ObjectView
from pb_deep_relations import analyze


class RelationshipTests(unittest.TestCase):
    def fixture(self):
        classes=[{'slot':[0,0x8000],'slot_offset':0,'definition':[0x8008,0xc000],'definition_offset':32},
                 {'slot':[0,0x8001],'slot_offset':16,'definition':[0x8008,0x8000],'definition_offset':64}]
        view=ObjectView({'object_id':'synthetic'},b'\0'*128,
                        [{'object_offset':0,'file_offset':100,'bytes':128}],{})
        return view,{'classes':classes}

    def test_containment_uses_type_index_not_same_name(self):
        view,layout=self.fixture()
        resolve=lambda raw:{'name':'same_name','raw':raw,'resolution':'none_sentinel' if raw==0xc000 else 'local_type_table_index'}
        with patch('pb_deep_relations.structural_layout',return_value=layout),patch('pb_deep_relations.build_type_resolver',return_value=resolve):
            result=analyze(view)
        edge=result['classes'][1]['containment']
        self.assertEqual(edge['target_class_id'],'synthetic:class:0')
        self.assertEqual(edge['field']['file_spans'][0]['file_offset'],166)
        self.assertEqual(result['call_edges'],[])

    def test_external_inheritance_stays_unresolved_despite_name(self):
        view,layout=self.fixture()
        resolve=lambda raw:{'name':'same_name','raw':raw,'resolution':'local_type_table_index'}
        with patch('pb_deep_relations.structural_layout',return_value=layout),patch('pb_deep_relations.build_type_resolver',return_value=resolve):
            result=analyze(view)
        edge=result['classes'][0]['declared_inheritance']
        self.assertEqual(edge['external_class_target_status'],'unknown_not_selected_by_name')
        self.assertNotIn('target_class_id',edge)


if __name__=='__main__':unittest.main()
