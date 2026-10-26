// 为人工审核后发布的同版本 Release 准备校验资料；本脚本不发布任何内容。
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
const file = `caiwu-desktop-${version}-x64-setup.exe`;
const installer = path.join(desktop, 'release', file);
const hash = createHash('sha256');
for await (const chunk of createReadStream(installer)) hash.update(chunk);
const sha256 = hash.digest('hex');
const size = (await stat(installer)).size;
await writeFile(
  path.join(desktop, 'release', `caiwu-desktop-${version}-x64-update.json`),
  JSON.stringify({ schema: 1, version, file, size, sha256 }, null, 2) + '\n',
);
console.log(`已生成 ${version} 更新清单；未发布 Release`);
