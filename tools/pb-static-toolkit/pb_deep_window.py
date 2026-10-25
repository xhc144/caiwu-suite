#!/usr/bin/env python3
"""Bounded PB9 0xc1 ANSI class/property layout reader, local evidence only.

Layout references (read as source, never executed): Hucxy/PbdViewer at
b46fd3e42b8f26ed18a547b9e4bec47f96530a86, PbEntry.cs/PbVariable.cs;
sijms/PowerBuilder-decompile at 5a7b9b05a400ddef8515dbf74e6fcd51a2e741a4.
Independent implementation; functions/p-code are length-delimited but not decoded.
"""
import collections
import hashlib
import struct
from pb_deep_common import iter_views, write_report

REFERENCE = 'https://github.com/Hucxy/PbdViewer/tree/b46fd3e42b8f26ed18a547b9e4bec47f96530a86'
BASIC = {0:'void',1:'integer',2:'long',3:'real',4:'double',5:'decimal',6:'string',7:'boolean',
         8:'any',9:'uint',10:'ulong',11:'blob',12:'date',13:'time',14:'datetime',15:'cursor',
         16:'procedure',18:'char',19:'objhandle',20:'longlong',21:'byte'}


class LayoutError(ValueError):
    pass


class Reader:
    def __init__(self, data):
        self.data = data
        self.p = 0

    def take(self, n):
        if n < 0 or self.p+n > len(self.data):
            raise LayoutError('range exceeds object at offset ' + str(self.p))
        p=self.p
        self.p+=n
        return p, self.data[p:p+n]

    def number(self, fmt):
        p,b=self.take(struct.calcsize(fmt))
        return p,struct.unpack(fmt,b)

    def const(self):
        header,(n,m)=self.number('<II')
        start,b=self.take(n)
        map_start,mapping=self.take(m)
        if m%8:
            raise LayoutError('constant map size is not multiple of 8')
        return {'header':header,'offset':start,'data':b,'map_offset':map_start,'map':mapping}

    def lookup(self):
        header,_=self.take(6)
        const=self.const()
        length_offset,(n,)=self.number('<H')
        if n%20:
            raise LayoutError('lookup record size not multiple of 20')
        start,b=self.take(n)
        items=[]
        for q in range(0,n,20):
            raw=b[q:q+20]
            a,array,name,value,flags,typ=struct.unpack('<IIIIHH',raw)
            item={'record_offset':start+q,'raw':raw,'flags_low':a,'array_offset':array,
                  'name_relative':name,'value_raw':value,'flags':flags,'type_raw':typ}
            text,off,size=cstring(const,name)
            item.update({'name':text,'name_offset':off,'name_bytes':size})
            items.append(item)
        return {'header_offset':header,'const':const,'length_offset':length_offset,'items':items}


def cstring(pool, relative):
    # The high bit is a pool pointer tag, not part of the byte offset.
    relative &= 0x7fffffff
    b=pool['data']
    if relative >= len(b):
        raise LayoutError('string offset outside declared constant buffer')
    end=b.find(b'\0',relative)
    if end<0:
        raise LayoutError('unterminated declared-pool string')
    try:
        value=b[relative:end].decode('cp936')
    except UnicodeDecodeError as ex:
        raise LayoutError('invalid cp936 declared-pool string at object offset '+str(pool['offset']+relative)) from ex
    return value,pool['offset']+relative,end-relative+1


