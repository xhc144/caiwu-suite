#!/usr/bin/env python3
"""Read only known-boundary PB9 p-code lengths and call descriptors.

Independent bounded walker; no original program execution, source reconstruction,
stack simulation, runtime receiver inference, or unique callee edges.
Factual operand word counts transcribed from MIT Hucxy/PbdViewer at
b46fd3e42b8f26ed18a547b9e4bec47f96530a86:
Uitils/PCode/PCodeParser90.cs, Git blob be7754e4ec83714fddc2e22881fd2be022f5fd3a.
Descriptor layout reference: PCodeParserBase.cs blob 3870f2b059bcf1921da733259c183026e001d0ae.
"""
import collections
import hashlib
import json
import struct
from pathlib import Path
from pb_deep_common import iter_views, write_report
from pb_deep_window import structural_layout, build_type_resolver, cstring, LayoutError

SOURCE_COMMIT = 'b46fd3e42b8f26ed18a547b9e4bec47f96530a86'
LENGTH_TABLE_BLOB = 'be7754e4ec83714fddc2e22881fd2be022f5fd3a'
PB90_ARG_WORDS = (
    2, 1, 1, 1, 0, 0, 0, 0, 0, 1, 3, 3, 1, 3, 3, 4, 0, 1, 5, 0,
    3, 0, 3, 3, 0, 4, 3, 1, 1, 2, 0, 0, 0, 0, 0, 0, 1, 0, 3, 2,
    3, 4, 2, 3, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2,
    1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 2, 2, 2, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 2, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 0, 0,
    0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2,
    2, 2, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0,
    0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1,
    0, 0, 0, 0, 3, 3, 2, 2, 3, 3, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2,
    1, 1, 2, 3, 2, 3, 4, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0,
    0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
    1, 0, 1, 1, 1, 1, 1, 5, 1, 4, 1, 0, 2, 3, 3, 5, 3, 5, 1, 4,
    1, 1, 2, 2, 2, 3, 3, 3, 3, 0, 3, 0, 2, 2, 2, 3, 1, 1, 4, 3,
    1, 1, 1, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 2,
    2, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 3, 4,
    3, 1, 1, 0, 1, 1, 0,
)
PREFIX_ARG_WORDS = {4:0,5:0,6:0,7:0,18:5,41:4,330:4,331:4,366:4,539:4,
                    444:2,445:3,446:3,447:3,448:3,540:3}
OBJECT_CALLS = {41,330,331,366,539}
GLOBAL_CALLS = {445,446,447,448,540}
TRANSACTIONS = {4:'connect_candidate',5:'commit_candidate',6:'rollback_candidate',7:'disconnect_candidate'}
COMPILED_EXTENSIONS = {'win','men','udo','str','apl','fun'}


def walk(code, word_counts=PB90_ARG_WORDS, version=0xc1):
    """Walk forward once from proven routine start; stop on unknown or bounds."""
    if version != 0xc1:
        return {'status':'unknown','instructions':[],'consumed':0,
                'stop':{'reason':'unsupported_object_version','version':version}}
    result=[]
    p=0
    stop=None
    while p < len(code):
        if p+2 > len(code):
            stop={'offset':p,'reason':'odd_or_truncated_opcode'}
            break
        op=struct.unpack_from('<H',code,p)[0]
        if (isinstance(word_counts,dict) and op not in word_counts) or (not isinstance(word_counts,dict) and op>=len(word_counts)):
            stop={'offset':p,'reason':'unknown_opcode_stop_without_resynchronization','opcode':op}
            break
        words=word_counts[op]
        length=2+2*words
        if p+length>len(code):
            stop={'offset':p,'reason':'instruction_operands_exceed_routine','opcode':op,
                  'required_bytes':length,'remaining_bytes':len(code)-p}
            break
        operands=struct.unpack_from('<'+'H'*words,code,p+2) if words else ()
        result.append((p,op,length,operands))
        p+=length
    return {'status':'parsed' if stop is None and p==len(code) else 'partial',
            'instructions':result,'consumed':p,'stop':stop}


