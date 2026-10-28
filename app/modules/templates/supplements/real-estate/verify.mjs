import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(directory, '../../../..');
for (const args of [
  [
    'node_modules/typescript/bin/tsc',
    '--project',
    path.join(directory, 'tsconfig.json'),
    '--noEmit',
  ],
  ['node_modules/vitest/vitest.mjs', 'run', 'modules/templates/supplements/real-estate/test'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: app, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
