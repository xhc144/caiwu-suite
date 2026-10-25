#!/usr/bin/env python3
"""Fetch exact official NSIS; optionally compile its native Linux compiler. No Windows EXE is run."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import urllib.request
import zipfile


def download(url, digest, destination):
    with urllib.request.urlopen(url, timeout=60) as response, destination.open('xb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    with destination.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != digest:
        raise RuntimeError('Official download SHA256 mismatch; extraction aborted')


def unzip(archive, root):
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            relative = Path(member.filename)
            if relative.is_absolute() or '..' in relative.parts or ':' in member.filename or '\\' in member.filename:
                raise RuntimeError('Unsafe archive member')
        source.extractall(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--native', action='store_true', help='Build POSIX compiler with existing g++ and pinned SCons wheel')
    options = parser.parse_args()
    lock = json.loads((Path(__file__).parent / 'toolchain.lock.json').read_text())
    root = options.destination.resolve()
    if root.exists() and any(root.iterdir()):
        raise RuntimeError('Destination must be a new empty tool directory')
    root.mkdir(parents=True, exist_ok=True)
    distribution = root / 'official-distribution.zip'
    nsis = lock['nsis']
    download(nsis['distributionUrl'], nsis['distributionSha256'], distribution)
    unzip(distribution, root)
    nsis_root = root / ('nsis-' + nsis['version'])
    if options.native:
        archive = root / 'official-source.tar.bz2'
        download(nsis['sourceUrl'], nsis['sourceSha256'], archive)
        with tarfile.open(archive) as source:
            source.extractall(root, filter='data')
        wheel = root / 'scons.whl'
        download(lock['scons']['url'], lock['scons']['sha256'], wheel)
        libraries = root / 'python-libs'
        unzip(wheel, libraries)
        environment = os.environ.copy()
        environment['PYTHONPATH'] = str(libraries)
        environment['SOURCE_DATE_EPOCH'] = '1790467200'
        subprocess.run([sys.executable, '-m', 'SCons', '-j4', 'VERSION=3.13', 'VER_MAJOR=3', 'VER_MINOR=13',
                        'VER_REVISION=0', 'VER_BUILD=0', 'SKIPSTUBS=all', 'SKIPPLUGINS=all', 'SKIPUTILS=all',
                        'SKIPMISC=all', 'NSIS_CONFIG_CONST_DATA_PATH=no', f'PREFIX={nsis_root / "Bin"}', 'install-compiler'],
                       cwd=root / 'nsis-3.13-src', env=environment, check=True)
        print(nsis_root / 'Bin/makensis')
    else:
        print(nsis_root / 'makensis.exe')


if __name__ == '__main__':
    main()