def audit_boundaries(code, debug_bytes=b'', version=0xc1):
    """Check exact consumption and every available jump/debug byte target."""
    result=walk(code,version=version)
    if result['status']!='parsed':
        result.update(boundary_status='unknown',jump_target_count=0,debug_record_count=0)
        return result
    boundaries={p for p,_,_,_ in result['instructions']}|{len(code)}
    jumps=[]
    for p,op,_,args in result['instructions']:
        if op in (1,2,3,489):
            jumps.append({'instruction_offset':p,'opcode':op,'target':args[0]})
        elif op==485:
            jumps.extend({'instruction_offset':p,'opcode':op,'target':target} for target in args[:2])
    bad_jumps=[j for j in jumps if j['target'] not in boundaries]
    if len(debug_bytes)%4:
        bad_debug=[{'reason':'debug_length_not_multiple_4'}]
        debug_count=0
    else:
        debug_count=len(debug_bytes)//4
        bad_debug=[{'debug_record_offset':p,'line_word':line,'code_offset':off}
                   for p in range(0,len(debug_bytes),4)
                   for line,off in [struct.unpack_from('<HH',debug_bytes,p)]
                   if off not in boundaries]
    result.update(boundary_status='parsed' if not bad_jumps and not bad_debug else 'partial',
                  jump_target_count=len(jumps),debug_record_count=debug_count,
                  invalid_jump_targets=bad_jumps,invalid_debug_offsets=bad_debug)
    return result


def decode_descriptor(view, routine, instruction_offset, raw_offset, argc, flags, resolver):
    """Decode an exact descriptor pointed to by an already bounded call."""
    pool=routine['constants']
    off=raw_offset&0x7fffffff
    if off+8>len(pool['data']):
        raise LayoutError('call descriptor exceeds this routine constant pool')
    slot,typ,name=struct.unpack_from('<HHI',pool['data'],off)
    if name&0xffff==0xffff:
        raise LayoutError('call descriptor name uses absent sentinel')
    text,name_at,name_size=cstring(pool,name)
    mapped=[]
    for q in range(0,len(pool['map']),8):
        loc,kind,count=struct.unpack_from('<IHH',pool['map'],q)
        if loc==off:
            mapped.append({'record':view.field(pool['map_offset']+q,8,[loc,kind,count],
                                               'exact constant-map location match; kind semantics unassumed'),
                           'kind_raw':kind,'count_raw':count})
    return {'status':'parsed_descriptor_declaration_candidate',
            'instruction_object_offset':instruction_offset,
            'descriptor_ref':view.field(instruction_offset+2,4,raw_offset,'call operand points into this routine constant pool'),
            'descriptor':view.field(pool['offset']+off,8,None,'bounded call-target descriptor selected by proven instruction'),
            'dispatch_slot_candidate':view.field(pool['offset']+off,2,slot,'compiler dispatch slot; 0xffff remains unresolved'),
            'descriptor_type_ref':view.field(pool['offset']+off+2,2,typ,'type reference stored in descriptor; not a proven receiver type'),
            'descriptor_type_resolution':resolver(typ),
            'name_ref':view.field(pool['offset']+off+4,4,name,'name byte offset into the same routine constant pool'),
            'name':view.field(name_at,name_size,text,'descriptor-bound NUL-terminated cp936 name'),
            'argument_count':view.field(instruction_offset+6,2,argc,'call instruction declared argument count'),
            'flags':view.field(instruction_offset+8,2,flags,'post/dynamic/event low bits from pinned PB90 source'),
            'flag_candidates':{'post':bool(flags&1),'dynamic':bool(flags&2),'event':bool(flags&4),
                               'unknown_bits':flags&~7},
            'constant_map_matches':mapped,
            'receiver_type_status':'not_inferred',
            'dispatch_resolution_status':'not_proven',
            'unique_callee_edge':None}


def decode_super(view, routine, instruction_offset, operands, resolver):
    function_index,argc,typ,lo,hi=operands
    ref=lo|(hi<<16)
    text,name_at,name_size=cstring(routine['constants'],ref)
    return {'status':'parsed_super_declaration_candidate',
            'instruction_object_offset':instruction_offset,
            'function_index_raw':view.field(instruction_offset+2,2,function_index,'super instruction function index; no unique target resolved'),
            'argument_count':view.field(instruction_offset+4,2,argc,'declared argument count'),
            'object_type_raw':view.field(instruction_offset+6,2,typ,'super instruction object type operand'),
            'object_type_resolution':resolver(typ),
            'name_ref':view.field(instruction_offset+8,4,ref,'name pointer into this routine constant pool'),
            'name':view.field(name_at,name_size,text,'super-instruction-bound name'),
            'unique_callee_edge':None}


