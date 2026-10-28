import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 从任意工作目录运行；只使用app原锁已安装的Vitest，不下载依赖或修改registry。
const appRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    path.join(appRoot, 'node_modules/vitest/vitest.mjs'),
    'run',
    'modules/templates/supplements/party-dues/test',
    ...process.argv.slice(2),
  ],
  { cwd: appRoot, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