def structural_layout(data):
    r=Reader(data)
    _,header=r.number('<HHIIII')
    if header[0]!=0xc1 or header[1]!=3:
        raise LayoutError('unsupported compiled object gate; requires 0xc1/3')
    r.take(4)  # final header u32, through byte 24
    _,(symbol_count,)=r.number('<H')
    symbols=[]
    for _ in range(symbol_count):
        off,raw=r.take(12)
        symbols.append((off,struct.unpack('<IHHHH',raw)))
    global_const=r.const()
    global_lookup=r.lookup()
    counts_offset,(class_count,definition_count)=r.number('<HH')
    function_const=r.const()
    parameter_const=r.const()
    types=r.lookup()
    enums=r.lookup()
    slots=[]
    for _ in range(class_count):
        off,raw=r.take(16)
        slots.append((off,struct.unpack('<8H',raw)))
    defs=[]
    for _ in range(definition_count):
        off,raw=r.take(32)
        defs.append((off,struct.unpack('<16H',raw)))
    classes=[]
    def_index=0
    for slot_off,slot in slots:
        kind=(slot[0]>>1)&7
        if kind==1:
            r.take(slot[2]*8)
            continue
        if kind in (2,3,4,5,6,7):
            continue  # descriptor-only slot; no class body in referenced 0xc1 layout
        if kind!=0:
            raise LayoutError('unsupported class slot variant '+str(kind))
        if def_index>=len(defs):
            raise LayoutError('class definition slot missing')
        definition_off,definition=defs[def_index]
        def_index+=1
        routine_count_offset,(routine_count,)=r.number('<H')
        routine_indices=[r.number('<HH') for _ in range(routine_count)]
        routines=[]
        for idx_offset,ids in routine_indices:
            off,(code_bytes,line_count,unknown_count)=r.number('<HHH')
            code_offset,_=r.take(code_bytes)
            line_offset,_=r.take(line_count*4)
            variables=r.lookup()
            constants=r.const()
            routines.append({'header_offset':off,'index_offset':idx_offset,'ids':ids,
                             'code_offset':code_offset,'code_bytes':code_bytes,'line_count':line_count,
                             'line_offset':line_offset,'unknown_count':unknown_count,
                             'variables':variables,'constants':constants})
        event_offset,_=r.take(definition[12]*6)
        r.take(definition[11]*4)
        references=r.lookup()
        properties=r.lookup()
        r.take(definition[14]*8)
        r.take(definition[13]*16)
        function_definition_offset,_=r.take(definition[2]*48)
        classes.append({'slot_offset':slot_off,'slot':slot,'definition_offset':definition_off,
                        'definition':definition,'properties':properties,'references':references,
                        'routines':routines,'routine_count_offset':routine_count_offset,
                        'event_offset':event_offset,'function_definition_offset':function_definition_offset})
    if def_index != len(defs):
        raise LayoutError('unconsumed class definition slots')
    if r.p != len(data):
        raise LayoutError('trailing unclassified bytes: '+str(len(data)-r.p))
    return {'global_const':global_const,'symbols':symbols,'global_lookup':global_lookup,
            'types':types,'enums':enums,'function_const':function_const,'parameter_const':parameter_const,
            'classes':classes,'slots':slots,'counts_offset':counts_offset,
            'declared_counts':[class_count,definition_count],'consumed':r.p}


def build_type_resolver(layout):
    types=layout['types']['items']
    system={}
    for off,sym in layout['symbols']:
        name,at,n=cstring(layout['global_const'],sym[0])
        if sym[2]&0xc000==0x4000 and sym[3]&0xc000==0x4000:
            system[sym[2]]={'name':name,'name_offset':at,'name_bytes':n,'record_offset':off}

    def resolve(raw):
        if raw == 0xc000:
            return {'name':None,'raw':raw,'resolution':'none_sentinel'}
        if raw&0xf000==0xc000:
            return {'name':None,'raw':raw,'resolution':'unresolved_type_family_C'}
        if raw&0xc000==0x8000:
            i=raw&0x3fff
            if i>=len(types):raise LayoutError('local type index exceeds table')
            item=types[i]
            return {'name':item['name'],'raw':raw,'resolution':'local_type_table_index',
                    'type_name_offset':item['name_offset'],'type_name_bytes':item['name_bytes'],
                    'type_record_offset':item['record_offset'],'referenced_external':bool(item['raw'][16]&0x40)}
        if raw in system:
            item=system[raw]
            return {'name':item['name'],'raw':raw,'resolution':'global_symbol_type_id',
                    'type_name_offset':item['name_offset'],'type_name_bytes':item['name_bytes'],
                    'type_record_offset':item['record_offset']}
        if raw in BASIC:
            return {'name':BASIC[raw],'raw':raw,'resolution':'primitive_type_layout_reference'}
        return {'name':None,'raw':raw,'resolution':'unresolved_type'}

    return resolve


