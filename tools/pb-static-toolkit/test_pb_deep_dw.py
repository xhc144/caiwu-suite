"""Synthetic PDW0900 boundaries/references only; no commercial bytes."""
import struct
import unittest
from pb_deep_common import ObjectView, sha
from pb_deep_dw import Invalid, analyze, records, scalar, text_record


def pack_records(rows, signature=b'PDW0900\0'):
    return signature + struct.pack('<I', len(rows)) + b''.join(struct.pack('<I', len(row)) + row for row in rows)


def view(payload, split=None):
    segments = [{'object_offset': 0, 'file_offset': 1000, 'bytes': len(payload)}]
    if split is not None:
        segments = [{'object_offset': 0, 'file_offset': 1000, 'bytes': split},
                    {'object_offset': split, 'file_offset': 3000, 'bytes': len(payload)-split}]
    return ObjectView({'object_id': 'synthetic:1', 'logical_sha256': sha(payload)}, payload, segments, {})


def fixture(query=b'PBSELECT(TABLE(NAME="example") COLUMN(NAME="example.amount"))\0'):
    root = bytearray(938);root[:4] = b'pdw\0';struct.pack_into('<I', root, 28, 2)
    table = bytearray(402)
    struct.pack_into('<I', table, 108, 5)
    struct.pack_into('<II', table, 338+12, 3, 4)
    struct.pack_into('<H', table, 338+48, 1)
    return pack_records([root, table, b'amount\0', b'example.amount\0', query])


SLOTS = {'column': {}, 'compute': {}, 'compute_visual': {}, 'text_visual': {}}


class DWTests(unittest.TestCase):
    def test_valid_envelope_table_and_complete_query(self):
        result = analyze(view(fixture()), SLOTS)
        self.assertEqual(result['status'], 'partial')
        data = result['decoded_fields']['data_source']
        self.assertEqual(data['columns'][0]['name']['text']['value'], 'amount')
        self.assertEqual(data['query']['PBSELECT_columns'], ['example.amount'])
        self.assertEqual(data['query']['execution_status'], 'not_executed')

    def test_wrong_version_rejected(self):
        payload = bytearray(fixture());payload[:8] = b'PDW1000\0'
        with self.assertRaisesRegex(Invalid, 'unsupported_PDWindow_version'):
            records(payload)

    def test_length_cannot_exceed_input(self):
        payload = bytearray(fixture());struct.pack_into('<I', payload, 12, 0xffffffff)
        with self.assertRaisesRegex(Invalid, 'record_length_exceeds_payload'):
            records(payload)

    def test_trailing_bytes_are_not_ignored(self):
        with self.assertRaisesRegex(Invalid, 'consume_EOF'):
            records(fixture() + b'x')

    def test_record_count_limit(self):
        payload = bytearray(fixture());struct.pack_into('<I', payload, 8, 100001)
        with self.assertRaisesRegex(Invalid, 'record_count_limit'):
            records(payload)

    def test_table_ordinal_must_match_column_order(self):
        payload = bytearray(fixture());rows = records(payload)
        struct.pack_into('<H', payload, rows[1]['offset'] + 338 + 48, 2)
        result = analyze(view(payload), SLOTS)
        self.assertIn('column_ordinal_not_sequential', result['errors'])

    def test_PBSELECT_must_match_structural_database_names(self):
        result = analyze(view(fixture(b'PBSELECT(COLUMN(NAME="other"))\0')), SLOTS)
        self.assertIn('PBSELECT_column_sequence_differs_from_table_binding', result['errors'])
        self.assertEqual(result['status'], 'partial')
        data = result['decoded_fields']['data_source']
        self.assertEqual(data['columns'][0]['database_name']['text']['value'], 'example.amount')
        self.assertEqual(data['query']['PBSELECT_columns'], ['other'])
        self.assertEqual(data['query']['PBSELECT_column_order_verification'],
                         'mismatch_to_table_column_database_names')
        self.assertEqual(result['dimension_status']['query_column_sequence_binding'], 'mismatch')

    def test_extra_projection_preserves_query_and_structural_columns(self):
        query = b'PBSELECT(COLUMN(NAME="example.amount") COLUMN(NAME="extra"))\0'
        result = analyze(view(fixture(query)), SLOTS)
        data = result['decoded_fields']['data_source']
        self.assertEqual(data['column_count'], 1)
        self.assertEqual(data['query']['text']['value'], query[:-1].decode())
        self.assertEqual(data['query']['PBSELECT_columns'], ['example.amount', 'extra'])
        self.assertEqual(data['query']['execution_status'], 'not_executed')
        self.assertEqual(result['dimension_status']['record_envelope'], 'parsed')
        self.assertEqual(result['dimension_status']['query_column_sequence_binding'], 'mismatch')
        self.assertEqual(result['decoded_fields']['visual_objects'], [])

    def test_record_reference_not_nearby_string(self):
        payload = bytearray(fixture());rows = records(payload)
        struct.pack_into('<I', payload, rows[1]['offset'] + 338 + 12, 999)
        result = analyze(view(payload), SLOTS)
        self.assertIn('record_reference_out_of_range', result['errors'])

    def test_string_record_must_be_complete_and_single(self):
        payload = fixture();obj = view(payload)
        with self.assertRaisesRegex(Invalid, 'single_NUL'):
            text_record(obj, {'id': 3, 'offset': 0, 'bytes': 4, 'data': b'a\0b\0'})

    def test_high_bit_scalar_and_expression_wrapper_keep_text(self):
        for tag, size in [(0x80000026, 28), (0x800000f7, 16)]:
            root = bytearray(938);root[:4] = b'pdw\0'
            node = bytearray(size);struct.pack_into('<II', node, 0, tag, 3)
            payload = pack_records([root, node, b'amount * 2\0'])
            decoded = scalar(view(payload), records(payload), 2)
            self.assertEqual(decoded['layout_tag']['value'], tag)
            self.assertEqual(decoded['expression_text']['text']['value'], 'amount * 2')

    def test_physical_spans_cross_fragment_boundary(self):
        payload = fixture();rows = records(payload);target = rows[4]
        obj = view(payload, split=target['offset']+7)
        text = text_record(obj, target)
        self.assertEqual(len(text['file_spans']), 2)
        self.assertEqual(sum(s['bytes'] for s in text['file_spans']), target['bytes'])


if __name__ == '__main__':
    unittest.main()
