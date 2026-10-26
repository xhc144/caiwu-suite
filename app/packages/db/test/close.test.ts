import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../src';

// 不以 rm 的重试验证关闭：先直接断言真实原生句柄已经释放，Windows 才能清理文件。
describe.each(['memory', 'file'] as const)('预开的 SQLite 句柄：%s', (storage) => {
  for (const use of ['unused', 'migration', 'query'] as const) {
    it.each(['close', 'destroy', 'asyncDispose'] as const)(
      `${use} 后 %s 真正关闭，且可重复等待`,
      async (method) => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-db-close-'));
        const opened = openDatabase<{ t: { id: number } }>(
          storage === 'memory' ? ':memory:' : path.join(dir, 'book.caiwu'),
        );
        try {
          if (use !== 'unused')
            runMigrations(opened.raw, [
              {
                scope: 'probe',
                migrations: [{ id: '0001_init', sql: 'CREATE TABLE t (id INTEGER)' }],
              },
            ]);
          if (use === 'query') await opened.db.selectFrom('t').selectAll().execute();
          expect(opened.raw.open).toBe(true);
          const closing =
            method === 'close'
              ? opened.close()
              : method === 'destroy'
                ? opened.db.destroy()
                : opened.db[Symbol.asyncDispose]();
          await closing;
          expect(opened.raw.open).toBe(false);
          expect(() => opened.raw.prepare('SELECT 1')).toThrow();
          await opened.close();
          await opened.db.destroy();
        } finally {
          // 只释放本测试自己的句柄；不重试、不放宽目录权限。
          if (opened.raw.open) opened.raw.close();
          rmSync(dir, { recursive: true });
        }
      },
    );
  }
});
