import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDataOutsideInstall, canonicalPath, treesOverlap } from '../data-safety';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm21-data-safety-'));
  dirs.push(dir);
  return dir;
};

it('安装目录与数据目录双向相交均拒绝，父目录的 books 正好是安装位置也拒绝', () => {
  const root = temp();
  const install = path.join(root, '财务软件', 'books');
  mkdirSync(install, { recursive: true });
  for (const candidate of [install, path.join(install, 'data'), path.dirname(install), root]) {
    expect(() => assertDataOutsideInstall(candidate, install)).toThrow(/相交/);
  }
  expect(() => assertDataOutsideInstall(path.join(root, '独立账套'), install)).not.toThrow();
  expect(() => assertDataOutsideInstall(path.join(root, '独立账套'), install, install)).toThrow(
    /相交/,
  );
});

it('Windows 大小写、UNC 路径和路径段边界正确，前缀同名的相邻目录不误判', () => {
  expect(treesOverlap('C:\\Finance', 'c:\\finance\\BOOKS', path.win32)).toBe(true);
  expect(treesOverlap('C:\\Finance\\books\\data', 'c:\\FINANCE\\books', path.win32)).toBe(true);
  expect(treesOverlap('C:\\Finance\\app', 'C:\\Finance\\app-next', path.win32)).toBe(false);
  expect(
    treesOverlap('\\\\server\\Share\\Finance', '\\\\SERVER\\share\\finance\\app', path.win32),
  ).toBe(true);
});

it('真实路径解析 books/backups junction 和数据根链接，尚未创建的安全子目录仍可使用', () => {
  const root = temp();
  const install = path.join(root, 'install');
  mkdirSync(install);
  const alias = path.join(root, 'install-alias');
  symlinkSync(install, alias, 'junction');
  expect(canonicalPath(alias)).toBe(canonicalPath(install));
  expect(() => assertDataOutsideInstall(alias, install)).toThrow(/相交/);
  for (const name of ['books', 'backups', 'backup']) {
    const data = path.join(root, `data-${name}`);
    mkdirSync(data);
    symlinkSync(install, path.join(data, name), 'junction');
    expect(() => assertDataOutsideInstall(data, install)).toThrow(/相交/);
  }
  const normal = path.join(root, 'new-data', 'new-subfolder');
  expect(() => assertDataOutsideInstall(normal, alias)).not.toThrow();
});
