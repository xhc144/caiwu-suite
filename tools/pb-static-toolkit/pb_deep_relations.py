"""Declared class type relationships with explicit unresolved external targets.

No cross-library target is selected by matching names, and no call edge is made.
"""
import collections
from pb_deep_common import iter_views,write_report
from pb_deep_window import structural_layout,build_type_resolver


def analyze(view):
    layout=structural_layout(view.payload);resolve=build_type_resolver(layout)
    local=collections.defaultdict(list)
    for cl in layout['classes']:
        local[cl['slot'][1]].append(cl)
    classes=[]
    for cl in layout['classes']:
        identity=resolve(cl['slot'][1])
        node_id=view.source['object_id']+':class:'+str(cl['slot_offset'])
        target=resolve(cl['definition'][0])
        inherit={'relation':'declared_inheritance_type_reference','source_class_id':node_id,
                 'target_type':target,'target_scope':'same_object_type_symbol_table',
                 'field':view.field(cl['definition_offset'],2,cl['definition'][0],'declared_inherited_type_reference'),
                 'external_class_target_status':'unknown_not_selected_by_name'}
        if target.get('type_name_offset') is not None:
            inherit['target_name_evidence']=view.field(target['type_name_offset'],target['type_name_bytes'],target['name'],'referenced_declared_type_name')
        raw=cl['definition'][1];parent=resolve(raw)
        containment={'relation':'declared_containing_parent_reference','source_class_id':node_id,
                     'field':view.field(cl['definition_offset']+2,2,raw,'declared_parent_type_reference'),
                     'target_type':parent,'status':'none' if parent['resolution']=='none_sentinel' else 'unknown'}
        candidates=local.get(raw,[])
        if len(candidates)==1:
            other=candidates[0]
            containment.update(status='parsed_exact_same_object_type_index',
                               target_class_id=view.source['object_id']+':class:'+str(other['slot_offset']),
                               target_identity_field=view.field(other['slot_offset']+2,2,raw,'exact_matching_class_slot_type_index'))
        classes.append({'class_id':node_id,'class_type':identity,'slot_offset':cl['slot_offset'],
                        'declared_inheritance':inherit,'containment':containment})
    return {'source':view.source,'status':'partial','classes':classes,
            'unknowns':['external_ancestor_definition_binding','inherited_effective_properties','runtime_dispatch'],
            'call_edges':[]}


def main():
    objects=[analyze(view) for view in iter_views() if view.source['extension'] in {'fun','win','men','udo','str','apl'}]
    classes=[cl for obj in objects for cl in obj['classes']]
    summary={'objects':len(objects),'class_definitions':len(classes),
             'declared_inheritance_type_references':len(classes),
             'containment_status':dict(collections.Counter(cl['containment']['status'] for cl in classes)),
             'cross_PBD_inheritance_bindings':0,'call_edges':0,
             'name_matching_used_to_select_targets':False}
    write_report('class-relations.json',objects,summary)
    coverage=[{'source':o['source'],'status':o['status'],'class_definitions':len(o['classes']),
               'declared_inheritance_type_references':len(o['classes']),
               'local_containment_edges':sum(c['containment']['status']=='parsed_exact_same_object_type_index' for c in o['classes']),
               'external_inheritance_binding':'unknown','call_edges':0} for o in objects]
    write_report('relation-coverage.json',coverage,summary)
    print(summary)


if __name__=='__main__':main()
