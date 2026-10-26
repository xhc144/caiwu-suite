import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  UPDATE_SOURCE,
  assetUrl,
  verifyInstaller,
  verifyWindowsInstallerVersion,
  type Update,
} from '../src/updates';

const { version } = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')) as {
  version: string;
};
const manifest = JSON.parse(
  await readFile(`apps/desktop/release/caiwu-desktop-${version}-x64-update.json`, 'utf8'),
) as {
  file: string;
  size: number;
  sha256: string;
};
const update: Update = {
  ...manifest,
  name: manifest.file,
  version,
  url: assetUrl(version, manifest.file),
  page: `${UPDATE_SOURCE}/releases/tag/v${version}`,
};
const file = path.resolve('apps/desktop/release', manifest.file);
await verifyInstaller(file, update);
await verifyWindowsInstallerVersion(file, version);
console.log(
  `本分支 Windows NSIS ${version}：磁盘 SHA-256、大小、PE 头和内嵌版本核对通过；未发布 Release`,
);
