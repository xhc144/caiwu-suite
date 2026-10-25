"""Classify verified local PB objects without inferring business behavior."""
import collections
import struct
from pb_deep_common import iter_views, write_report

CATEGORIES = {'win': 'window', 'men': 'menu', 'udo': 'user_object',
              'fun': 'global_function', 'dwo': 'compiled_datawindow',
              'str': 'structure', 'apl': 'application', 'bin': 'compound_resource'}
EXPECTED_KIND = {'win': {0x4074}, 'men': {0x4098}, 'fun': {0x4061},
                 'str': {0x4062}, 'apl': {0x406c},
                 'udo': {0x4063, 0x4073, 0x4072, 0x406b, 0x40a9, 0x4088}}


def classify(view):
    data, ext = view.payload, view.source['extension']
    fields, errors = {}, []
    if ext in EXPECTED_KIND:
        if len(data) < 12:
            errors.append('compiled_header_truncated')
        else:
            words = struct.unpack_from('<6H', data)
            fields['header_words_raw'] = view.field(0, 12, list(words), 'raw_six_u16_not_full_object_schema')
            fields['kind_tag_raw'] = view.field(4, 2, words[2], 'empirically_consistent_with_directory_extension')
            if words[0:2] != (193, 3) or words[2] not in EXPECTED_KIND[ext]:
                errors.append('unrecognized_compiled_header_for_extension')
    elif ext == 'dwo':
        fields['signature'] = view.field(0, 8, data[:8].decode('ascii', errors='replace'),
                                         'compiled_DataWindow_PDW0900_marker')
        if data[:8] != b'PDW0900\0':
            errors.append('unrecognized_compiled_DataWindow_signature')
    elif ext == 'bin':
        frames = []
        position = 0
        while position < len(data):
            if position + 12 > len(data):
                errors.append('truncated_resource_frame_header')
                break
            size, = struct.unpack_from('<I', data, position)
            if position + 4 + size > len(data) or data[position+4:position+12] != bytes.fromhex('d0cf11e0a1b11ae1'):
                errors.append('invalid_resource_frame_length_or_CFB_signature')
                break
            frames.append({'length': view.field(position, 4, size, 'length_prefixed_CFB_frame_bytes'),
                           'signature': view.field(position+4, 8, 'D0CF11E0A1B11AE1', 'MS_CFB_signature'),
                           'frame_object_offset': position+4, 'frame_bytes': size,
                           'frame_spans': view.spans(position+4, size),
                           'properties_status': 'unknown_CFB_application_stream_semantics_not_decoded'})
            position += 4 + size
        fields['compound_frames'] = frames
        fields['entire_payload_framing_verified'] = position == len(data) and not errors
    else:
        errors.append('unknown_extension')
    return {'source': view.source, 'category': CATEGORIES.get(ext, 'unknown'),
            'category_basis': 'directory_extension_plus_verified_structure_tag',
            'classification_status': 'parsed' if not errors else 'partial',
            'object_semantic_status': 'unknown', 'fields': fields, 'errors': errors,
            'unknowns': ['full_object_semantics', 'runtime_active_library_selection']}


def main():
    objects = [classify(view) for view in iter_views()]
    hashes, names = collections.defaultdict(list), collections.defaultdict(list)
    for obj in objects:
        source = obj['source']
        hashes[source['logical_sha256']].append(source['object_id'])
        names[source['name'].casefold()].append(source['object_id'])
    repeated_names = {name: ids for name, ids in names.items() if len(ids) > 1}
    repeated_hashes = {value: ids for value, ids in hashes.items() if len(ids) > 1}
    for obj in objects:
        source = obj['source']
        obj['same_name_object_ids'] = names[source['name'].casefold()]
        obj['same_payload_object_ids'] = hashes[source['logical_sha256']]
        obj['same_name_does_not_imply_same_payload_or_runtime_binding'] = True
    summary = {'objects': len(objects), 'categories': dict(collections.Counter(o['category'] for o in objects)),
               'classification_status': dict(collections.Counter(o['classification_status'] for o in objects)),
               'unique_logical_sha256': len(hashes), 'exact_duplicate_payload_groups': repeated_hashes,
               'unique_casefolded_names': len(names), 'repeated_name_groups': len(repeated_names),
               'records_in_repeated_name_groups': sum(map(len, repeated_names.values())),
               'excess_same_name_records': sum(len(ids)-1 for ids in repeated_names.values()),
               'repeated_names': repeated_names,
               'CFB_frames': sum(len(o['fields'].get('compound_frames', [])) for o in objects),
               'call_edges': [], 'call_graph_status': 'not_decoded'}
    path = write_report('classification.json', objects, summary)
    print({k: v for k, v in summary.items() if k not in {'repeated_names', 'exact_duplicate_payload_groups'}})
    print(path)


if __name__ == '__main__':
    main()
