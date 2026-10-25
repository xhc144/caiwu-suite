import csv
import hashlib
import json
import struct
import tempfile
import unittest
import zlib
from unittest import mock
from pathlib import Path
from extract_manifest import decompress_verified,recover,pe_overlay


def frame(destination,payload,mask=0x13572468):
    metadata=('OBJECT_TYPE=FILE\r\nPACKAGE_ID=1\r\nID=1\r\nDESTINATION='+destination+'\r\nFILE_AGE=123').encode()
    return struct.pack('<I',len(metadata)^mask)+metadata+struct.pack('<I',len(payload)^mask)+payload


def installer(stream):
    data=bytearray(1024);data[:2]=b'MZ';struct.pack_into('<I',data,60,128)
    data[128:132]=b'PE\0\0';struct.pack_into('<H',data,134,1);struct.pack_into('<H',data,148,224)
    struct.pack_into('<H',data,152,0x10b);struct.pack_into('<I',data,212,512)
    struct.pack_into('<II',data,152+224+16,512,512)
    return bytes(data)+zlib.compress(stream)+b'fake-tail'


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)

    def manifest(self,payloads):
        rows=[{'record':str(i+1),'installer':'synthetic','original_destination':'<INSTALL>\\same.pbd',
               'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
               'materialized_relative_path':str(i+1)+'-same.pbd'} for i,data in enumerate(payloads)]
        path=self.root/'manifest.csv'
        with path.open('w',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        return path,rows

    def test_pe_overlay_is_calculated_and_cache_reused(self):
        blob=installer(b'synthetic stream only');path=self.root/'input.exe';path.write_bytes(blob)
        cache=self.root/'stream';expected=hashlib.sha256(blob).hexdigest()
        self.assertEqual(pe_overlay(blob),1024)
        first=decompress_verified(path,expected,cache)
        self.assertEqual(cache.read_bytes(),b'synthetic stream only')
        self.assertEqual(first['trailing_installer_bytes'],9)
        self.assertEqual(decompress_verified(path,expected,cache),first)

    def test_wrong_package_hash_rejected_before_cache(self):
        path=self.root/'input.exe';path.write_bytes(installer(b'x'))
        with self.assertRaisesRegex(ValueError,'SHA256 mismatch'):
            decompress_verified(path,'0'*64,self.root/'stream')
        self.assertFalse((self.root/'stream').exists())

    def test_decompression_limit_removes_partial_output(self):
        path=self.root/'input.exe';blob=installer(b'x'*2000);path.write_bytes(blob)
        with self.assertRaisesRegex(ValueError,'byte limit'):
            decompress_verified(path,hashlib.sha256(blob).hexdigest(),self.root/'stream',32)
        self.assertFalse((self.root/'stream').exists());self.assertFalse((self.root/'stream.partial').exists())

    def test_same_name_different_hash_records_and_inferred_mask(self):
        payloads=[b'HDR*aaaa',b'HDR*bbbb'];manifest,rows=self.manifest(payloads)
        stream=self.root/'stream';stream.write_bytes(b''.join(frame(r['original_destination'],p) for r,p in zip(rows,payloads)))
        result=recover(stream,manifest,'synthetic',self.root/'output',self.root/'evidence.json')
        self.assertEqual(len(result['payload_records']),2)
        self.assertEqual((self.root/'output/1-same.pbd').read_bytes(),payloads[0])
        self.assertEqual((self.root/'output/2-same.pbd').read_bytes(),payloads[1])
        self.assertEqual(result['inferred_length_xor'],0x13572468)

    def test_digit_in_encoded_length_does_not_extend_age(self):
        data=b'HDR*fake';manifest,rows=self.manifest([data]);mask=0x11223300|(len(data)^ord('5'))
        stream=self.root/'stream';stream.write_bytes(frame(rows[0]['original_destination'],data,mask))
        result=recover(stream,manifest,'synthetic',self.root/'output',self.root/'evidence.json')
        self.assertEqual(result['inferred_length_xor'],mask)

    def test_mismatch_does_not_write_any_payload(self):
        manifest,rows=self.manifest([b'expected']);stream=self.root/'stream'
        stream.write_bytes(frame(rows[0]['original_destination'],b'not same'))
        with self.assertRaisesRegex(ValueError,'unique'):
            recover(stream,manifest,'synthetic',self.root/'output',self.root/'evidence.json')
        self.assertFalse((self.root/'output').exists())

    def test_path_escape_rejected(self):
        data=b'fake';manifest,rows=self.manifest([data]);rows[0]['materialized_relative_path']='../escape.pbd'
        with manifest.open('w',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        path=self.root/'stream';path.write_bytes(frame(rows[0]['original_destination'],data))
        with self.assertRaisesRegex(ValueError,'escapes'):
            recover(path,manifest,'synthetic',self.root/'output',self.root/'evidence.json')

    def test_preexisting_partial_is_never_deleted(self):
        path=self.root/'input.exe';blob=installer(b'synthetic');path.write_bytes(blob)
        partial=self.root/'stream.partial';partial.write_bytes(b'owned by another writer')
        with self.assertRaises(FileExistsError):
            decompress_verified(path,hashlib.sha256(blob).hexdigest(),self.root/'stream')
        self.assertEqual(partial.read_bytes(),b'owned by another writer')

    def test_concurrent_cache_publication_is_never_replaced(self):
        path=self.root/'input.exe';blob=installer(b'synthetic');path.write_bytes(blob)
        cache=self.root/'stream'
        def race(source,destination):
            Path(destination).write_bytes(b'concurrent publication')
            raise FileExistsError('another writer won')
        with mock.patch('extract_manifest.os.link',side_effect=race),self.assertRaises(FileExistsError):
            decompress_verified(path,hashlib.sha256(blob).hexdigest(),cache)
        self.assertEqual(cache.read_bytes(),b'concurrent publication')
        self.assertFalse((self.root/'stream.partial').exists())

    def test_duplicate_output_paths_rejected_before_any_payload_write(self):
        payloads=[b'HDR*aaaa',b'HDR*bbbb'];manifest,rows=self.manifest(payloads)
        rows[1]['materialized_relative_path']=rows[0]['materialized_relative_path']
        with manifest.open('w',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        stream=self.root/'stream';stream.write_bytes(b''.join(frame(r['original_destination'],p) for r,p in zip(rows,payloads)))
        with self.assertRaisesRegex(ValueError,'duplicate selected output'):
            recover(stream,manifest,'synthetic',self.root/'output',self.root/'evidence.json')
        self.assertFalse((self.root/'output').exists())


if __name__=='__main__':unittest.main()
