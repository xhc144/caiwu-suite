import struct
import unittest
from pb_deep_common import ObjectView
from pb_deep_classify import classify


def view(data, ext):
    return ObjectView({'extension': ext}, data,
                      [{'object_offset': 0, 'file_offset': 100, 'bytes': len(data)}], {})


class ClassificationTests(unittest.TestCase):
    def test_kind_extension_mismatch_is_not_accepted(self):
        result = classify(view(struct.pack('<6H', 193, 3, 0x4061, 0, 8, 0), 'win'))
        self.assertEqual(result['classification_status'], 'partial')
        self.assertIn('unrecognized_compiled_header_for_extension', result['errors'])

    def test_two_length_prefixed_frames_and_offset_mapping(self):
        cfb = bytes.fromhex('d0cf11e0a1b11ae1') + b'1234'
        frame = struct.pack('<I', len(cfb)) + cfb
        result = classify(view(frame + frame, 'bin'))
        frames = result['fields']['compound_frames']
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[1]['signature']['file_spans'][0]['file_offset'], 120)
        self.assertTrue(result['fields']['entire_payload_framing_verified'])

    def test_truncated_frame_is_partial(self):
        result = classify(view(struct.pack('<I', 100) + bytes.fromhex('d0cf11e0a1b11ae1'), 'bin'))
        self.assertEqual(result['classification_status'], 'partial')
        self.assertFalse(result['fields']['entire_payload_framing_verified'])

    def test_datawindow_version_is_gated(self):
        self.assertEqual(classify(view(b'PDW0900\0', 'dwo'))['classification_status'], 'parsed')
        self.assertEqual(classify(view(b'PDW0800\0', 'dwo'))['classification_status'], 'partial')


if __name__ == '__main__':
    unittest.main()
