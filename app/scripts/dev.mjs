#!/usr/bin/env node
// 开发模式：同时启动本地服务（改代码自动重启）和 vite（页面热更新），两者共用一个随机令牌。
// 打开 http://localhost:5173 。数据放在 app/.data（已 gitignore）。
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen-modules.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
generate();
const token = `dev-${randomBytes(8).toString('hex')}`;
const serverPort = process.env.CAIWU_SERVER_PORT ?? '3210';
const env = {
  ...process.env,
  CAIWU_TOKEN: token,
  VITE_CAIWU_TOKEN: token,
  CAIWU_DEV: '1',
  CAIWU_PORT: serverPort,
  CAIWU_SERVER_PORT: serverPort,
};

const procs = [
  ['server', 'pnpm', ['exec', 'tsx', 'watch', '--clear-screen=false', 'apps/server/src/main.ts']],
  ['web', 'pnpm', ['-C', 'apps/web', 'exec', 'vite']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((line) => console.log(`[${name}] ${line}`));
  p.stdout.on('data', prefix);
  p.stderr.on('data', prefix);
  p.on('exit', (code) => {
    console.log(`[${name}] 退出（${code}）`);
    for (const other of procs) other.kill();
    process.exit(code ?? 0);
  });
  return p;
});

console.log('[dev] 打开 http://localhost:5173');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
