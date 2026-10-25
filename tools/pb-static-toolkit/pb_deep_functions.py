"""Read declared PB9 function/event tables; no p-code execution/call inference.

Layout reference Hucxy/PbdViewer b46fd3e42b8f26ed18a547b9e4bec47f96530a86,
PbEntry.cs blob 945ea0111675d1e980bf4cd72d02d69b7de7724c (48-byte definitions,
12-byte parameters; PB9 parameter pointer is at +8, not PB5's +4).
"""
import collections
import struct
from pb_deep_common import iter_views, write_report, sha
from pb_deep_window import structural_layout, cstring, build_type_resolver, LayoutError


def decode_definition(view, layout, position, resolve):
    raw = view.payload[position:position+48]
    if len(raw) != 48:
        raise LayoutError('function definition truncated')
    name_pointer, = struct.unpack_from('<I', raw)
    name, at, size = cstring(layout['function_const'], name_pointer)
    parameter_pointer, alias_pointer, library_pointer = struct.unpack_from('<III', raw, 8)
    global_index, reference_index = struct.unpack_from('<HH', raw, 20)
    return_type, count, flags, event_code = struct.unpack_from('<HBBH', raw, 28)
    result = {'definition_offset': position, 'definition_record': view.field(position, 48, None, 'bounded_PB9_function_event_definition'),
              'name': view.field(at, size, name, 'definition_name_pointer_into_function_pool'),
              'name_pointer': view.field(position, 4, name_pointer, 'function_pool_relative_name_pointer'),
              'return_type': resolve(return_type), 'return_type_field': view.field(position+28, 2, return_type, 'return_type_reference'),
              'parameter_count': view.field(position+30, 1, count, 'declared_parameter_count'),
              'flags': view.field(position+31, 1, flags, 'definition_flags_layout_reference'),
              'is_event_definition': bool(flags & 1), 'is_external_definition': bool(flags & 4),
              'visibility': 'private' if flags & 0x10 else 'protected' if flags & 0x20 else 'public',
              'event_code_raw': view.field(position+32, 2, event_code, 'event_code_not_mapped_to_runtime_event_enum'),
              'global_index_raw': view.field(position+20, 2, global_index, 'global_function_definition_slot'),
              'reference_index_raw': view.field(position+22, 2, reference_index, 'reference_index_layout_field'),
              'parameter_pointer': view.field(position+8, 4, parameter_pointer, 'parameter_pool_relative_offset'),
              'parameters': [], 'call_edges': [], 'status': 'partial',
              'unknowns': ['pcode_semantics', 'runtime_dispatch', 'inherited_effective_function_table']}
    if parameter_pointer == 65535:
        if count != 0:
            raise LayoutError('nonzero parameter count with absent parameter table')
    else:
        pool = layout['parameter_const']
        if parameter_pointer + count*12 > len(pool['data']):
            raise LayoutError('parameter list exceeds declared parameter pool')
        for index in range(count):
            relative = parameter_pointer+index*12
            p = pool['offset']+relative
            param = pool['data'][relative:relative+12]
            pname, pat, pn = cstring(layout['function_const'], struct.unpack_from('<I', param)[0])
            array_pointer, typ, pflags = struct.unpack_from('<IHB', param, 4)
            result['parameters'].append({'index': index, 'record': view.field(p,12,None,'declared_parameter_record'),
                                         'name': view.field(pat,pn,pname,'parameter_name_pointer_into_function_pool'),
                                         'type': resolve(typ), 'type_field': view.field(p+8,2,typ,'parameter_type_reference'),
                                         'flags_raw': view.field(p+10,1,pflags,'parameter_mode_flags'),
                                         'mode': 'readonly' if pflags&4 else 'reference' if pflags&2 else 'value',
                                         'array_pointer_raw': view.field(p+4,4,array_pointer,'array_shape_reference_not_decoded')})
    if alias_pointer != 65535:
        alias, at, n = cstring(layout['function_const'], alias_pointer)
        library, lat, ln = cstring(layout['function_const'], library_pointer)
        result['external_alias'] = view.field(at,n,alias,'declared_external_alias_from_definition_pointer')
        result['external_library'] = view.field(lat,ln,library,'declared_external_library_from_definition_pointer_not_loaded')
    throws_pointer, = struct.unpack_from('<H', raw, 44)
    if throws_pointer != 65535:
        pool=layout['function_const']
        if throws_pointer+2 > len(pool['data']):
            raise LayoutError('throws type pointer outside function pool')
        typ, = struct.unpack_from('<H', pool['data'], throws_pointer)
        result['throws_type'] = resolve(typ)
        result['throws_type_field'] = view.field(pool['offset']+throws_pointer,2,typ,'declared_throws_type_reference')
    return result


