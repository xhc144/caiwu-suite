import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { ExchangeFile } from '../exchange';

test('w_ck_rk 多单文件：选择两单下载完整头行 → 预览 → 版本变化失败保留文件 → 重新预览整批保存', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '文件仓' },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveProduct',
    { code: 'FILE-P1', name: '文件转入产品' },
    { token },
  );
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token },
  );
  const accountId = accounts.find((a) => a.code === '1001')!.id;
  const created: { id: number; revision: number }[] = [];
  for (const number of ['FILE-A', 'FILE-B']) {
    created.push(
      await callApi(
        request,
        'm.inventory.saveDocument',
        {
          requestKey: crypto.randomUUID(),
          kind: 'receipt',
          warehouseId,
          number,
          date: '2026-01-10',
          category: '采购',
          accountId,
          taxRate: '13',
          operator: '文件会计',
          summary: '完整头行保存',
          lines: [
            {
              productCode: 'FILE-P1',
              quantity: '1',
              unitPrice: '113',
              priceIncludesTax: true,
              note: '文件含税明细',
            },
          ],
        },
        { token },
      ),
    );
  }
  await page.goto('/m/inventory/receipts');
  for (const number of ['FILE-A', 'FILE-B']) {
    await page.getByLabel('多单转出选择', { exact: true }).fill(number);
    await page.keyboard.press('Enter');
  }
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '多单文件转出', exact: true }).click();
  const downloaded = await downloadEvent;
  expect(downloaded.suggestedFilename()).toMatch(/^出入库单-.*\.json$/);
  const bytes = await readFile((await downloaded.path())!);
  const file = JSON.parse(bytes.toString()) as ExchangeFile;
  expect(file.documents.map((d) => d.number)).toEqual(['FILE-A', 'FILE-B']);
  expect(file.documents[0]).toMatchObject({
    warehouseCode: '01',
    accountCode: '1001',
    operator: '文件会计',
    summary: '完整头行保存',
  });
  expect(file.documents[0]!.lines[0]).toMatchObject({
    quantity: '1',
    unitPrice: '113',
    priceIncludesTax: true,
    netCents: 10000,
    taxCents: 1300,
    grossCents: 11300,
  });
  expect(bytes.toString()).not.toMatch(/"(?:id|warehouseId|productId|accountId)"/);
  for (const d of created)
    await callApi(request, 'm.inventory.removeDocument', { ...d, confirmed: true }, { token });
  await page.reload();
  await page.getByRole('button', { name: '多单文件转入', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '多单文件转入：核对头行后整批保存' });
  await modal
    .getByLabel('多单转入文件', { exact: true })
    .setInputFiles({ name: '完整两单.json', mimeType: 'application/json', buffer: bytes });
  await modal.getByRole('button', { name: '预览全部单据', exact: true }).click();
  await expect(modal.getByText(/预览 2 张单据，0 个错误/)).toBeVisible();
  await expect(modal.getByRole('cell', { name: 'FILE-A', exact: true })).toBeVisible();
  await expect(modal.getByRole('cell', { name: 'FILE-B', exact: true })).toBeVisible();
  expect(
    await callApi<unknown[]>(request, 'm.inventory.documents', {}, { token, method: 'GET' }),
  ).toEqual([]);
  await callApi(
    request,
    'm.inventory.saveProduct',
    { code: 'FILE-P2', name: '预览后变更档案' },
    { token },
  );
  page.once('dialog', (dialog) => dialog.accept());
  await modal.getByRole('button', { name: '确认整批转入', exact: true }).click();
  await expect(page.getByText(/转入预览已过期或库存、期间、档案已变化/)).toBeVisible();
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/待转入文件：完整两单.json/)).toBeVisible();
  expect(
    await callApi<unknown[]>(request, 'm.inventory.documents', {}, { token, method: 'GET' }),
  ).toEqual([]);
  await modal.getByRole('button', { name: '预览全部单据', exact: true }).click();
  await expect(modal.getByText(/预览 2 张单据，0 个错误/)).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await modal.getByRole('button', { name: '确认整批转入', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(
    await callApi<unknown[]>(request, 'm.inventory.documents', {}, { token, method: 'GET' }),
  ).toHaveLength(2);
  const stock = await callApi<{ balance: string }[]>(
    request,
    'm.inventory.stock',
    { warehouseId },
    { token, method: 'GET' },
  );
  expect(stock[0]?.balance).toBe('2');
});

