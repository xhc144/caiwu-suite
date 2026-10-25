#!/usr/bin/env python3
"""Bounded PDW0900 record, column, query and property-reference decoder.

Only reads verified local objects. Layout conclusions are version-gated, checked
against record boundaries and, for named property slots, the matching runtime's
static metadata use sites. Never loads or executes that runtime.
"""
import collections
import re
import struct
from pathlib import Path
from pb_deep_common import iter_views, sha, write_report, get_settings

SCALAR_SIZES = {0x22: 20, 0x23: 36, 0x24: 28, 0x25: 24, 0x26: 28, 0xf7: 16}


class Invalid(ValueError):
    pass


def u32(data, offset):
    if offset < 0 or offset + 4 > len(data):
        raise Invalid('u32_outside_record')
    return struct.unpack_from('<I', data, offset)[0]


def records(data, max_records=100000):
    if len(data) < 12 or data[:8] != b'PDW0900\0':
        raise Invalid('unsupported_PDWindow_version')
    count = u32(data, 8)
    if not 1 <= count <= max_records:
        raise Invalid('record_count_limit')
    position, result = 12, []
    for number in range(1, count + 1):
        length = u32(data, position)
        if length > len(data) - position - 4:
            raise Invalid('record_length_exceeds_payload')
        result.append({'id': number, 'length_offset': position,
                       'offset': position + 4, 'bytes': length,
                       'data': data[position + 4:position + 4 + length]})
        position += length + 4
    if position != len(data):
        raise Invalid('record_count_does_not_consume_EOF')
    if result[0]['bytes'] != 938 or result[0]['data'][:4] != b'pdw\0':
        raise Invalid('unsupported_root_record_layout')
    return result


def record_at(rows, number, nullable=False):
    if number == 0 and nullable:
        return None
    if not 1 <= number <= len(rows):
        raise Invalid('record_reference_out_of_range')
    return rows[number - 1]


def text_record(view, row):
    data = row['data']
    if not data.endswith(b'\0') or b'\0' in data[:-1]:
        raise Invalid('reference_not_single_NUL_terminated_text_record')
    try:
        value = data[:-1].decode('cp936')
    except UnicodeDecodeError as exc:
        raise Invalid('invalid_cp936_text_record') from exc
    return {'record_id': row['id'], **view.field(row['offset'], row['bytes'], value,
            'complete_length_delimited_record_NUL_terminated_cp936_text')}


def ref_field(view, rows, owner, slot, text=False):
    number = u32(owner['data'], slot)
    result = view.field(owner['offset'] + slot, 4, number,
                        'one_based_serialized_record_reference_zero_is_null')
    target = record_at(rows, number, nullable=True)
    result['target_record_id'] = number or None
    if target is not None:
        result['target_object_offset'] = target['offset']
        if text:
            result['text'] = text_record(view, target)
    return result


def scalar(view, rows, number):
    row = record_at(rows, number)
    tag = u32(row['data'], 0)
    if SCALAR_SIZES.get(tag & 0x7fffffff) != row['bytes']:
        raise Invalid('unsupported_scalar_record_layout')
    expression = ref_field(view, rows, row, 4, text=True)
    if not expression.get('text'):
        raise Invalid('scalar_expression_reference_missing')
    return {'record_id': number, 'layout_tag': view.field(row['offset'], 4, tag,
            'PDW0900_scalar_layout_tag_only'), 'expression_text': expression,
            'compiled_expression_reference': ref_field(view, rows, row, 8),
            'evaluation_status': 'not_executed', 'bytecode_status': 'not_decoded'}