def analyze(view):
    result={'source':view.source,'status':'unknown','classes':[],'call_edges':[],
            'call_graph_status':'not_decoded','unknowns':['pcode_instructions_and_call_targets']}
    try:
        layout=structural_layout(view.payload)
        resolve=build_type_resolver(layout)
        for cl in layout['classes']:
            definitions=[]
            for index in range(cl['definition'][2]):
                definitions.append(decode_definition(view,layout,cl['function_definition_offset']+48*index,resolve))
            routines=[]
            for routine in cl['routines']:
                local_index=routine['ids'][1]
                if local_index>=len(definitions):
                    raise LayoutError('routine index exceeds local definition table')
                start,size=routine['code_offset'],routine['code_bytes']
                routines.append({'index_record':view.field(routine['index_offset'],4,list(routine['ids']),'raw_routine_index_record'),
                                 'local_definition_index_raw':local_index,
                                 'local_definition_offset':definitions[local_index]['definition_offset'],
                                 'declared_name':definitions[local_index]['name'],
                                 'definition_binding_status':'parsed_local_definition_index_not_runtime_dispatch',
                                 'code_object_offset':start,'code_bytes':size,'code_sha256':sha(view.payload[start:start+size]),
                                 'code_file_spans':view.spans(start,size),
                                 'debug_object_offset':routine['line_offset'],'debug_bytes':routine['line_count']*4,
                                 'instruction_status':'not_decoded'})
            references=[]
            for item in cl['references']['items']:
                p=item['record_offset']
                global_id,=struct.unpack_from('<H',item['raw'],12)
                references.append({'record':view.field(p,20,None,'declared_function_reference_record'),
                                   'name':view.field(item['name_offset'],item['name_bytes'],item['name'],'reference_name_pointer_into_declared_pool'),
                                   'global_index_raw':view.field(p+12,2,global_id,'declared_reference_global_index'),
                                   'kind_byte_raw':view.field(p+16,1,item['raw'][16],'reference_kind_2_global_function_by_layout_reference'),
                                   'relation':'declared_symbol_reference_not_call_edge'})
            result['classes'].append({'class_type':resolve(cl['slot'][1]),'class_slot_offset':cl['slot_offset'],
                                      'definitions':definitions,'routine_bodies':routines,'declared_references':references,
                                      'event_table_raw':view.field(cl['event_offset'],cl['definition'][12]*6,None,'bounded_event_map_records_semantics_not_decoded')})
        result['status']='partial'
        result['structure_status']='parsed_bounded_complete_consumption'
        result['definition_table_status']='parsed_bounded_name_parameter_type_records'
    except (LayoutError,struct.error,UnicodeDecodeError) as error:
        result['status']='partial' if result['classes'] else 'unknown'
        result['unknowns'].append(str(error))
    return result


def main():
    objects=[analyze(view) for view in iter_views() if view.source['extension'] in {'fun','win','men','udo','str','apl'}]
    definitions=[d for o in objects for c in o['classes'] for d in c['definitions']]
    summary={'objects':len(objects),'status':dict(collections.Counter(o['status'] for o in objects)),
             'definition_records':len(definitions),'event_flag_definition_records':sum(d['is_event_definition'] for d in definitions),
             'other_function_definition_records':sum(not d['is_event_definition'] for d in definitions),
             'declared_parameters':sum(len(d['parameters']) for d in definitions),
             'routine_bodies_bounded':sum(len(c['routine_bodies']) for o in objects for c in o['classes']),
             'declared_reference_records':sum(len(c['declared_references']) for o in objects for c in o['classes']),
             'call_edges':0,'pcode_status':'not_decoded',
             'event_counts_are_definition_records_not_distinct_runtime_handlers':True}
    write_report('function-analysis.json',objects,summary)
    coverage=[]
    for obj in objects:
        definitions=[d for c in obj['classes'] for d in c['definitions']]
        coverage.append({'source':obj['source'],'status':obj['status'],
                         'structure_status':obj.get('structure_status','unknown'),
                         'definition_table_status':obj.get('definition_table_status','unknown'),
                         'definition_records':len(definitions),
                         'event_flag_definition_records':sum(d['is_event_definition'] for d in definitions),
                         'declared_parameters':sum(len(d['parameters']) for d in definitions),
                         'routine_bodies_bounded':sum(len(c['routine_bodies']) for c in obj['classes']),
                         'declared_reference_records':sum(len(c['declared_references']) for c in obj['classes']),
                         'pcode_status':'unknown','call_graph_status':'unknown','call_edges':0,
                         'unknowns':obj['unknowns']})
    write_report('function-coverage.json',coverage,summary)
    print(summary)


if __name__=='__main__':
    main()
