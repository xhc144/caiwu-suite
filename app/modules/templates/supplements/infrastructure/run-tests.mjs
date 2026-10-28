import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../../../../', import.meta.url));
const vitest = fileURLToPath(
  new URL('../../../../node_modules/vitest/vitest.mjs', import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [vitest, 'run', 'modules/templates/supplements/infrastructure', ...process.argv.slice(2)],
  { cwd: app, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
