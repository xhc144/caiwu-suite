"""Recognize one bounded PB90 self-property string assignment shape.

Independent implementation from the documented stack operations in the fixed
Hucxy/PbdViewer b46fd3e42b8f26ed18a547b9e4bec47f96530a86 source:
PCodeParser90.cs and PCodeParserBase.cs. No external implementation is executed.
This is a static instruction candidate, never an effective runtime property.
Source blobs: be7754e4ec83714fddc2e22881fd2be022f5fd3a (PB90 opcodes),
3870f2b059bcf1921da733259c183026e001d0ae (stack operations),
a96f4758d89de31bd111cf5cfc9d92c1f5ec4792 (tagged string-pointer mask).
"""
import collections
import struct
from pb_deep_common import iter_views, write_report
from pb_deep_window import structural_layout, cstring, LayoutError
from pb_deep_calls import audit_boundaries

SHAPE = (30, 29, 287, 56, 304, 133)


def routine_candidates(view, routine):
    start = routine['code_offset']
    code = view.payload[start:start+routine['code_bytes']]
    debug = view.payload[routine['line_offset']:routine['line_offset']+routine['line_count']*4]
    audit = audit_boundaries(code, debug)
    if audit['boundary_status'] != 'parsed':
        return [], ['routine_boundary_audit_failed']
    instructions = audit['instructions']
    targets = set()
    for _, op, _, args in instructions:
        if op in (1, 2, 3, 489):
            targets.add(args[0])
        elif op == 485:
            targets.update(args[:2])
    pool = routine['constants']
    candidates, errors = [], []
    for i in range(len(instructions)-5):
        chunk = instructions[i:i+6]
        if tuple(x[1] for x in chunk) != SHAPE:
            continue
        first, last = chunk[0][0], chunk[-1][0]+chunk[-1][2]
        if any(first < target < last for target in targets):
            errors.append('branch_enters_assignment_shape_interior')
            continue
        # Only the exact scalar shape observed in the pinned source is accepted.
        # Other operand flags and casts remain unsupported, not normalized.
        if chunk[1][3][1] != 0 or chunk[2][3] != (2,) or chunk[4][3] != (1,):
            errors.append('unsupported_assignment_shape_operands')
            continue
        try:
            descriptor = chunk[1][3][0]
            if descriptor <= 7 or descriptor+6 > len(pool['data']):
                raise LayoutError('property_descriptor_outside_pool_or_special_sentinel')
            maps = [(q, struct.unpack_from('<IHH',pool['map'],q))
                    for q in range(0,len(pool['map']),8)
                    if struct.unpack_from('<I',pool['map'],q)[0] == descriptor]
            if len(maps) != 1 or maps[0][1] != (descriptor,12,1):
                raise LayoutError('property_descriptor_constant_map_not_exact_kind12_count1')
            name_pointer, member = struct.unpack_from('<IH',pool['data'],descriptor)
            if name_pointer & 0xffff == 0xffff:
                raise LayoutError('property_name_absent_sentinel')
            name, name_at, name_bytes = cstring(pool,name_pointer)
            literal_pointer = chunk[3][3][0] | chunk[3][3][1] << 16
            literal, literal_at, literal_bytes = cstring(pool,literal_pointer)
            candidates.append({
                'status':'static_self_property_string_assignment_candidate',
                'instruction_sequence':view.field(start+first,last-first,list(SHAPE),
                    'adjacent_push_this_property_begin_assign_string_cast_end_assign; no interior branch entry'),
                'property_descriptor':view.field(pool['offset']+descriptor,6,[name_pointer,member],
                    'routine_pool_property_name_pointer_and_unresolved_member_index'),
                'descriptor_reference':view.field(start+chunk[1][0]+2,4,descriptor,
                    'opcode29_property_descriptor_offset; upper_operand_word_verified_zero'),
                'constant_map_record':view.field(pool['map_offset']+maps[0][0],8,list(maps[0][1]),
                    'exact_descriptor_location_kind12_count1; runtime_member_table_not_resolved'),
                'property_name':view.field(name_at,name_bytes,name,'descriptor_bound_cp936_property_name'),
                'literal_reference':view.field(start+chunk[3][0]+2,4,literal_pointer,
                    'opcode56_string_pointer_into_same_routine_pool'),
                'literal_text':view.field(literal_at,literal_bytes,literal,'bounded_NUL_terminated_cp936_literal'),
                'routine_code_object_offset':start,
                'runtime_execution_proven':False,'effective_property_value_proven':False,
                'inherited_or_system_member_index_resolved':False,
                'event_binding':None,'unique_call_target':None})
        except (LayoutError,struct.error) as error:
            errors.append(str(error))
    return candidates, errors


def analyze(view):
    result={'source':view.source,'status':'partial','assignments':[],'errors':[],
            'unknowns':['all_other_instruction_shapes','execution_order_and_reachability',
                        'inherited_system_member_indices','effective_runtime_values','event_dispatch'],
            'call_edges':[]}
    try:
        layout=structural_layout(view.payload)
        for cl in layout['classes']:
            for routine in cl['routines']:
                candidates, errors = routine_candidates(view,routine)
                result['errors'].extend(errors)
                for candidate in candidates:
                    candidate.update(class_type_raw=cl['slot'][1],class_slot_object_offset=cl['slot_offset'],
                        routine_index_raw=list(routine['ids']))
                    result['assignments'].append(candidate)
    except (LayoutError,struct.error) as error:
        result['status']='unknown'
        result['errors'].append(str(error))
    return result


def main():
    objects=[analyze(v) for v in iter_views() if v.source['extension'] in {'win','men'}]
    summary={'objects':len(objects),'static_assignment_candidates':sum(len(o['assignments']) for o in objects),
        'property_names':dict(collections.Counter(a['property_name']['value'] for o in objects for a in o['assignments'])),
        'errors':dict(collections.Counter(e for o in objects for e in o['errors'])),
        'runtime_execution_proven':False,'effective_values_proven':False,'call_edges':0}
    write_report('literal-assignment-analysis.json',objects,summary)
    write_report('literal-assignment-coverage.json',[{'source':o['source'],'status':o['status'],
        'static_assignment_candidates':len(o['assignments']),'errors':o['errors'],'unknowns':o['unknowns']}
        for o in objects],summary)
    print(summary)


if __name__ == '__main__':
    main()
