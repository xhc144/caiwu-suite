import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook, documents, recordThree } from './scenarios';

test('w_cn_xtcsh 真实保护备份包含清空前全部出纳单据，强确认后重新建立期初', async ({ cashier }) => {
  const book = await bankBook(cashier);
  await recordThree(cashier, book);
  const { page, request } = cashier;
  await page.goto('/m/cashier/accounts');
  await page.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '重新初始化出纳', exact: true });
  await expect(drawer.getByText('将删除当前账套的全部出纳数据')).toBeVisible();
  await expect(drawer.getByText('3 张', { exact: true })).toBeVisible();
  await drawer.getByLabel('确认初始化账套名称').fill(book.bookName);
  await drawer.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: '确认备份后清空全部出纳数据' });
  await expect(confirmation.getByRole('button', { name: '创建保护备份并清空' })).toBeDisabled();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  expect(await documents(cashier, book)).toHaveLength(3);
  await drawer.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: '确认备份后清空全部出纳数据' });
  await confirmation.getByLabel('确认文字').fill('清空出纳数据');
  const response = page.waitForResponse(
    (r) => r.url().includes('m.cashier.reset') && r.request().method() === 'POST',
  );
  await confirmation.getByRole('button', { name: '创建保护备份并清空' }).click();
  type ResetResponse = {
    result?: { data: { backupId: string; period: number } };
  };
  const savedResponse = await response;
  expect(savedResponse.ok()).toBe(true);
  const payload = (await savedResponse.json()) as ResetResponse | ResetResponse[];
  const result = Array.isArray(payload) ? payload[0]! : payload;
  await expect(drawer.getByText('出纳已重新初始化，请重新建立账户并录入期初')).toBeVisible();
  expect(result.result?.data.period).toBe(202601);
  const backupId = result.result!.data.backupId;
  const backup = await callApi<{ name: string; base64: string }>(
    request,
    'm.backup.download',
    { id: backupId },
    { token: book.token },
  );
  const bytes = Buffer.from(backup.base64, 'base64');
  expect(bytes.subarray(0, 8).toString()).toBe('CAIWUBK1');
  const headerLength = bytes.readUInt32BE(8);
  const metadata = JSON.parse(bytes.subarray(12, 12 + headerLength).toString()) as {
    sha256: string;
    book: { id: string };
  };
  const snapshot = bytes.subarray(12 + headerLength);
  expect(metadata.book.id).toBe(book.bookId);
  expect(createHash('sha256').update(snapshot).digest('hex')).toBe(metadata.sha256);
  const restoreDir = await mkdtemp(path.join(tmpdir(), 'cashier-reset-backup-'));
  try {
    const filename = path.join(restoreDir, 'snapshot.caiwu');
    await writeFile(filename, snapshot, { flag: 'wx', mode: 0o600 });
    // WAL 格式的快照应从独立文件回读，不能当作只读内存数据库打开。
    const restored = new Database(filename, { readonly: true });
    try {
      expect(restored.prepare('SELECT count(*) AS n FROM cashier_document').get()).toEqual({
        n: 3,
      });
      expect(restored.prepare('SELECT count(*) AS n FROM cashier_account').get()).toEqual({ n: 1 });
      expect(restored.prepare('SELECT balance FROM cashier_opening').get()).toEqual({
        balance: 100000,
      });
      expect(restored.pragma('foreign_key_check')).toEqual([]);
    } finally {
      restored.close();
    }
  } finally {
    await rm(restoreDir, { recursive: true, force: true });
  }
  expect(await documents(cashier, book)).toEqual([]);
  await drawer.getByRole('button', { name: '返回账户与期初' }).click();
  await expect(page.getByRole('row', { name: /闭环银行/ })).not.toBeVisible();
  await page.getByRole('button', { name: '新增账户', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新增出纳账户' })).toBeVisible();
  await cashier.withServices(book.bookId, async (svc) => {
    const bank = (await svc.accounts.require('100201')).id;
    expect(await svc.opening.list(2026)).toContainEqual(
      expect.objectContaining({ accountId: bank, balance: 100000 }),
    );
  });
});