def runtime_slots(profile_path=None):
    """Read caller-owned property-offset evidence; no target profile is bundled.

    Without a profile only the structural record/column/query decoder is enabled.
    A profile must be independently verified against the caller's matching runtime.
    """
    import json
    groups = {name: {} for name in ('column', 'compute', 'compute_visual', 'text_visual')}
    if profile_path is None:
        settings = get_settings(required=False)
        profile_path = settings.dw_profile if settings else None
    if profile_path is None:
        return groups
    raw = json.loads(Path(profile_path).read_text(encoding='utf-8'))
    if raw.get('schema_version') != 'pb-dw-slots-1' or raw.get('layout') != 'PDW0900':
        raise Invalid('unsupported_external_property_profile')
    if raw.get('evidence_status') != 'caller_verified_against_matching_runtime':
        raise Invalid('external_profile_evidence_not_verified')
    for group, slots in raw.get('groups', {}).items():
        if group not in groups or not isinstance(slots, dict):
            raise Invalid('unknown_external_profile_group')
        for label, proof in slots.items():
            if not isinstance(label, str) or not isinstance(proof, dict):
                raise Invalid('invalid_external_profile_slot')
            slot = proof.get('slot')
            if not isinstance(slot, int) or slot < 0 or slot % 4 or slot > 4096:
                raise Invalid('invalid_external_profile_offset')
            groups[group][label] = dict(proof)
    groups['_provenance'] = {'external_profile_sha256': sha(Path(profile_path).read_bytes()),
                             'evidence_status': raw['evidence_status'],
                             'target_profile_is_bundled': False}
    return groups


