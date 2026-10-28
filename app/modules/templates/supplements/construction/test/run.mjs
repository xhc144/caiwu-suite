#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
const directory = path.relative(appRoot, fileURLToPath(new URL('.', import.meta.url)));
const result = spawnSync(
  process.execPath,
  [path.join(appRoot, 'node_modules/vitest/vitest.mjs'), 'run', directory],
  {
    cwd: appRoot,
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
