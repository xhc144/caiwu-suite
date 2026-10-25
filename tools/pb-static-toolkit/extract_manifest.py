#!/usr/bin/env python3
"""Statically decompress one verified PE overlay and recover manifest records.

Standard library only. Does not execute an installer, DLL or recovered program.
No installer-specific offsets, length masks, names or hashes are embedded.
"""
import csv
import hashlib
import json
import os
import re
import struct
import zlib
from pathlib import Path


def digest_file(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):value.update(chunk)
    return value.hexdigest()


def pe_overlay(data):
    if len(data)<64 or data[:2]!=b'MZ':raise ValueError('PE DOS header missing')
    pe=struct.unpack_from('<I',data,60)[0]
    if pe+24>len(data) or data[pe:pe+4]!=b'PE\0\0':raise ValueError('PE signature/bounds invalid')
    count=struct.unpack_from('<H',data,pe+6)[0]
    optional=struct.unpack_from('<H',data,pe+20)[0]
    start=pe+24
    if not 1<=count<=96 or optional<64 or start+optional+count*40>len(data):
        raise ValueError('PE optional/section table bounds invalid')
    if struct.unpack_from('<H',data,start)[0] not in {0x10b,0x20b}:
        raise ValueError('unsupported PE optional header')
    end=struct.unpack_from('<I',data,start+60)[0]
    for i in range(count):
        size,offset=struct.unpack_from('<II',data,start+optional+i*40+16)
        if offset+size>len(data):raise ValueError('PE section exceeds file')
        end=max(end,offset+size)
    if end>=len(data):raise ValueError('PE has no overlay')
    return end


def decompress_verified(installer,expected_sha256,cache,max_stream_bytes=512*1024*1024):
    if not re.fullmatch('[0-9a-fA-F]{64}',expected_sha256):raise ValueError('explicit SHA256 required')
    expected_sha256=expected_sha256.lower()
    if digest_file(installer)!=expected_sha256:raise ValueError('installer SHA256 mismatch; no decompression')
    proof=cache.with_name(cache.name+'.provenance.json')
    if cache.exists():
        if not proof.is_file():raise ValueError('existing stream cache lacks provenance')
        prior=json.loads(proof.read_text(encoding='utf-8'))
        if prior.get('installer_sha256')!=expected_sha256 or cache.stat().st_size>max_stream_bytes or digest_file(cache)!=prior.get('stream_sha256'):
            raise ValueError('existing stream cache provenance/hash mismatch')
        return prior
    data=installer.read_bytes();offset=pe_overlay(data)
    decoder=zlib.decompressobj();cache.parent.mkdir(parents=True,exist_ok=True)
    temporary=cache.with_name(cache.name+'.partial')
    total=0;hasher=hashlib.sha256();consumed=0;created=False
    try:
        with temporary.open('xb') as out:
            created=True
            for position in range(offset,len(data),65536):
                chunk=data[position:position+65536]
                output=decoder.decompress(chunk,max_stream_bytes-total+1)
                if len(output)>max_stream_bytes-total or decoder.unconsumed_tail:
                    raise ValueError('decompressed stream exceeds byte limit')
                out.write(output);hasher.update(output);total+=len(output)
                if decoder.eof:
                    consumed=position-offset+len(chunk)-len(decoder.unused_data)
                    break
            if not decoder.eof:raise ValueError('zlib stream incomplete')
            output=decoder.flush()
            if total+len(output)>max_stream_bytes:raise ValueError('decompressed stream exceeds byte limit')
            out.write(output);hasher.update(output);total+=len(output)
        os.link(temporary,cache)  # Exclusive publication; another writer is never replaced.
        temporary.unlink()
    except BaseException:
        if created:temporary.unlink(missing_ok=True)
        raise
    result={'installer_sha256':expected_sha256,'installer_bytes':len(data),
            'stream_file_offset':offset,'compressed_stream_bytes':consumed,
            'trailing_installer_bytes':len(data)-offset-consumed,'stream_bytes':total,
            'stream_sha256':hasher.hexdigest(),'decompressor':'Python_stdlib_zlib',
            'original_program_executed':False,'upload_permitted':False}
    proof.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result


def recover(stream,manifest,installer_id,output,evidence,records=None,max_stream_bytes=512*1024*1024):
    if stream.stat().st_size>max_stream_bytes:raise ValueError('stream exceeds input limit')
    data=stream.read_bytes()
    with manifest.open(encoding='utf-8-sig',newline='') as source:
        rows=[r for r in csv.DictReader(source) if r['installer']==installer_id and
              (r['record'] in records if records is not None else r['original_destination'].lower().endswith('.pbd'))]
    if not rows:raise ValueError('no selected manifest records')
    selected={}
    for row in rows:
        selected.setdefault((row['original_destination'],int(row['bytes'])),[]).append(row)
    matches={r['record']:[] for r in rows}
    for marker in re.finditer(rb'OBJECT_TYPE=FILE\r\n',data):
        start=marker.start()
        if start<4:continue
        age=data.find(b'\r\nFILE_AGE=',start,min(len(data),start+8192))
        if age<0:continue
        digit_start=age+len(b'\r\nFILE_AGE=');digit_end=digit_start
        while digit_end<len(data) and digit_end-digit_start<20 and 48<=data[digit_end]<=57:digit_end+=1
        for end in range(digit_start+1,digit_end+1):
            metadata=data[start:end]
            if len(metadata)>8192 or b'\0' in metadata:continue
            destination=re.search(rb'\r\nDESTINATION=([^\r\n]+)\r\n',metadata)
            if destination is None or end+4>len(data):continue
            mask=struct.unpack_from('<I',data,start-4)[0]^(end-start)
            size=struct.unpack_from('<I',data,end)[0]^mask
            location=end+4
            key=(destination.group(1).decode('cp936'),size)
            if key not in selected or location+size>len(data):continue
            payload=data[location:location+size];value=hashlib.sha256(payload).hexdigest()
            for row in selected[key]:
                if value==row['sha256']:
                    matches[row['record']].append({'metadata_offset':start,'metadata_bytes':end-start,
                                                 'stream_offset':location,'bytes':size,'length_xor':mask,
                                                 'payload':payload})
    masks=set();planned=[];targets=set()
    for row in rows:
        candidates=matches[row['record']]
        if len(candidates)!=1:raise ValueError('expected unique destination/size/hash match for record '+row['record'])
        candidate=candidates[0];masks.add(candidate['length_xor'])
        relative=Path(row['materialized_relative_path']);target=(output/relative).resolve()
        if relative.is_absolute() or not target.is_relative_to(output.resolve()):raise ValueError('manifest output path escapes root')
        if target in targets:raise ValueError('duplicate selected output path')
        targets.add(target)
        if target.exists():raise FileExistsError('refusing to overwrite manifest record output')
        planned.append((row,candidate,target))
    if len(masks)!=1:raise ValueError('selected FILE records disagree on inferred length coding')
    outputs=[]
    for row,candidate,target in planned:
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as out:out.write(candidate['payload'])
        outputs.append({'record_id':installer_id+':'+row['record'],'sha256':row['sha256'],
                        'materialized_relative_path':row['materialized_relative_path'],
                        **{k:v for k,v in candidate.items() if k!='payload'},
                        'verification':'exact_manifest_destination_size_sha256'})
    result={'manifest_sha256':digest_file(manifest),'stream_sha256':hashlib.sha256(data).hexdigest(),
            'inferred_length_xor':next(iter(masks)),'payload_records':outputs,
            'original_program_executed':False,'upload_permitted':False}
    evidence.parent.mkdir(parents=True,exist_ok=True)
    evidence.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return result