def analyze(view, slots):
    result = {'source': view.source, 'status': 'unknown', 'decoded_fields': {}, 'unknowns': [], 'errors': []}
    try:
        rows = records(view.payload)
        root = rows[0]
        result['decoded_fields']['record_count'] = view.field(8, 4, len(rows), 'exact_length_prefixed_record_count_consumes_EOF')
        result['record_index'] = [{'record_id': r['id'], 'length_offset': r['length_offset'],
                                   'object_offset': r['offset'], 'bytes': r['bytes'], 'sha256': sha(r['data'])}
                                  for r in rows]
        table_ref = ref_field(view, rows, root, 28)
        table = record_at(rows, table_ref['value'])
        if table['bytes'] < 338 or (table['bytes'] - 338) % 64:
            raise Invalid('unsupported_table_record_size')
        ncols = (table['bytes'] - 338) // 64
        columns = []
        for number in range(ncols):
            slot = 338 + number * 64
            ordinal = struct.unpack_from('<H', table['data'], slot + 48)[0]
            if ordinal != number + 1:
                raise Invalid('column_ordinal_not_sequential')
            column = {'ordinal': view.field(table['offset'] + slot + 48, 2, ordinal,
                       'one_based_column_ordinal_in_64_byte_column_record'),
                       'name': ref_field(view, rows, table, slot + 12, text=True),
                       'database_name': ref_field(view, rows, table, slot + 16, text=True),
                       'visual_object': ref_field(view, rows, table, slot + 8),
                       'uninterpreted_plus52_raw': view.field(table['offset'] + slot + 52, 4,
                           u32(table['data'], slot + 52), 'raw_column_plus52_word_no_storage_type_inference')}
            columns.append(column)
        query = ref_field(view, rows, table, 108, text=True)
        query['binding'] = 'root_record_plus28_to_table_record_plus108_to_complete_query_record'
        query['execution_status'] = 'not_executed'
        if query.get('text'):
            sql = query['text']['value']
            if sql.startswith('PBSELECT('):
                names = re.findall(r'COLUMN\(NAME="([^"]*)"\s*\)', sql)
                expected = [c['database_name']['text']['value'] for c in columns]
                if names != expected:
                    # A query projection disagreement does not invalidate the
                    # independently bounded table/column or visual records.
                    # Keep both declarations and make the failed cross-check
                    # explicit; never repair, truncate or relabel the query.
                    result['errors'].append('PBSELECT_column_sequence_differs_from_table_binding')
                    query['PBSELECT_column_order_verification'] = 'mismatch_to_table_column_database_names'
                else:
                    query['PBSELECT_column_order_verification'] = 'exact_match_to_all_table_column_database_names'
                query['PBSELECT_columns'] = names
                query['representation'] = 'PBSELECT_definition_complete_text'
            elif re.match(r'(?is)^\s*select\b', sql):
                query['representation'] = 'SELECT_definition_complete_text_SQL_AST_not_decoded'
            else:
                query['representation'] = 'unclassified_bound_query_text'
        else:
            query['representation'] = 'no_query_text_record_reference'
        result['decoded_fields']['data_source'] = {'table_reference': table_ref, 'table_record_id': table['id'],
                                                   'column_count': ncols, 'columns': columns, 'query': query}
        controls = {}
        bands = []
        for root_slot in (32, 36, 40, 44):
            band_ref = ref_field(view, rows, root, root_slot)
            if not band_ref['value']:
                continue
            band = record_at(rows, band_ref['value'])
            if band['bytes'] != 64:
                raise Invalid('unsupported_band_record_size')
            first, last = u32(band['data'], 16), u32(band['data'], 20)
            ptr, previous, seen = first, 0, set()
            ids = []
            while ptr:
                if ptr in seen:
                    raise Invalid('visual_chain_cycle')
                seen.add(ptr)
                row = record_at(rows, ptr)
                if row['bytes'] < 36 or u32(row['data'], 4) != previous or u32(row['data'], 16) != band['id']:
                    raise Invalid('visual_previous_or_band_link_mismatch')
                controls[ptr] = row
                ids.append(ptr)
                previous, ptr = ptr, u32(row['data'], 0)
            if previous != last:
                raise Invalid('visual_chain_tail_mismatch')
            bands.append({'root_slot': root_slot, 'reference': band_ref, 'visual_record_ids': ids})
        for column in columns:
            number = column['visual_object']['value']
            if number:
                row = record_at(rows, number)
                if row['bytes'] != 132 or u32(row['data'], 32) & 0xffff != 1:
                    raise Invalid('table_visual_reference_not_column_layout')
                if struct.unpack_from('<H', row['data'], 88)[0] != column['ordinal']['value']:
                    raise Invalid('visual_column_id_differs_from_bound_column_ordinal')
                controls[number] = row
        visuals = []
        for number, row in sorted(controls.items()):
            raw_type = u32(row['data'], 32)
            code = raw_type & 0xffff
            kind = {1: 'column', 2: 'compute', 7: 'text'}.get(code, 'structural_tag_' + str(code))
            props = slots['column'] if kind == 'column' and row['bytes'] == 132 else (
                    {**slots['compute_visual'], **slots['compute']} if kind == 'compute' and row['bytes'] == 110 else (
                    slots['text_visual'] if kind == 'text' and row['bytes'] == 96 else {}))
            decoded = {}
            errors = []
            for label, proof in props.items():
                try:
                    reference = ref_field(view, rows, row, proof['slot'])
                    value = scalar(view, rows, reference['value']) if reference['value'] else None
                    decoded[label] = {'reference': reference, 'scalar': value,
                                      'runtime_layout_evidence': {'report': 'dw-runtime-layout.json',
                                          'instruction_file_offset': proof.get('instruction_file_offset'), 'profile_slot': proof['slot']},
                                      'effective_default_value': 'not_inferred_when_reference_is_null'}
                except Invalid as exc:
                    errors.append({'property': label, 'error': str(exc)})
            visuals.append({'record_id': number, 'kind_from_structural_tag': kind,
                            'layout_type_raw': view.field(row['offset'] + 32, 4, raw_type, 'raw_visual_layout_tag_low16'),
                            'name': ref_field(view, rows, row, 8, text=True),
                            'properties': decoded, 'property_errors': errors})
        result['decoded_fields']['bands_by_root_slot'] = bands
        result['decoded_fields']['visual_objects'] = visuals
        result['status'] = 'partial'
        result['dimension_status'] = {'record_envelope': 'parsed', 'columns_and_database_name_binding': 'parsed',
                                      'bound_query_text': 'parsed', 'named_visual_properties': 'partial' if any(slots[g] for g in ('column','compute','compute_visual','text_visual')) else 'unknown',
                                      'complete_canonical_DataWindow_source': 'unknown', 'expression_pcode': 'unknown'}
        if query.get('PBSELECT_column_order_verification') == 'mismatch_to_table_column_database_names':
            result['dimension_status']['query_column_sequence_binding'] = 'mismatch'
        result['unknowns'] = [{'region': 'root_record', 'record_id': 1, 'object_offset': root['offset'], 'bytes': root['bytes'],
                               'reason': 'most_root_property_slots_not_yet_named_or_decoded'},
                              {'region': 'table_record_prefix', 'record_id': table['id'], 'object_offset': table['offset'], 'bytes': 338,
                               'reason': 'retrieval_arguments_update_flags_and_column_type_names_not_fully_decoded'},
                              {'region': 'group_bands_and_non_text_column_compute_visual_properties',
                               'reason': 'only_four_root_band_lists_and_bound_columns_are_traversed'},
                              {'region': 'scalar_compiled_expression_reference',
                               'reason': 'complete_referenced_expression_text_recovered_but_expression_VM_bytes_not_decoded'}]
    except (Invalid, KeyError, struct.error) as exc:
        result['errors'].append(str(exc))
    return result