def decode_view(view):
    result={'source':view.source,'status':'unknown','decoded_fields':[],'classes':[],
            'unknowns':['pcode/event execution semantics not decoded','inherited effective property values not merged'],
            'layout_reference':REFERENCE}
    try:
        layout=structural_layout(view.payload)
        base_resolver=build_type_resolver(layout)

        def type_info(raw):
            info=base_resolver(raw)
            if 'type_name_offset' in info:
                info['type_name_field']=view.field(info['type_name_offset'],info['type_name_bytes'],info['name'],'type index resolves to this bounded declared name')
            return info

        for c in layout['classes']:
            identity=type_info(c['slot'][1]);inherit=type_info(c['definition'][0]);parent=type_info(c['definition'][1])
            cl={'class_type':identity,'inherit_type':inherit,'parent_type':parent,
                'class_type_field':view.field(c['slot_offset']+2,2,c['slot'][1],'class slot type index'),
                'inherit_type_field':view.field(c['definition_offset'],2,c['definition'][0],'class definition inherited type reference'),
                'parent_type_field':view.field(c['definition_offset']+2,2,c['definition'][1],'class definition containing parent type reference'),
                'properties':[],'instance_variables':[],'controls':[]}
            for var in c['properties']['items']:
                info=type_info(var['type_raw'])
                item={'name':view.field(var['name_offset'],var['name_bytes'],var['name'],'lookup record name pointer into declared name pool'),
                      'record':view.field(var['record_offset'],20,None,'bounded 20-byte class property/variable lookup record'),
                      'type':info,'type_field':view.field(var['record_offset']+18,2,var['type_raw'],'property type'),
                      'flags':view.field(var['record_offset'],4,var['flags_low'],'lookup flags determine class property versus instance declaration'),
                      'attributes_flags':view.field(var['record_offset']+16,2,var['flags'],'variable storage/type flags'),
                      'value_raw':view.field(var['record_offset']+12,4,var['value_raw'],'record-bound literal or constant-pool offset; consult decoding status'),
                      'value_status':'unknown','value':None}
                flagbyte=var['flags']>>8
                if (var['flags_low']&15)==8:
                    target=cl['properties']
                    # No indirect/global/array/invalid encodings are interpreted as literals.
                    if flagbyte&1 and not var['flags_low']&2 and not var['flags']&0x40 and not flagbyte&0x20 and flagbyte&12!=12:
                        raw=var['value_raw'];typ=info['name']
                        if typ in ('integer','uint','boolean','long','ulong','real'):
                            if typ=='boolean' and raw&255 not in (0,1):
                                item['unknown_reason']='noncanonical boolean low byte: '+str(raw&255)
                            else:
                                value={'integer':lambda:struct.unpack('<h',struct.pack('<H',raw&65535))[0],
                                       'uint':lambda:raw&65535,'boolean':lambda:bool(raw&255),
                                       'long':lambda:struct.unpack('<i',struct.pack('<I',raw))[0],
                                       'ulong':lambda:raw,'real':lambda:struct.unpack('<f',struct.pack('<I',raw))[0]}[typ]()
                                item.update(value_status='parsed_inline_primitive',value=value)
                        elif typ=='string':
                            try:
                                value,at,n=cstring(layout['global_const'],raw)
                                item.update(value_status='parsed_constant_pool_string',value=value,
                                            value_field=view.field(at,n,value,'string literal bound by property record value pointer'))
                            except LayoutError as ex:
                                relative=raw&0x7fffffff
                                const=layout['global_const']
                                end=const['data'].find(b'\0',relative)
                                if 0<=relative<len(const['data']) and end>=relative:
                                    raw_value=const['data'][relative:end+1]
                                    item.update(value_status='unknown_string_encoding',
                                                value_raw_sha256=hashlib.sha256(raw_value).hexdigest(),
                                                value_raw_hex=raw_value.hex(),
                                                value_field=view.field(const['offset']+relative,len(raw_value),None,'record-bound NUL-terminated bytes; text encoding not established'))
                                item['unknown_reason']=str(ex)
                        elif info['resolution']=='local_type_table_index':
                            item.update(value_status='partial_local_type_numeric_only',value=raw&65535)
                elif var['flags']&0xffff==0x0d00:
                    target=cl['controls']
                else:
                    target=cl['instance_variables']
                if item['value_status']=='unknown':
                    item.setdefault('unknown_reason',('literal/default not decoded for this declaration or storage flags; '
                                            'flags_low='+hex(var['flags_low'])+', attributes='+hex(var['flags'])))
                elif item['value_status']=='partial_local_type_numeric_only':
                    item['unknown_reason']='local type name is resolved; enum member/object value semantics are not established'
                target.append(item)
            result['classes'].append(cl)
        result['status']='partial'
        local_classes={c['slot'][1]:c['slot_offset'] for c in layout['classes']}
        result['relationships']=[]
        for cl in result['classes']:
            for relation,key,field in [('declared_inherits_type','inherit_type','inherit_type_field'),
                                       ('declared_contained_by_type','parent_type','parent_type_field')]:
                target=cl[key]
                if target['name'] is None:
                    continue
                result['relationships'].append({'relation':relation,
                    'source_class_type_raw':cl['class_type']['raw'],
                    'target_type_raw':target['raw'],'target_type_name':target['name'],
                    'target_local_class_slot_offset':local_classes.get(target['raw']),
                    'declaration_field':cl[field],
                    'runtime_binding_or_call_proven':False})
        result['descriptor_slots']=[{'slot':view.field(off,16,list(slot),'descriptor-only slot retained without semantic field interpretation'),
                                     'variant':(slot[0]>>1)&7,
                                     'status':'descriptor_only_source_reference'}
                                    for off,slot in layout['slots'] if (slot[0]>>1)&7]
        result['decoded_fields']=[view.field(0,2,0xc1,'compiled object version gate'),
                                  view.field(2,2,3,'compiled object flags gate'),
                                  view.field(layout['counts_offset'],4,layout['declared_counts'],'class slot count and class definition count')]
        result['structure_status']='parsed_bounded_complete_consumption'
        result['bytes_consumed']=layout['consumed']
        result['checks']=['exact_EOF','all_lookup_sizes_multiple_20','constant_pool_boundaries',
                          'all_record_name_pointers_bounded_NUL','class_type_indices_bounded',
                          'routine_code_and_debug_lengths_bounded','all_definition_slots_consumed']
        if view.source.get('extension')=='men':
            result['unknowns'].append('menu initialization/caption assignments in p-code are not reconstructed; literal table values only')
    except (LayoutError,struct.error) as ex:
        result['classes']=[]
        result['decoded_fields']=[]
        result['unknowns'].append(str(ex))
        result['structure_status']='unknown_rejected_layout'
    return result


