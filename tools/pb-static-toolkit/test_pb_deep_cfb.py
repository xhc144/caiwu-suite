import struct
import unittest
from pb_deep_cfb import directory


def fixture():
    data = bytearray(1536)
    data[:8] = bytes.fromhex('d0cf11e0a1b11ae1')
    struct.pack_into('<4H', data, 26, 3, 0xfffe, 9, 6)
    struct.pack_into('<II', data, 44, 1, 1)
    struct.pack_into('<II', data, 68, 0xfffffffe, 0)
    struct.pack_into('<109I', data, 76, 0, *([0xffffffff]*108))
    struct.pack_into('<128I', data, 512, 0xfffffffd, 0xfffffffe, *([0xffffffff]*126))
    name = 'Root Entry\0'.encode('utf-16le')
    data[1024:1024+len(name)] = name
    struct.pack_into('<HBBIII', data, 1088, len(name), 5, 1, 0xffffffff, 0xffffffff, 0xffffffff)
    return data


class CFBTests(unittest.TestCase):
    def test_valid_directory_and_exact_offset(self):
        result = directory(fixture())
        self.assertEqual(result['entries'][0]['frame_relative_offset'], 1024)
        self.assertEqual(result['entries'][0]['name'], 'Root Entry')
        self.assertFalse(result['stream_bodies_read'])

    def test_cycle_is_rejected(self):
        data = fixture()
        struct.pack_into('<I', data, 516, 1)
        with self.assertRaisesRegex(ValueError, 'cycle'):
            directory(data)

    def test_directory_reference_to_unallocated_is_rejected(self):
        data = fixture()
        struct.pack_into('<I', data, 1100, 3)
        with self.assertRaisesRegex(ValueError, 'unallocated'):
            directory(data)

    def test_version_not_guessed(self):
        data = fixture()
        struct.pack_into('<H', data, 26, 4)
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            directory(data)


if __name__ == '__main__':
    unittest.main()