def main():
    slots = runtime_slots()
    objects = [analyze(view, slots) for view in iter_views() if view.source['extension'] == 'dwo']
    counts = collections.Counter(o['status'] for o in objects)
    cols = sum(o.get('decoded_fields', {}).get('data_source', {}).get('column_count', 0) for o in objects)
    queries = collections.Counter(o.get('decoded_fields', {}).get('data_source', {}).get('query', {}).get('representation', 'unknown') for o in objects)
    query_checks = collections.Counter(o.get('decoded_fields', {}).get('data_source', {}).get('query', {}).get('PBSELECT_column_order_verification', 'not_checked') for o in objects)
    visuals = collections.Counter(c['kind_from_structural_tag'] for o in objects for c in o.get('decoded_fields', {}).get('visual_objects', []))
    props = sum(len(c['properties']) for o in objects for c in o.get('decoded_fields', {}).get('visual_objects', []))
    prop_errors = sum(len(c['property_errors']) for o in objects for c in o.get('decoded_fields', {}).get('visual_objects', []))
    explicit = collections.Counter(c['kind_from_structural_tag'] + '.' + key
        for o in objects for c in o.get('decoded_fields', {}).get('visual_objects', [])
        for key, value in c['properties'].items() if value['scalar'] is not None)
    summary = {'objects': len(objects), 'statuses': dict(counts), 'serialized_records': sum(len(o.get('record_index', [])) for o in objects),
               'columns': cols, 'query_representations': dict(queries), 'query_column_order_checks': dict(query_checks), 'visuals': dict(visuals),
               'named_property_slots': props, 'property_decode_errors': prop_errors,
               'explicit_property_texts': sum(explicit.values()), 'explicit_properties_by_kind_and_name': dict(explicit),
               'property_profile_provenance': slots.get('_provenance'), 'complete_source_recovered': False,
               'layout_basis': 'PDW0900_record_boundaries_references_column_ordinals;_PBSELECT_order_crosscheck_retained;_named_properties_require_caller_profile',
               'query_text_never_executed': True}
    path = write_report('dw-analysis.json', objects, summary)
    write_report('dw-runtime-layout.json', [], {'external_profile_provenance': slots.get('_provenance'), 'verified_property_slots': slots})
    coverage = []
    for obj in objects:
        decoded = obj.get('decoded_fields', {})
        controls = decoded.get('visual_objects', [])
        datasource = decoded.get('data_source', {})
        coverage.append({'source': obj['source'], 'status': obj['status'],
                         'dimension_status': obj.get('dimension_status', {}),
                         'counts': {'serialized_records': len(obj.get('record_index', [])),
                                    'columns': datasource.get('column_count', 0),
                                    'visuals': dict(collections.Counter(c['kind_from_structural_tag'] for c in controls)),
                                    'named_property_slots': sum(len(c['properties']) for c in controls),
                                    'expression_texts_recovered': sum(p.get('scalar') is not None for c in controls for p in c['properties'].values()),
                                    'property_decode_errors': sum(len(c['property_errors']) for c in controls)},
                         'query_representation': datasource.get('query', {}).get('representation', 'unknown'),
                         'PBSELECT_columns_exact_match': ('exact_match_to_all_table_column_database_names'
                             if datasource.get('query', {}).get('PBSELECT_column_order_verification') == 'exact_match_to_all_table_column_database_names' else None),
                         'PBSELECT_column_order_verification': datasource.get('query', {}).get('PBSELECT_column_order_verification'),
                         'unknowns': obj['unknowns'], 'errors': obj['errors']})
    write_report('dw-coverage.json', coverage, summary)
    print(summary)
    print('local_only_report', path)


if __name__ == '__main__':
    main()