def analyze_view(view):
    layout=structural_layout(view.payload)
    resolver=build_type_resolver(layout)
    output={'source':view.source,'status':'partial','routines':[],
            'unique_callee_edges':[],
            'unknowns':['receiver stack and dispatch are not evaluated',
                        'instruction semantics outside selected calls/transaction observations are not decoded']}
    for cl in layout['classes']:
        class_info=resolver(cl['slot'][1])
        for rt in cl['routines']:
            code=view.payload[rt['code_offset']:rt['code_offset']+rt['code_bytes']]
            debug=view.payload[rt['line_offset']:rt['line_offset']+rt['line_count']*4]
            prefix=walk(code,PREFIX_ARG_WORDS)
            audit=audit_boundaries(code,debug)
            row={'routine_index_offset':rt['index_offset'],'routine_ids_raw':list(rt['ids']),
                 'class_slot_offset':cl['slot_offset'],'class_name':class_info['name'],
                 'code':view.field(rt['code_offset'],rt['code_bytes'],None,'complete length-delimited routine bytecode'),
                 'code_sha256':hashlib.sha256(code).hexdigest(),
                 'constant_pool_offset':rt['constants']['offset'],'constant_pool_bytes':len(rt['constants']['data']),
                 'known_subset_prefix_instructions':len(prefix['instructions']),
                 'known_subset_prefix_consumed':prefix['consumed'],'known_subset_stop':prefix['stop'],
                 'instruction_boundary_status':audit['status'],
                 'crosscheck_status':audit['boundary_status'],
                 'instruction_count':len(audit['instructions']),
                 'jump_target_count':audit['jump_target_count'],'debug_record_count':audit['debug_record_count'],
                 'invalid_jump_targets':audit.get('invalid_jump_targets',[]),
                 'invalid_debug_offsets':audit.get('invalid_debug_offsets',[]),
                 'stop':audit['stop'],'calls':[],'global_calls_unresolved':[],
                 'transaction_opcode_observations':[],'errors':[]}
            # No broad call decoding unless all routine boundaries cross-check.
            if audit['status']=='parsed' and audit['boundary_status']=='parsed':
                for pc,op,size,args in audit['instructions']:
                    absolute=rt['code_offset']+pc
                    if op in TRANSACTIONS:
                        row['transaction_opcode_observations'].append({
                            'opcode':op,'candidate_meaning':TRANSACTIONS[op],
                            'instruction':view.field(absolute,size,op,'static opcode observation at validated instruction boundary'),
                            'execution_count':None})
                    if op in OBJECT_CALLS or op==18:
                        try:
                            if op in OBJECT_CALLS:
                                raw=args[0]|(args[1]<<16)
                                call=decode_descriptor(view,rt,absolute,raw,args[2],args[3],resolver)
                            else:
                                call=decode_super(view,rt,absolute,args,resolver)
                            call.update(opcode=op,routine_relative_offset=pc,
                                        instruction=view.field(absolute,size,None,'PB90 instruction boundary validated by exact consume and jump/debug cross-check'))
                            row['calls'].append(call)
                        except (LayoutError,struct.error) as exc:
                            row['errors'].append({'instruction_offset':absolute,'opcode':op,'reason':str(exc)})
                    elif op in GLOBAL_CALLS:
                        # Function name is on the runtime stack; no nearest-push attribution.
                        row['global_calls_unresolved'].append({'opcode':op,
                            'instruction':view.field(absolute,size,None,'validated global-call boundary'),
                            'argument_count_raw':args[1],'flags_raw':args[2],
                            'status':'unknown_stack_name_and_receiver_provenance','unique_callee_edge':None})
            output['routines'].append(row)
    return output


