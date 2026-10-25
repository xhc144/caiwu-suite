import contextlib
import csv
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from pb_deep_common import configure,iter_views,sha
from pb_deep_dw import runtime_slots,Invalid,analyze,records
from test_pb_deep_dw import fixture as dw_fixture,view as dw_view
from test_pb_deep_window import fixture as window_fixture
from toolkit import main


def container(payload):
    name=b'w_fixture_only.win\0';blocks=(len(payload)+501)//502
    data=bytearray(4096+blocks*512)
    data[:16]=b'HDR*PowerBuilder';data[18:22]=b'0600';data[512:516]=b'FRE*';data[1024:1028]=b'NOD*'
    entry=b'ENT*0600'+struct.pack('<IIIHH',4096,len(payload),0,0,len(name))+name
    struct.pack_into('<H',data,1040,3040-len(entry));struct.pack_into('<H',data,1044,1)
    data[1056:1056+len(entry)]=entry
    for i in range(blocks):
        offset=4096+i*512;chunk=payload[i*502:(i+1)*502]
        data[offset:offset+4]=b'DAT*';struct.pack_into('<IH',data,offset+4,offset+512 if i+1<blocks else 0,len(chunk))
        data[offset+10:offset+10+len(chunk)]=chunk
    return bytes(data)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)

    def setup_input(self,duplicate=False):
        data=container(window_fixture().payload);payload=self.root/'payload';payload.mkdir()
        rows=[]
        for i in range(2 if duplicate else 1):
            name=str(i)+'.pbd';(payload/name).write_bytes(data)
            rows.append({'record':str(i+1),'installer':'synthetic','original_destination':'<INSTALL>\\fixture.pbd',
                         'bytes':len(data),'sha256':sha(data),'materialized_relative_path':name})
        manifest=self.root/'manifest.csv'
        with manifest.open('w',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        return payload,manifest

    def test_probe_decode_pipeline_and_hash_dedup_aliases(self):
        payload,manifest=self.setup_input(True);reports=self.root/'reports';output=self.root/'deep'
        with contextlib.redirect_stdout(io.StringIO()):
            main(['probe','--manifest',str(manifest),'--installer-id','synthetic','--payload-root',str(payload),'--output',str(reports)])
            main(['analyze','--manifest',str(reports/'selected-manifest.csv'),'--payload-root',str(payload),
                  '--container-reports',str(reports),'--output',str(output),'--stages','classify','windows','functions','calls','relations','cfb','dw'])
        result=json.loads((output/'window-analysis.json').read_text())
        self.assertEqual(len(result['objects']),1)
        self.assertEqual(len(result['objects'][0]['source']['record_aliases']),2)
        self.assertEqual(result['objects'][0]['classes'][0]['properties'][0]['value'],321)

    def test_tampered_report_segment_is_rejected_against_raw_DAT(self):
        payload,manifest=self.setup_input();reports=self.root/'reports'
        with contextlib.redirect_stdout(io.StringIO()):
            main(['probe','--manifest',str(manifest),'--payload-root',str(payload),'--output',str(reports)])
        index=json.loads((reports/'index.json').read_text());path=reports/index['records'][0]['report'];report=json.loads(path.read_text())
        report['libraries'][0]['objects'][0]['data_segments'][0]['file_offset']+=1;path.write_text(json.dumps(report))
        configure(manifest,payload,reports,self.root/'deep')
        with self.assertRaisesRegex(ValueError,'raw DAT chain'):
            list(iter_views())

    def test_no_DW_profile_still_parses_columns_query_but_not_named_properties(self):
        configure(self.root/'unused.csv',self.root/'payload',self.root/'reports',self.root/'deep')
        slots=runtime_slots();result=analyze(dw_view(dw_fixture()),slots)
        self.assertEqual(result['decoded_fields']['data_source']['column_count'],1)
        self.assertEqual(result['dimension_status']['named_visual_properties'],'unknown')

    def test_external_profile_requires_explicit_evidence_gate(self):
        path=self.root/'profile.json';path.write_text(json.dumps({'schema_version':'pb-dw-slots-1','layout':'PDW0900',
                  'evidence_status':'unverified','groups':{'column':{'synthetic_property':{'slot':4}}}}))
        with self.assertRaisesRegex(Invalid,'not_verified'):runtime_slots(path)
        data=json.loads(path.read_text());data['evidence_status']='caller_verified_against_matching_runtime';path.write_text(json.dumps(data))
        self.assertEqual(runtime_slots(path)['column']['synthetic_property']['slot'],4)

    def test_plus52_is_uninterpreted_dword_not_storage_type(self):
        data=bytearray(dw_fixture());table=records(data)[1]
        struct.pack_into('<I',data,table['offset']+338+52,0x12345678)
        result=analyze(dw_view(bytes(data)),{key:{} for key in ('column','compute','compute_visual','text_visual')})
        column=result['decoded_fields']['data_source']['columns'][0]
        self.assertNotIn('type_raw',column)
        self.assertEqual(column['uninterpreted_plus52_raw']['value'],0x12345678)
        self.assertEqual(column['uninterpreted_plus52_raw']['bytes'],4)


if __name__=='__main__':unittest.main()
