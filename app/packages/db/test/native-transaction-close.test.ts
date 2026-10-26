import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeDatabaseFile, databaseFile, openDatabase } from '../src';

for (const initialized of [false, true]) {
  describe(`未登记的原生事务：driver ${initialized ? '已' : '未'}初始化`, () => {
    for (const finish of ['COMMIT', 'ROLLBACK'] as const) {
      it.each(['close', 'destroy', 'asyncDispose'] as const)(
        `${finish} 前 %s 必须拒绝，显式结束事务后可重试`,
        async (method) => {
          const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-raw-transaction-'));
          const file = path.join(dir, 'probe.caiwu');
          const opened = openDatabase<{ t: { value: string } }>(file);
          const observer = new Database(file, { readonly: true });
          const close = () =>
            method === 'close'
              ? opened.close()
              : method === 'destroy'
                ? opened.db.destroy()
                : opened.db[Symbol.asyncDispose]();
          try {
            opened.raw.exec("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('original')");
            if (initialized) await opened.db.selectFrom('t').selectAll().execute();
            opened.raw.exec("BEGIN; UPDATE t SET value = 'pending'");
            await expect(close()).rejects.toThrow(/未登记的原生事务/);
            expect(opened.raw.open).toBe(true);
            expect(opened.raw.inTransaction).toBe(true);
            expect(observer.prepare('SELECT value FROM t').get()).toEqual({ value: 'original' });
            // 拒绝关闭不能破坏 Kysely 的可用状态或把已知拒绝缓存成永久失败。
            expect(await opened.db.selectFrom('t').selectAll().execute()).toEqual([
              { value: 'pending' },
            ]);
            opened.raw.exec(finish);
            await close();
            expect(opened.raw.open).toBe(false);
            expect(observer.prepare('SELECT value FROM t').get()).toEqual({
              value: finish === 'COMMIT' ? 'pending' : 'original',
            });
          } finally {
            observer.close();
            if (opened.raw.open) {
              if (opened.raw.inTransaction) opened.raw.exec('ROLLBACK');
              // 测试失败时只清理本测试拥有的句柄，断言失败仍照常上报。
              await opened.close().catch(() => opened.raw.close());
            }
            rmSync(dir, { recursive: true });
          }
        },
      );
    }
  });
}

it('文件关闭先检查全部登记连接，不先关闭其它句柄；原生事务提交后整组可重试', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-file-close-'));
  const file = path.join(dir, 'probe.caiwu');
  const first = openDatabase<{ t: { value: string } }>(file);
  first.raw.exec("CREATE TABLE t (value TEXT); INSERT INTO t VALUES ('original')");
  const second = openDatabase<{ t: { value: string } }>(file);
  try {
    await first.db.selectFrom('t').selectAll().execute();
    await second.db.selectFrom('t').selectAll().execute();
    second.raw.exec("BEGIN; UPDATE t SET value = 'committed'");
    await expect(
      databaseFile(file).gate.exclusive(() => closeDatabaseFile(file)),
    ).rejects.toMatchObject({ code: 'UNMANAGED_SQLITE_TRANSACTION' });
    expect(first.raw.open).toBe(true);
    expect(second.raw.open).toBe(true);
    expect(second.raw.inTransaction).toBe(true);
    second.raw.exec('COMMIT');
    await databaseFile(file).gate.exclusive(() => closeDatabaseFile(file));
    expect(first.raw.open).toBe(false);
    expect(second.raw.open).toBe(false);
    const check = new Database(file, { readonly: true });
    try {
      expect(check.prepare('SELECT value FROM t').get()).toEqual({ value: 'committed' });
    } finally {
      check.close();
    }
  } finally {
    if (second.raw.open && second.raw.inTransaction) second.raw.exec('ROLLBACK');
    for (const opened of [first, second]) if (opened.raw.open) await opened.close();
    rmSync(dir, { recursive: true });
  }
});