def run():
    objects=[]
    summary=collections.Counter()
    transaction_counts=collections.Counter()
    stop_counts=collections.Counter()
    descriptor_type_counts=collections.Counter()
    flag_counts=collections.Counter()
    minimal=None
    for view in iter_views():
        if view.source['extension'] not in COMPILED_EXTENSIONS:
            continue
        result=analyze_view(view)
        objects.append(result)
        summary['compiled_objects']+=1
        for rt in result['routines']:
            summary['routines']+=1
            summary['instruction_count']+=rt['instruction_count']
            summary['jump_target_count']+=rt['jump_target_count']
            summary['debug_record_count']+=rt['debug_record_count']
            summary['known_subset_prefix_instructions']+=rt['known_subset_prefix_instructions']
            summary['known_subset_prefix_routines']+=bool(rt['known_subset_prefix_instructions'])
            summary['routines_exact_consumed']+=rt['instruction_boundary_status']=='parsed'
            summary['routines_boundary_crosschecks_passed']+=rt['crosscheck_status']=='parsed'
            summary['descriptor_decode_errors']+=len(rt['errors'])
            summary['global_call_candidates_without_stack_attribution']+=len(rt['global_calls_unresolved'])
            if rt['known_subset_stop']:
                stop_counts[rt['known_subset_stop'].get('opcode',rt['known_subset_stop']['reason'])]+=1
            for tx in rt['transaction_opcode_observations']:
                transaction_counts[tx['opcode']]+=1
            for call in rt['calls']:
                summary['super_call_declaration_candidates' if call['opcode']==18 else 'object_call_descriptor_candidates']+=1
                if call['opcode']!=18:
                    descriptor_type_counts[call['descriptor_type_resolution']['resolution']]+=1
                    summary['object_call_descriptor_exact_constmap_kind13_count1']+=(
                        len(call['constant_map_matches'])==1 and call['constant_map_matches'][0]['kind_raw']==13
                        and call['constant_map_matches'][0]['count_raw']==1)
                    flag_counts[call['flags']['value']]+=1
                    if minimal is None or rt['code']['bytes']<minimal['routine']['code']['bytes']:
                        minimal={'source':view.source,'routine':{k:v for k,v in rt.items() if k not in {'calls','global_calls_unresolved'}},
                                 'call':call}
    meta={'counts':dict(summary),'known_subset_stop_opcode_counts':dict(stop_counts),
          'transaction_opcode_observations':{str(op):{'count':transaction_counts[op],
              'candidate_meaning':TRANSACTIONS[op],'counts_are_static_instruction_locations':True,
              'execution_count':None} for op in TRANSACTIONS},
          'descriptor_type_resolution_counts':dict(descriptor_type_counts),
          'object_call_flag_word_counts':dict(flag_counts),
          'length_table':{'entries':len(PB90_ARG_WORDS),'source_commit':SOURCE_COMMIT,
                          'source_blob':LENGTH_TABLE_BLOB,'object_version_gate':193,
                          'source_file_sha256':'ef6396c3c43708798e5cc3e31a16536e2eba0207227b96c5807306d14cb6a2f0',
                          'operand_word_vector_sha256':hashlib.sha256(bytes(PB90_ARG_WORDS)).hexdigest(),
                          'extraction_method':'decimal integers inside exact new byte[547] initializer; no C# source execution',
                          'public_source_path':'Uitils/PCode/PCodeParser90.cs',
                          'map_is_not_a_complete_semantic_decoder':True},
          'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'unique_callee_edges':0,'call_edges':0,'resynchronization_performed':False}
    path=write_report('call-analysis.build.json',objects,meta)
    path.replace(path.with_name('call-analysis.json'))
    compact=[]
    for o in objects:
        counts={'routines':len(o['routines']),
                        'routines_boundary_crosschecks_passed':sum(r['crosscheck_status']=='parsed' for r in o['routines']),
                        'object_call_descriptors':sum(c['opcode']!=18 for r in o['routines'] for c in r['calls']),
                        'super_call_candidates':sum(c['opcode']==18 for r in o['routines'] for c in r['calls']),
                        'global_call_candidates_unattributed':sum(len(r['global_calls_unresolved']) for r in o['routines']),
                        'descriptor_errors':sum(len(r['errors']) for r in o['routines'])}
        compact.append({'source':o['source'],'status':'partial',
                        'dimension_status':{'instruction_boundaries':'parsed' if counts['routines_boundary_crosschecks_passed']==counts['routines'] else 'partial',
                                            'object_descriptor_fields':'parsed' if counts['descriptor_errors']==0 else 'partial',
                                            'unique_callee_resolution':'unknown'},'counts':counts,
                        'unknowns':o['unknowns'],'report':'call-analysis.json'})
    write_report('call-coverage.json',compact,meta)
    write_report('call-minimal-validation.json',[minimal] if minimal else [],meta)
    print(json.dumps(meta,ensure_ascii=False))


if __name__=='__main__':
    run()

