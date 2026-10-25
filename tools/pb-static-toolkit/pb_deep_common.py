"""Explicitly configured, hash-verified object views for read-only PB analysis."""
import csv
import hashlib
import json
import struct
from dataclasses import dataclass
from pathlib import Path

SCHEMA_VERSION='pb-local-deep-1'
_settings=None


def sha(data):
    return hashlib.sha256(data).hexdigest()


@dataclass
class Settings:
    manifest: Path
    payload_root: Path
    container_reports: Path
    output: Path
    dw_profile: Path | None=None
    max_file_bytes: int=128*1024*1024


def configure(manifest,payload_root,container_reports,output,dw_profile=None,max_file_bytes=128*1024*1024):
    global _settings
    settings=Settings(Path(manifest),Path(payload_root),Path(container_reports),Path(output),
                      Path(dw_profile) if dw_profile else None,max_file_bytes)
    if max_file_bytes<=0:
        raise ValueError('positive file byte limit required')
    if settings.output.resolve().is_relative_to(settings.payload_root.resolve()):
        raise ValueError('output must be outside payload input tree')
    _settings=settings
    return settings


def get_settings(required=True):
    if required and _settings is None:
        raise ValueError('explicit manifest/payload-root/container-reports/output configuration required')
    return _settings


@dataclass
class ObjectView:
    source: dict
    payload: bytes
    segments: list
    container: dict

    def spans(self,start,size):
        if start<0 or size<0 or start+size>len(self.payload):
            raise ValueError('object range outside verified payload')
        result=[]
        for segment in self.segments:
            a=max(start,segment['object_offset'])
            b=min(start+size,segment['object_offset']+segment['bytes'])
            if a<b:
                result.append({'file_offset':segment['file_offset']+a-segment['object_offset'],
                               'bytes':b-a,'object_offset':a})
        if sum(item['bytes'] for item in result)!=size:
            raise ValueError('segment map does not cover requested range exactly')
        return result

    def field(self,offset,size,value,interpretation):
        return {'value':value,'object_offset':offset,'bytes':size,
                'file_spans':self.spans(offset,size),'interpretation':interpretation}


def _inside(root,relative):
    path=(root/relative).resolve()
    if Path(relative).is_absolute() or not path.is_relative_to(root.resolve()):
        raise ValueError('input path outside declared root')
    return path


def _payload(data,obj,encoding):
    entry=obj['entry_offset'];node=obj['node_offset']
    delta=4 if encoding=='utf-16le' else 0
    entry_size=24+delta
    if node<0 or node+3072>len(data) or data[node:node+4]!=b'NOD*':
        raise ValueError('object node location invalid')
    if not node+32<=entry or entry+entry_size>node+3072 or data[entry:entry+4]!=b'ENT*':
        raise ValueError('object entry location invalid')
    pointer,size=struct.unpack_from('<II',data,entry+8+delta)
    name_size=struct.unpack_from('<H',data,entry+22+delta)[0]
    name_start=entry+entry_size
    if name_size==0 or name_start+name_size>node+3072:
        raise ValueError('object name bounds invalid')
    raw_name=data[name_start:name_start+name_size]
    if raw_name.decode(encoding).rstrip('\0')!=obj['name'] or sha(raw_name)!=obj['name_raw_sha256']:
        raise ValueError('object name differs from container report')
    if size!=obj['declared_bytes'] or pointer!=obj['first_data_block_raw']:
        raise ValueError('object entry fields differ from container report')
    parts=[];seen=set();logical=0
    for segment in obj['data_segments']:
        if pointer in seen or pointer%512 or pointer+10>len(data) or data[pointer:pointer+4]!=b'DAT*':
            raise ValueError('invalid/cyclic raw DAT chain')
        seen.add(pointer)
        next_pointer,length=struct.unpack_from('<IH',data,pointer+4)
        if length>502 or pointer+10+length>len(data):
            raise ValueError('DAT length outside bounds')
        expected={'object_offset':logical,'file_offset':pointer+10,'bytes':length,
                  'block_offset':pointer,'next_block_raw':next_pointer}
        if expected!=segment:
            raise ValueError('raw DAT chain differs from reported segment map')
        parts.append(data[pointer+10:pointer+10+length]);logical+=length;pointer=next_pointer
    payload=b''.join(parts)
    if pointer!=0 or len(payload)!=size or sha(payload)!=obj['logical_data_sha256']:
        raise ValueError('object logical size/hash/chain termination mismatch')
    return payload


def iter_views(settings=None):
    settings=settings or get_settings()
    with settings.manifest.open(encoding='utf-8-sig',newline='') as stream:
        rows=list(csv.DictReader(stream))
    manifest={}
    for row in rows:
        key=row['installer']+':'+row['record']
        if key in manifest:
            raise ValueError('duplicate installer:record identifier in manifest')
        manifest[key]=row
    reports=settings.container_reports
    index=json.loads((reports/'index.json').read_text(encoding='utf-8'))
    aliases={}
    for record in index['records']:
        if record.get('status')=='container_parsed':
            aliases.setdefault(record['expected_sha256'],[]).append(record['record_id'])
    seen=set()
    for record in index['records']:
        # Missing/rejected files remain in the container index, never become objects.
        if record.get('status')!='container_parsed':
            continue
        row=manifest[record['record_id']]
        if record['expected_sha256']!=row['sha256']:
            raise ValueError('index and selected manifest disagree')
        file=_inside(settings.payload_root,row['materialized_relative_path'])
        if file.stat().st_size!=int(row['bytes']) or file.stat().st_size>settings.max_file_bytes:
            raise ValueError('input file size mismatch/limit')
        with file.open('rb') as stream:
            data=stream.read(settings.max_file_bytes+1)
        if len(data)!=int(row['bytes']) or sha(data)!=row['sha256']:
            raise ValueError('input file hash/size mismatch')
        if row['sha256'] in seen:
            continue
        seen.add(row['sha256'])
        report=json.loads(_inside(reports,record['report']).read_text(encoding='utf-8'))
        if report['sha256']!=row['sha256'] or report['status']!='container_parsed':
            raise ValueError('container report is incomplete or mismatched')
        for library in report['libraries']:
            if library['status']!='container_parsed':
                raise ValueError('partial library cannot become a complete object view')
            for obj in library['objects']:
                if obj['chain_status']!='complete' or obj['errors']:
                    raise ValueError('partial object cannot become a complete view')
                payload=_payload(data,obj,library['header_encoding'])
                source={'object_id':row['sha256']+':'+str(obj['entry_offset']),
                        'record_id':record['record_id'],'pbd_sha256':row['sha256'],
                        'pbd_relative_path':row['materialized_relative_path'],
                        'header_offset':library['header_offset'],'node_offset':obj['node_offset'],
                        'entry_offset':obj['entry_offset'],'name':obj['name'],
                        'extension':obj['entry_extension'],'logical_bytes':len(payload),
                        'logical_sha256':sha(payload),'record_aliases':aliases[row['sha256']]}
                yield ObjectView(source,payload,obj['data_segments'],obj)


def write_report(name,objects,summary):
    settings=get_settings();output=_inside(settings.output,name)
    output.parent.mkdir(parents=True,exist_ok=True)
    report={'schema_version':SCHEMA_VERSION,'original_program_executed':False,
            'upload_permitted':False,'summary':summary,'objects':objects}
    temporary=output.with_name(output.name+'.tmp')
    temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temporary.replace(output)
    return output