test('w_ck_rk/w_ck_ck 关联文件：跨仓跨方向补选两端 → 调拨和反冲完整下载 → 同一批次恢复关联和库存', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '关联出仓' },
    { token },
  );
  const targetWarehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '02', name: '关联入仓' },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveProduct',
    { code: 'PAIR-P1', name: '成对文件产品' },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveOpening',
    {
      warehouseId,
      revision: 0,
      rows: [{ productCode: 'PAIR-P1', quantity: '10', unitPrice: '2.55' }],
    },
    { token },
  );
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token },
  );
  const cash = accounts.find((a) => a.code === '1001')!.id,
    cost = accounts.find((a) => a.code === '6401')!.id;
  const transfer = await callApi<{
    id: number;
    revision: number;
    issue: { id: number; revision: number };
    receipt: { id: number; revision: number };
  }>(
    request,
    'm.inventory.saveTransfer',
    {
      requestKey: crypto.randomUUID(),
      number: 'FILE-DB1',
      sourceWarehouseId: warehouseId,
      targetWarehouseId,
      date: '2026-01-10',
      clearingAccountId: cash,
      lines: [{ productCode: 'PAIR-P1', quantity: '3', unitPrice: '2.55' }],
    },
    { token },
  );
  const original = await callApi<{ id: number; revision: number }>(
    request,
    'm.inventory.saveDocument',
    {
      requestKey: crypto.randomUUID(),
      kind: 'receipt',
      warehouseId,
      number: 'FILE-OR1',
      date: '2026-01-10',
      category: '采购',
      accountId: cash,
      lines: [{ productCode: 'PAIR-P1', quantity: '2', unitPrice: '2.55' }],
    },
    { token },
  );
  const reversal = await callApi<{ id: number; revision: number }>(
    request,
    'm.inventory.reverseDocument',
    {
      id: original.id,
      revision: original.revision,
      requestKey: crypto.randomUUID(),
      number: 'FILE-FC1',
      date: '2026-01-11',
      accountId: cost,
      confirmed: true,
    },
    { token },
  );
  await page.goto('/m/inventory/receipts');
  await page.getByLabel('多单转出选择', { exact: true }).fill('调出-FILE-DB1');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '多单文件转出', exact: true }).click();
  await expect(page.getByText(/转出集合缺少关联入库单 调入-FILE-DB1/)).toBeVisible();
  for (const number of ['调入-FILE-DB1', 'FILE-OR1', 'FILE-FC1']) {
    await page.getByLabel('多单转出选择', { exact: true }).fill(number);
    await page.keyboard.press('Enter');
  }
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '多单文件转出', exact: true }).click();
  const bytes = await readFile((await (await downloadEvent).path())!);
  const file = JSON.parse(bytes.toString()) as ExchangeFile;
  expect(file.version).toBe(2);
  if (file.version !== 2) throw new Error('关联文件版本错误');
  expect(file.relations.transfers).toHaveLength(1);
  expect(file.relations.reversals).toHaveLength(1);
  await callApi(
    request,
    'm.inventory.removeTransfer',
    {
      id: transfer.id,
      revision: transfer.revision,
      issueRevision: transfer.issue.revision,
      receiptRevision: transfer.receipt.revision,
      confirmed: true,
    },
    { token },
  );
  await callApi(
    request,
    'm.inventory.removeDocument',
    { id: reversal.id, revision: reversal.revision, confirmed: true },
    { token },
  );
  const currentOriginal = await callApi<{ revision: number }>(
    request,
    'm.inventory.document',
    { id: original.id },
    { token, method: 'GET' },
  );
  await callApi(
    request,
    'm.inventory.removeDocument',
    { id: original.id, revision: currentOriginal.revision, confirmed: true },
    { token },
  );
  await page.reload();
  await page.getByRole('button', { name: '多单文件转入', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '多单文件转入：核对头行后整批保存' });
  await modal
    .getByLabel('多单转入文件')
    .setInputFiles({ name: '调拨反冲关联.json', mimeType: 'application/json', buffer: bytes });
  await modal.getByRole('button', { name: '预览全部单据', exact: true }).click();
  await expect(modal.getByText(/预览 4 张单据，0 个错误/)).toBeVisible();
  await expect(modal.getByText(/关联：1 张调拨、1 组反冲/)).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '确认整批转入', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const restored = await callApi<{ number: string }[]>(
    request,
    'm.inventory.transfers',
    {},
    { token, method: 'GET' },
  );
  expect(restored).toEqual([expect.objectContaining({ number: 'FILE-DB1' })]);
  const stock = await callApi<{ warehouseId: number; balance: string }[]>(
    request,
    'm.inventory.stock',
    {},
    { token, method: 'GET' },
  );
  expect(stock.find((r) => r.warehouseId === warehouseId)?.balance).toBe('7');
  expect(stock.find((r) => r.warehouseId === targetWarehouseId)?.balance).toBe('3');
});