def main():
    objects=[decode_view(v) for v in iter_views() if v.source['extension'] in {'win','men','udo','str','apl'}]
    summary={'objects':len(objects),'status_counts':dict(collections.Counter(o['status'] for o in objects)),
             'class_count':sum(len(o['classes']) for o in objects),
             'property_records':sum(len(c['properties']) for o in objects for c in o['classes']),
             'control_records':sum(len(c['controls']) for o in objects for c in o['classes']),
             'parsed_property_values':sum(p['value_status'].startswith('parsed') for o in objects for c in o['classes'] for p in c['properties']),
             'local_type_numeric_only':sum(p['value_status'].startswith('partial') for o in objects for c in o['classes'] for p in c['properties']),
             'call_graph_decoded':False}
    summary['declared_inheritance_type_references']=sum(e['relation']=='declared_inherits_type' for o in objects for e in o.get('relationships',[]))
    summary['declared_containment_type_references']=sum(e['relation']=='declared_contained_by_type' for o in objects for e in o.get('relationships',[]))
    summary['descriptor_slot_variants']=dict(collections.Counter(d['variant'] for o in objects for d in o.get('descriptor_slots',[])))
    summary['unknown_property_values_by_reason']=dict(collections.Counter(p['unknown_reason'] for o in objects for c in o['classes'] for p in c['properties'] if p['value_status'].startswith('unknown')))
    path=write_report('window-analysis.build.json',objects,summary)
    path=path.replace(path.with_name('window-analysis.json'))
    compact=[{'source':o['source'],'status':o['status'],'structure_status':o['structure_status'],
              'class_count':len(o['classes']),
              'property_records':sum(len(c['properties']) for c in o['classes']),
              'control_records':sum(len(c['controls']) for c in o['classes']),
              'parsed_property_values':sum(p['value_status'].startswith('parsed') for c in o['classes'] for p in c['properties']),
              'partial_property_values':sum(p['value_status'].startswith('partial') for c in o['classes'] for p in c['properties']),
              'unknown_property_values':sum(p['value_status'].startswith('unknown') for c in o['classes'] for p in c['properties']),
              'unknown_value_reasons':dict(collections.Counter(p['unknown_reason'] for c in o['classes'] for p in c['properties'] if p['value_status'].startswith('unknown'))),
              'unknowns':o['unknowns'],'report':'window-analysis.json'} for o in objects]
    write_report('window-summary.json',compact,summary)
    write_report('window-coverage.json',compact,summary)
    print(summary)
    print(path)


if __name__=='__main__':
    main()
