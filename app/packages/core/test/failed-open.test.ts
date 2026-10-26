import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RawDatabase } from '@caiwu/db';
import { createTestBook } from '@caiwu/testkit';

describe('异常账套的真实句柄释放', () => {
  it.each(['list', 'open', 'migration'] as const)(
    '%s 失败/跳过后不遗留损坏库或结构异常库句柄',
    async (action) => {
      const t = await createTestBook({ seed: false });
      const id = randomUUID(),
        file = t.store.pathOf(id);
      if (action === 'migration') {
        const raw = new Database(file);
        try {
          raw.exec('CREATE TABLE _migration (wrong_schema TEXT)');
        } finally {
          raw.close();
        }
      } else writeFileSync(file, 'damaged');
      const pragma = vi.spyOn(Database.prototype, 'pragma');
      const prepare = vi.spyOn(Database.prototype, 'prepare');
      const handles = () =>
        new Set(
          ([...pragma.mock.contexts, ...prepare.mock.contexts] as RawDatabase[]).filter(
            (raw) => raw.name === file,
          ),
        );
      try {
        if (action === 'list')
          expect((await t.store.list()).map((book) => book.id)).toEqual([t.info.id]);
        else expect(() => t.store.open(id)).toThrow();
        // runMigrations 抛错的异步关闭也必须在 closeAll 返回前完成。
        await t.store.closeAll();
        expect(handles().size).toBeGreaterThan(0);
        for (const raw of handles()) expect(raw.open).toBe(false);
        if (action !== 'migration') expect(readFileSync(file, 'utf8')).toBe('damaged');
        renameSync(file, `${file}.retained`);
      } finally {
        for (const raw of handles()) if (raw.open) raw.close();
        pragma.mockRestore();
        prepare.mockRestore();
        await t.close();
      }
    },
  );
});
