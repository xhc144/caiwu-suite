#!/usr/bin/env python3
"""Explicit CLI for verified static extraction, container probing and decoding."""
import argparse
import csv
import importlib
import json
from pathlib import Path
from pb_deep_common import configure

STAGES={'classify':('pb_deep_classify','main'),'windows':('pb_deep_window','main'),
        'literals':('pb_deep_literals','main'),
        'dw':('pb_deep_dw','main'),'functions':('pb_deep_functions','main'),
        'calls':('pb_deep_calls','run'),'cfb':('pb_deep_cfb','main'),
        'relations':('pb_deep_relations','main')}


def selected_manifest(source,installer_id,destination):
    with source.open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.DictReader(stream);fieldnames=reader.fieldnames
        rows=[row for row in reader if installer_id is None or row['installer']==installer_id]
    if not rows:raise ValueError('no matching installer records in manifest')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open('w',encoding='utf-8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fieldnames);writer.writeheader();writer.writerows(rows)
    return destination


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    extract=sub.add_parser('extract',help='Verify one installer, reuse one bounded zlib cache, save selected manifest records')
    extract.add_argument('--installer-file',type=Path,required=True)
    extract.add_argument('--installer-sha256',required=True)
    extract.add_argument('--installer-id',required=True)
    extract.add_argument('--manifest',type=Path,required=True)
    extract.add_argument('--stream-cache',type=Path,required=True)
    extract.add_argument('--output',type=Path,required=True)
    extract.add_argument('--evidence',type=Path,required=True)
    extract.add_argument('--record',action='append',help='Exact record number; default selects PBD suffixes only')
    extract.add_argument('--max-stream-bytes',type=int,default=512*1024*1024)
    probe=sub.add_parser('probe',help='Verify selected files and create container metadata reports')
    probe.add_argument('--manifest',type=Path,required=True)
    probe.add_argument('--installer-id')
    probe.add_argument('--payload-root',type=Path,required=True)
    probe.add_argument('--output',type=Path,required=True)
    probe.add_argument('--max-objects',type=int,default=10000)
    analyze=sub.add_parser('analyze',help='Run generic local-only decoders on complete verified container reports')
    for name in ('manifest','payload-root','container-reports','output'):
        analyze.add_argument('--'+name,type=Path,required=True)
    analyze.add_argument('--dw-profile',type=Path,help='Optional caller-owned verified property-slot profile; none is bundled')
    analyze.add_argument('--stages',nargs='+',choices=list(STAGES),default=list(STAGES))
    args=parser.parse_args(argv)
    if args.command=='extract':
        from extract_manifest import decompress_verified,recover
        if args.max_stream_bytes<=0:parser.error('positive max-stream-bytes required')
        decompress_verified(args.installer_file,args.installer_sha256,args.stream_cache,args.max_stream_bytes)
        result=recover(args.stream_cache,args.manifest,args.installer_id,args.output,args.evidence,args.record,args.max_stream_bytes)
        print(json.dumps({'verified_manifest_records_saved':len(result['payload_records'])}))
    elif args.command=='probe':
        from pb_container_probe import batch
        if args.output.resolve().is_relative_to(args.payload_root.resolve()):
            parser.error('output must be outside input payload tree')
        selection=selected_manifest(args.manifest,args.installer_id,args.output/'selected-manifest.csv')
        batch(selection,args.payload_root,args.output,32*1024*1024,100,max_objects=args.max_objects)
    else:
        configure(args.manifest,args.payload_root,args.container_reports,args.output,args.dw_profile)
        for stage in args.stages:
            module,function=STAGES[stage]
            getattr(importlib.import_module(module),function)()


if __name__=='__main__':main()
