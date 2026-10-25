#!/usr/bin/env python3
"""Pinned win-x64 build; never installs, signs, publishes, or accesses accounting data."""
import argparse
import datetime
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SDK = '10.0.402'
RUNTIME = '10.0.13'
NSIS = 'v3.13'


def run(command, *, capture=False, env=None):
    result = subprocess.run([str(p) for p in command], cwd=ROOT, env=env, check=True,
                            text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def ensure_delivery_allowed(root):
    pause = Path(root) / 'docs/acceptance/DELIVERY_PAUSED.md'
    if pause.exists() or pause.is_symlink():
        raise RuntimeError('Independent acceptance has paused distribution. Resolve docs/acceptance/DELIVERY_PAUSED.md through its owning review; no installer or distribution ZIP is generated.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True, help='Explicit four-part Windows product version')
    parser.add_argument('--dotnet', default='dotnet', help='dotnet executable or tools/dotnet-local.sh')
    parser.add_argument('--makensis', required=True, help='Pinned NSIS 3.13 compiler from official distribution')
    parser.add_argument('--out', type=Path, required=True, help='New empty artifact directory')
    parser.add_argument('--refresh-locks', action='store_true', help='Maintainer-only explicit NuGet lock refresh')
    parser.add_argument('--allow-dirty', action='store_true', help='Local preview only; recorded in build provenance')
    parser.add_argument('--skip-tests', action='store_true')
    parser.add_argument('--managed-data-contract', action='store_true',
                        help='Explicitly adopt the independently reviewed managed App composition; does not bypass delivery hold')
    parser.add_argument('--expected-commit', help='Full clean source SHA required for managed production packaging')
    options = parser.parse_args()
    ensure_delivery_allowed(ROOT)
    if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', options.version) or any(int(n) > 65535 for n in options.version.split('.')):
        raise RuntimeError('Version must contain four Windows version components in 0..65535')
    if options.managed_data_contract:
        if not options.expected_commit or not re.fullmatch(r'[0-9a-f]{40}', options.expected_commit):
            raise RuntimeError('Managed production packaging requires --expected-commit with the reviewed full SHA')
        if options.allow_dirty or options.refresh_locks:
            raise RuntimeError('Managed production packaging requires clean source and frozen dependency locks')
    if run([options.dotnet, '--version'], capture=True) != SDK:
        raise RuntimeError(f'Exact official SDK {SDK} is required')
    if run([options.makensis, '-VERSION'], capture=True) != NSIS:
        raise RuntimeError('Exact NSIS 3.13 is required')
    commit = run(['git', 'rev-parse', 'HEAD'], capture=True)
    dirty = bool(run(['git', 'status', '--porcelain', '--untracked-files=normal'], capture=True))
    if options.expected_commit and commit != options.expected_commit:
        raise RuntimeError('Source HEAD does not match --expected-commit')
    source_tree = run(['git', 'rev-parse', 'HEAD:src'], capture=True)
    if dirty and not options.allow_dirty:
        raise RuntimeError('Commit the source tree first; --allow-dirty only builds an explicitly marked local preview')
    epoch = int(run(['git', 'show', '-s', '--format=%ct', 'HEAD'], capture=True))
    environment = os.environ.copy()
    environment['SOURCE_DATE_EPOCH'] = str(epoch)
    environment['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1'
    environment['DOTNET_GENERATE_ASPNET_CERTIFICATE'] = 'false'
    out = options.out.resolve()
    if out.exists() and any(out.iterdir()):
        raise RuntimeError('Artifact output must be empty; existing files are never deleted')
    out.mkdir(parents=True, exist_ok=True)
    helper_project = ROOT / 'packaging-next/src/Caiwu.Delivery.Host/Caiwu.Delivery.Host.csproj'
    desktop_project = ROOT / 'src/Caiwu.Desktop/Caiwu.Desktop.csproj'
    if not options.skip_tests:
        run([options.dotnet, 'restore', ROOT / 'tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj', '--locked-mode'], env=environment)
        run([options.dotnet, 'run', '--project', ROOT / 'tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj',
             '-c', 'Release', '--no-restore', '--', out / 'delivery-tests.json'], env=environment)
    # Component tests build the codec-free library CLI; build the composition host explicitly.
    run([options.dotnet, 'restore', helper_project, '--locked-mode'], env=environment)
    run([options.dotnet, 'build', helper_project, '-c', 'Release', '--no-restore', '--nologo'], env=environment)
    cli = helper_project.parent / 'bin/Release/net10.0/Caiwu.Delivery.Host.dll'
    # This import redirects graph-wide lock files into this owner's directory. Root projects remain untouched.
    base_common = [f'-p:CustomAfterMicrosoftCommonTargets={ROOT / "packaging-next/Delivery.restore.targets"}',
              f'-p:RuntimeFrameworkVersion={RUNTIME}', '-p:TargetLatestRuntimePatch=false', '-p:DeliveryLibraryOnly=true']
    version = [f'-p:Version={options.version}', f'-p:AssemblyVersion={options.version}',
               f'-p:FileVersion={options.version}', f'-p:InformationalVersion={options.version}+{commit}',
               f'-p:SourceRevisionId={commit}', '-p:ContinuousIntegrationBuild=true',
               f'-p:PathMap={ROOT}=/_/', '-p:DebugType=embedded', '-p:PublishReadyToRun=false']
    payload = out / 'payload'
    helper = out / 'helper'
    for project, destination, single in [(desktop_project, payload, False), (helper_project, helper, True)]:
        common = [*base_common, '-p:DeliveryLockGraph=' + ('host' if single else 'desktop')]
        special = [f'-p:PublishSingleFile={str(single).lower()}']
        if single:
            special += ['-p:IncludeNativeLibrariesForSelfExtract=true']
        restore = [options.dotnet, 'restore', project, '-r', 'win-x64', *common, *special]
        if not options.refresh_locks:
            restore.append('--locked-mode')
        run(restore, env=environment)
        run([options.dotnet, 'publish', project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
             '--no-restore', '-o', destination, *common, *version, *special], env=environment)
    shutil.copy2(helper / 'Caiwu.Delivery.Host.exe', payload / 'Caiwu.Delivery.exe')
    shutil.copy2(ROOT / 'packaging-next/update-policy.disabled.json', payload / 'update-policy.json')
    notices = payload / 'delivery-notices'
    notices.mkdir()
    for name in ['THIRD-PARTY-NOTICES.md', 'NSIS-COPYING.txt']:
        shutil.copy2(ROOT / 'packaging-next' / name, notices / name)
    shutil.copy2(ROOT / 'packaging-next/licenses/Apache-2.0.txt', notices / 'Apache-2.0.txt')
    shutil.copy2(ROOT / 'docs/user-guide/INSTALL_AND_USE.zh-CN.md', notices / 'INSTALL_AND_USE.zh-CN.md')
    # Runtime NuGet packs contain the official redistribution notices; retain them in the payload.
    assets = json.loads((helper_project.parent / 'obj/project.assets.json').read_text(encoding='utf-8'))
    for package, names in [('microsoft.netcore.app.runtime.win-x64', ['LICENSE.TXT', 'THIRD-PARTY-NOTICES.TXT']),
                           ('microsoft.windowsdesktop.app.runtime.win-x64', ['LICENSE'])]:
        for name in names:
            matches = [Path(folder) / package / RUNTIME / name for folder in assets['packageFolders']]
            source = next((p for p in matches if p.is_file()), None)
            if source is None:
                raise RuntimeError(f'Missing official runtime redistribution notice: {package}/{name}')
            shutil.copy2(source, notices / (package + '-' + name))
    for required in ['Caiwu.Desktop.exe', 'Caiwu.Delivery.exe', 'coreclr.dll', 'hostfxr.dll', 'PresentationFramework.dll', 'e_sqlite3.dll']:
        if not (payload / required).is_file():
            raise RuntimeError(f'Self-contained payload dependency is missing: {required}')
    for executable in ['Caiwu.Desktop.exe', 'Caiwu.Delivery.exe']:
        data = (payload / executable).read_bytes()
        pe = struct.unpack_from('<I', data, 0x3c)[0]
        if data[:2] != b'MZ' or data[pe:pe + 4] != b'PE\x00\x00' or struct.unpack_from('<H', data, pe + 4)[0] != 0x8664:
            raise RuntimeError(f'Expected a Windows x64 PE host: {executable}')
    manifest_command = 'manifest-managed' if options.managed_data_contract else 'manifest'
    run([options.dotnet, cli, manifest_command, payload, options.version, commit], env=environment)
    manifest = json.loads((payload / 'payload-manifest.json').read_text(encoding='utf-8'))
    if manifest['managedDataContract'] != options.managed_data_contract:
        raise RuntimeError('Generated manifest capability does not match the explicit build selection')
    run([options.dotnet, cli, 'verify', payload], env=environment)
    if not options.allow_dirty and (run(['git', 'rev-parse', 'HEAD'], capture=True) != commit or
                                   run(['git', 'status', '--porcelain', '--untracked-files=normal'], capture=True)):
        raise RuntimeError('Source changed during publish; freeze changed dependencies in a commit before packaging')
    ensure_delivery_allowed(ROOT)
    installer = out / f'caiwu-{options.version}-win-x64-setup.exe'
    definitions = {'PAYLOAD': payload, 'HELPER': helper / 'Caiwu.Delivery.Host.exe', 'OUTPUT': installer,
                   'PRODUCT_VERSION': options.version}
    run([options.makensis, '-V2', '-NOCONFIG', *[f'-D{k}={v}' for k, v in definitions.items()],
         ROOT / 'packaging-next/installer/Caiwu.nsi'], env=environment)
    # Fixed ordering, timestamp, attributes and no platform-dependent compression implementation.
    # The managed App requires installer activation/receipts; this is a payload archive.
    archive = out / f'caiwu-{options.version}-win-x64-payload.zip'
    timestamp = datetime.datetime.fromtimestamp(max(315532800, epoch), datetime.timezone.utc)
    zip_time = tuple(timestamp.timetuple()[:6])
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as target:
        for source in sorted(payload.rglob('*')):
            if source.is_file():
                info = zipfile.ZipInfo(source.relative_to(payload).as_posix(), zip_time)
                info.create_system = 0
                info.external_attr = 0x20
                target.writestr(info, source.read_bytes())
    provenance = {
        'schema': 1, 'product': 'Caiwu Suite development preview', 'version': options.version,
        'commit': commit, 'productionSourceTree': source_tree, 'sourceTreeDirty': dirty, 'sourceDateEpoch': epoch,
        'sdk': SDK, 'runtime': RUNTIME, 'rid': 'win-x64', 'selfContained': True,
        'nsis': NSIS, 'compressor': 'zlib', 'signed': False, 'trustedUpdateChannel': False,
        'managedDataIntegration': options.managed_data_contract, 'windowsRuntimeValidated': False,
        'launcherCommand': 'launch-managed',
        'payloadManifestSha256': sha(payload / 'payload-manifest.json'),
        'payloadFiles': manifest['files'],
        'archivePurpose': 'payload inspection; managed activation requires the installer',
        'files': [{'path': p.name, 'bytes': p.stat().st_size, 'sha256': sha(p)} for p in [installer, archive]],
    }
    (out / 'release-manifest.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.relative_to(out).as_posix()}\n' for p in [installer, archive, payload / 'payload-manifest.json']), encoding='utf-8')
    print(json.dumps(provenance, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Build failed: {error}', file=sys.stderr)
        sys.exit(1)
