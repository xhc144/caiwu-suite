#!/usr/bin/env node
// 开发模式：同时启动本地服务（改代码自动重启）和 vite（页面热更新），两者共用一个随机令牌。
// 打开 http://localhost:5173 。数据放在 app/.data（已 gitignore）。
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
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

// 直接用当前 node 运行 tsx / vite 的入口脚本，不经过 pnpm 的 .cmd 包装：
// Windows 上 spawn('pnpm') 找不到可执行文件（ENOENT），而经 shell 启动又无法可靠地结束子进程。
const webRoot = path.join(appRoot, 'apps/web');
const binOf = (fromDir, pkg, rel) =>
  path.join(path.dirname(createRequire(path.join(fromDir, 'package.json')).resolve(`${pkg}/package.json`)), rel);
const tsxCli = binOf(appRoot, 'tsx', 'dist/cli.mjs');
const viteCli = binOf(webRoot, 'vite', 'bin/vite.js');

const procs = [
  ['server', appRoot, [tsxCli, 'watch', '--clear-screen=false', 'apps/server/src/main.ts']],
  ['web', webRoot, [viteCli]],
].map(([name, cwd, args]) => {
  const p = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

console.log(`[dev] 打开 http://127.0.0.1:${process.env.CAIWU_WEB_PORT ?? '5173'}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
