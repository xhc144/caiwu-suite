// 13.0.3 的 binding.gyp 遇到自带 N-API prebuild 会跳过编译，loader 也优先选 prebuild。
// 仅移除本次独立安装的 Windows x64 prebuild，随后用 electron-builder 为 Electron 重编译。
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('SQLite 安装准备仅支持 Windows x64 runner，请勿在其他平台交叉重编译');
}
const loadModule = createRequire(import.meta.url);
const metadata = loadModule.resolve('better-sqlite3/package.json');
if (JSON.parse(readFileSync(metadata, 'utf8')).version !== '13.0.3') {
  throw new Error('SQLite 版本与冻结依赖不同，请先审查新的原生模块加载方式');
}
rmSync(path.join(path.dirname(metadata), 'prebuilds', 'win32-x64.node'), { force: true });
console.log('已准备 SQLite 源码重编译：Windows x64 将使用 Electron 重编译结果');
