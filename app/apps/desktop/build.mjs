// 打包主进程、preload 和本地服务（给打包后的 utilityProcess 用）。
// 安装包（electron-builder，Windows NSIS）由桌面壳任务完善：pnpm -C apps/desktop exec electron-builder --win
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIcon } from './build/create-icon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
createIcon(path.join(here, 'dist/icon.ico'));
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(here, 'dist/main.cjs'),
  external: ['electron', 'better-sqlite3'],
});
await build({
  ...common,
  entryPoints: [path.join(here, 'src/preload.ts')],
  outfile: path.join(here, 'dist/preload.cjs'),
  external: ['electron'],
});
await build({
  ...common,
  entryPoints: [path.join(here, 'src/server-entry.ts')],
  outfile: path.join(here, 'dist/server.cjs'),
  // 原生模块不打包，安装包里单独带上并为 Electron 重新编译
  external: ['better-sqlite3'],
  // 打包后 import.meta.url 不可用；服务端只在没给 CAIWU_DATA_DIR 时才用它（Electron 总会给）
  define: { 'import.meta.url': '"file:///caiwu-server.cjs"' },
});
