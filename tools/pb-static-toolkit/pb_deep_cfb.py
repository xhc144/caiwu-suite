"""Read bounded CFB directory metadata in length-prefixed PB .bin resources.

Layout reference: Microsoft MS-CFB header and directory-entry specifications.
Does not read stream bodies, including licensing streams, or execute controls.
"""
import collections
import struct
import uuid
from pb_deep_common import iter_views, write_report

HEADER_SPEC = 'https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/05060311-bfce-4b12-874d-71fd4ce63aea'
DIRECTORY_SPEC = 'https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/60fe8611-66c3-496b-b70d-a504c94c9ace'
END = 0xfffffffe
FREE = 0xffffffff


def directory(data):
    data = bytes(data)
    if len(data) < 512 or data[:8] != bytes.fromhex('d0cf11e0a1b11ae1'):
        raise ValueError('invalid_CFB_header')
    version, byte_order, shift, mini_shift = struct.unpack_from('<4H', data, 26)
    if version != 3 or byte_order != 0xfffe or shift != 9 or mini_shift != 6 or len(data) % 512:
        raise ValueError('unsupported_CFB_version_or_sector_size')
    count, first_dir = struct.unpack_from('<II', data, 44)
    first_difat, difat_count = struct.unpack_from('<II', data, 68)
    if count > 109 or difat_count != 0:
        raise ValueError('extended_DIFAT_not_supported')
    difat = struct.unpack_from('<109I', data, 76)
    fat_ids = list(difat[:count])
    if len(set(fat_ids)) != count:
        raise ValueError('duplicate_FAT_sector')

    def sector(index):
        if index >= len(data)//512-1:
            raise ValueError('CFB_sector_out_of_bounds')
        return data[(index+1)*512:(index+2)*512]

    fat = []
    for index in fat_ids:
        fat.extend(struct.unpack('<128I', sector(index)))
    sectors, seen = [], set()
    while first_dir != END:
        if first_dir in seen or first_dir >= len(fat):
            raise ValueError('CFB_directory_cycle_or_invalid_FAT_index')
        seen.add(first_dir)
        sectors.append(first_dir)
        sector(first_dir)
        first_dir = fat[first_dir]
    entries = []
    for sector_id in sectors:
        for slot in range(4):
            offset = (sector_id+1)*512 + slot*128
            entry = data[offset:offset+128]
            size, = struct.unpack_from('<H', entry, 64)
            kind = entry[66]
            if kind == 0:
                continue
            if kind not in {1, 2, 5} or size < 2 or size > 64 or size % 2 or entry[size-2:size] != b'\0\0':
                raise ValueError('invalid_CFB_directory_entry')
            name = entry[:size-2].decode('utf-16le')
            left, right, child = struct.unpack_from('<III', entry, 68)
            start, stream_bytes = struct.unpack_from('<IQ', entry, 116)
            entries.append({'directory_id': sectors.index(sector_id)*4+slot,
                            'frame_relative_offset': offset, 'name': name,
                            'name_bytes': size, 'object_type': kind, 'left': left,
                            'right': right, 'child': child,
                            'class_id': str(uuid.UUID(bytes_le=entry[80:96])),
                            'stream_start_sector_raw': start, 'stream_bytes_declared': stream_bytes,
                            'stream_body_status': 'not_read_licensing_boundary' if 'LICENSE' in name.upper()
                            else 'not_read_application_specific_semantics_unknown'})
    ids = {entry['directory_id'] for entry in entries}
    for entry in entries:
        if any(pointer != FREE and pointer not in ids for pointer in (entry['left'], entry['right'], entry['child'])):
            raise ValueError('CFB_directory_reference_unallocated')
    if not entries or entries[0]['directory_id'] != 0 or entries[0]['object_type'] != 5:
        raise ValueError('CFB_root_entry_missing')
    return {'version': version, 'sector_bytes': 512, 'FAT_sectors': fat_ids,
            'directory_sectors': sectors, 'entries': entries, 'stream_bodies_read': False}


def analyze(view):
    frames, errors = [], []
    position = 0
    while position < len(view.payload):
        try:
            if position+4 > len(view.payload):
                raise ValueError('resource_frame_header_truncated')
            size, = struct.unpack_from('<I', view.payload, position)
            if position+4+size > len(view.payload):
                raise ValueError('resource_frame_out_of_bounds')
            parsed = directory(view.payload[position+4:position+4+size])
            for entry in parsed['entries']:
                offset = position+4+entry['frame_relative_offset']
                entry['directory_entry_evidence'] = view.field(offset, 128, None, 'MS_CFB_directory_entry')
                entry['name_evidence'] = view.field(offset, entry['name_bytes'], entry['name'], 'CFB_UTF16_directory_name')
                entry['class_id_evidence'] = view.field(offset+80, 16, entry['class_id'], 'CFB_storage_class_GUID')
            frames.append({'length': view.field(position, 4, size, 'CFB_frame_length'),
                           'object_offset': position+4, **parsed})
            position += 4+size
        except (ValueError, struct.error, UnicodeDecodeError) as error:
            errors.append({'object_offset': position, 'error': str(error)})
            break
    return {'source': view.source, 'status': 'partial',
            'directory_status': 'parsed' if not errors and position == len(view.payload) else 'partial',
            'frames': frames, 'errors': errors,
            'unknowns': ['application_specific_control_stream_properties',
                         'binding_of_CFB_frame_to_window_control'],
            'excluded': ['license_stream_contents', 'control_execution']}


def main():
    objects = [analyze(view) for view in iter_views() if view.source['extension'] == 'bin']
    summary = {'objects': len(objects), 'directory_status': dict(collections.Counter(o['directory_status'] for o in objects)),
               'frames': sum(len(o['frames']) for o in objects),
               'directory_entries': sum(len(f['entries']) for o in objects for f in o['frames']),
               'storage_class_id_counts': dict(collections.Counter(e['class_id'] for o in objects for f in o['frames']
                                                                 for e in f['entries'] if e['object_type'] == 1)),
               'format_sources': [HEADER_SPEC, DIRECTORY_SPEC], 'stream_bodies_read': False}
    write_report('cfb-analysis.json', objects, summary)
    print(summary)


if __name__ == '__main__':
    main()
