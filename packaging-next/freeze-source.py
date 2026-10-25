#!/usr/bin/env python3
"""Inventory one immutable Git commit without building or copying source content."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def git(*arguments):
    return subprocess.check_output(['git', *arguments], cwd=ROOT)


def inventory(reference):
    commit = git('rev-parse', '--verify', reference + '^{commit}').decode().strip()
    entries = []
    for record in git('ls-tree', '-r', '-z', '--full-tree', commit).split(b'\0'):
        if not record:
            continue
        metadata, path = record.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        if kind != 'blob':
            raise RuntimeError('Submodules require a separately reviewed source freeze')
        entries.append((mode, oid, path.decode('utf-8')))
    # Read immutable blobs, never working-tree files or untracked/private inputs.
    batch = subprocess.run(['git', 'cat-file', '--batch'], cwd=ROOT, check=True,
                           input=''.join(oid + '\n' for _, oid, _ in entries).encode(),
                           stdout=subprocess.PIPE).stdout
    cursor = 0
    files = []
    for mode, oid, path in entries:
        end = batch.index(b'\n', cursor)
        actual, kind, length = batch[cursor:end].decode().split()
        if actual != oid or kind != 'blob':
            raise RuntimeError('Git blob identity mismatch')
        cursor = end + 1
        size = int(length)
        data = batch[cursor:cursor + size]
        cursor += size + 1
        files.append(dict(path=path, mode=mode, gitBlob=oid, bytes=size,
                          sha256=hashlib.sha256(data).hexdigest()))
    return dict(schema=1, sourceCommit=commit,
                sourceTree=git('rev-parse', commit + '^{tree}').decode().strip(),
                productionSourceTree=git('rev-parse', commit + ':src').decode().strip(),
                packagingSourceTree=git('rev-parse', commit + ':packaging-next/src').decode().strip(),
                generatedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                generatedFromGitObjects=True, sourceContentCopied=False,
                deliveryPaused=any(f['path'] == 'docs/acceptance/DELIVERY_PAUSED.md' for f in files),
                fileCount=len(files), files=files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True, help='Exact commit or ref to resolve and freeze')
    parser.add_argument('--out', required=True, type=Path, help='New JSON path; never overwrites')
    options = parser.parse_args()
    report = inventory(options.commit)
    options.out.parent.mkdir(parents=True, exist_ok=True)
    with options.out.open('x', encoding='utf-8') as target:
        json.dump(report, target, ensure_ascii=False, indent=2)
        target.write('\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'files'}, ensure_ascii=False))
    print('Inventory SHA256: ' + hashlib.sha256(options.out.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
