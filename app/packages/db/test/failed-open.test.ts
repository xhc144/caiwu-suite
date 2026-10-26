import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase, type RawDatabase } from '../src';

it('损坏文件在真实 PRAGMA 初始化失败后立即释放原生句柄，保留原文件', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-failed-open-'));
  const file = path.join(dir, 'damaged.caiwu');
  writeFileSync(file, 'damaged');
  // spy 仍调用真实原生 PRAGMA，只记录抛错前已创建但未返回的句柄。
  const pragma = vi.spyOn(Database.prototype, 'pragma');
  try {
    expect(() => openDatabase(file)).toThrow();
    expect(pragma.mock.contexts.length).toBeGreaterThan(0);
    for (const raw of new Set(pragma.mock.contexts as RawDatabase[])) {
      expect(raw).toBeInstanceOf(Database);
      expect(raw.open).toBe(false);
    }
    expect(readFileSync(file, 'utf8')).toBe('damaged');
    renameSync(file, `${file}.retained`);
  } finally {
    for (const raw of new Set(pragma.mock.contexts as RawDatabase[])) if (raw.open) raw.close();
    pragma.mockRestore();
    rmSync(dir, { recursive: true });
  }
});
