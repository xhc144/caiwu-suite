import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createTestBook, voucherInputFromSpec } from '@caiwu/testkit';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { backupBeforeUpdate, prepareUpdateInstall } from '../update-backup';

it('独立 testkit：事务提交的整数分、权限和来源锁保留在更新前真实 SQLite 备份中，原账套/既有备份不变', async () => {
  const t = await createTestBook();
  try {
    const clerk = await t.addUser('limited', { permissions: ['example.view'] });
    expect(() => clerk.permissions.require('backup.create')).toThrow();
    const input = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6001', credit: 12345 },
      ],
    });
    const generated = await t.forModule('cashier').tx((svc) =>
      svc.vouchers.create({
        ...input,
        source: { type: 'receipt', id: 'synthetic-receipt' },
      }),
    );
    await expect(t.svc.vouchers.delete(generated.id)).rejects.toThrow('不能在这里');
    await expect(
      t.svc.tx(async (svc) => {
        await svc.vouchers.create(input);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await t.svc.vouchers.list()).total).toBe(1);
    // 仍占用时必须拒绝，不能越过共享租约去复制正在写入的账套。
    await expect(backupBeforeUpdate(t.dataDir, '0.2.0')).rejects.toThrow('占用');
    await t.store.closeAll();
    const original = await readFile(t.book.file);
    const backups = path.join(t.dataDir, 'backups');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(backups);
    const prior = path.join(backups, '已有备份.caiwu');
    await writeFile(prior, 'previous-backup');
    await backupBeforeUpdate(t.dataDir, '0.2.0');
    expect(await readFile(t.book.file)).toEqual(original);
    expect(await readFile(prior, 'utf8')).toBe('previous-backup');
    const folder = (await readdir(backups)).find((name) => name.startsWith('更新前-'))!;
    const snapshot = path.join(backups, folder, `${t.info.id}.caiwu`);
    const raw = new Database(snapshot, { readonly: true });
    try {
      expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(
        raw
          .prepare('SELECT debit_total, credit_total, source_module, source_id FROM voucher')
          .all(),
      ).toEqual([
        {
          debit_total: 12345,
          credit_total: 12345,
          source_module: 'cashier',
          source_id: 'synthetic-receipt',
        },
      ]);
      expect(
        raw
          .prepare(
            "SELECT p.permission FROM user_permission p JOIN app_user u ON p.user_id=u.id WHERE u.code='limited'",
          )
          .all(),
      ).toEqual([{ permission: 'example.view' }]);
    } finally {
      raw.close();
    }
    const manifest = JSON.parse(
      await readFile(path.join(backups, folder, '备份清单.json'), 'utf8'),
    ) as {
      beforeVersion: string;
      files: { file: string; sha256: string }[];
    };
    expect(manifest.beforeVersion).toBe('0.2.0');
    expect(manifest.files).toEqual([
      {
        file: `${t.info.id}.caiwu`,
        sha256: createHash('sha256')
          .update(await readFile(snapshot))
          .digest('hex'),
      },
    ]);
  } finally {
    await t.close();
  }
});

it('真实原生未提交事务拒绝关闭，更新备份和安装器均未触发；显式回滚后可正常退出', async () => {
  const t = await createTestBook();
  let backedUp = false;
  let launched = false;
  try {
    t.book.raw.exec("BEGIN; UPDATE book_info SET name='未提交'");
    await expect(
      prepareUpdateInstall({
        stop: async () => {
          await t.store.closeAll();
          return true;
        },
        backup: async () => {
          backedUp = true;
        },
        verify: async () => {},
        launch: async () => {
          launched = true;
        },
      }),
    ).rejects.toThrow('未登记的原生事务');
    expect(backedUp).toBe(false);
    expect(launched).toBe(false);
    expect(t.book.raw.inTransaction).toBe(true);
    t.book.raw.exec('ROLLBACK');
    await t.store.closeAll();
  } finally {
    if (t.book.raw.open && t.book.raw.inTransaction) t.book.raw.exec('ROLLBACK');
    await t.close();
  }
});

it('损坏账套使更新前备份失败，原文件和其它备份全部保留', async () => {
  const t = await createTestBook();
  try {
    await t.store.closeAll();
    await writeFile(t.book.file, 'corrupt synthetic database');
    await expect(backupBeforeUpdate(t.dataDir, '0.2.0')).rejects.toThrow();
    expect(await readFile(t.book.file, 'utf8')).toBe('corrupt synthetic database');
  } finally {
    await t.close();
  }
});
