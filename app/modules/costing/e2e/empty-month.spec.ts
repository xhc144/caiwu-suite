import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { InventorySnapshot } from '@caiwu/core';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { CalculationResult } from '../shared';
import { cancelLatest, confirmPublish, preview } from './fixtures';

type Batch = {
  id: number;
  inventoryBatchId: string;
  period: number;
  revision: number;
  status: string;
};

async function emptyBook(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, name, input, { token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, name, input, { token, method: 'POST' });
  const accounts = await get<{ id: number; code: string }[]>('core.accounts.list');
  const account = (code: string) => accounts.find((a) => a.code === code)!.id;
  const warehouseId = await post<number>('m.inventory.saveWarehouse', {
    code: '01',
    name: '首月空仓',
  });
  await post('m.inventory.saveProduct', {
    code: 'P1',
    name: '次月首次入库产品',
    inventoryAccountId: account('1405'),
    salesAccountId: account('6001'),
  });
  // 1月没有期初、单据或盘点，首笔真实库存业务发生在2月。
  await post('m.inventory.saveDocument', {
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId,
    number: 'FEB-FIRST',
    date: '2026-02-10',
    category: '采购',
    accountId: account('1001'),
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '3' }],
  });
  const batches = () =>
    get<Pick<Batch, 'id' | 'period' | 'revision' | 'status'>[]>('m.costing.batches');
  const snapshot = (period = 202601) =>
    get<InventorySnapshot>('m.inventory.costingSnapshot', { period });
  return { get, post, batches, snapshot, warehouseId };
}

test('w_cb_hz：空月发布后次月采购', async ({ page, request }) => {
  const t = await emptyBook(page, request);
  expect((await t.snapshot()).opening).toEqual([]);
  expect((await t.snapshot()).documents).toEqual([]);
  expect((await t.snapshot()).counts).toEqual([]);
  expect((await t.snapshot(202602)).periodOpeningReady).toBe(false);
  await preview(page);
  await expect(page.getByText('本月没有库存数据，可确认按空月正式核算')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存试算', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '发布正式核算', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('本月没有库存数据，将按空月正式核算'),
  ).toBeVisible();
  expect(await t.batches()).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: '返回核对', exact: true }).click();
  expect(await t.batches()).toEqual([]);
  await confirmPublish(page);
  await expect(page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  expect((await t.snapshot()).control).toMatchObject({ costPeriod: 202601 });
  expect((await t.snapshot()).opening).toEqual([]);
  const february = await t.snapshot(202602);
  expect(february.periodOpeningReady).toBe(true);
  expect(february.periodOpening).toEqual([]);
  expect(await t.batches()).toHaveLength(1);
  await preview(page, 202602);
  const product = page.getByRole('row').filter({ hasText: '次月首次入库产品' });
  await expect(product.getByRole('cell').nth(3)).toHaveText('0');
  await expect(product.getByRole('cell').nth(6)).toHaveText('10');
  await expect(product.getByRole('cell').nth(7)).toHaveText('0.00');
  await expect(product.getByRole('cell').nth(12)).toHaveText('30.00');
  await confirmPublish(page);
  await expect(page.getByText(/202602 正式成本核算已发布/)).toBeVisible();
  expect(await t.batches()).toHaveLength(2);
  expect(
    (await t.get<{ balance: string; balanceCents: number }[]>('m.inventory.stock', {
      warehouseId: t.warehouseId,
    }))[0],
  ).toMatchObject({ balance: '10', balanceCents: 3000 });
  await expect(page.getByRole('button', { name: '撤销正式核算', exact: true })).toHaveCount(1);
  await cancelLatest(page);
  await expect(page.getByText(/202602 正式成本核算已撤销/)).toBeVisible();
  await cancelLatest(page);
  await expect(page.getByText(/202601 正式成本核算已撤销/)).toBeVisible();
  expect((await t.snapshot()).control.costBatch).toBeNull();
  expect((await t.snapshot(202602)).periodOpeningReady).toBe(false);
});

test('w_cb_fgz：空月HTTP幂等与撤销保护', async ({ page, request }) => {
  const t = await emptyBook(page, request);
  const preview = await t.get<CalculationResult>('m.costing.preview', { period: 202601 });
  expect(preview.rows).toEqual([]);
  expect(preview.lines).toEqual([]);
  const payload = {
    period: 202601,
    fingerprint: preview.fingerprint,
    requestKey: randomUUID(),
    confirmed: true,
  };
  const before = await t.snapshot();
  await expect(
    t.post('m.costing.commit', { ...payload, confirmed: false }),
  ).rejects.toThrow(/明确确认/);
  expect(await t.batches()).toEqual([]);
  expect(await t.snapshot()).toEqual(before);
  const batch = await t.post<Batch>('m.costing.commit', payload);
  const committed = await t.snapshot();
  expect(await t.post<Batch>('m.costing.commit', payload)).toEqual(batch);
  expect(await t.batches()).toHaveLength(1);
  expect(await t.snapshot()).toEqual(committed);
  const cancel = { id: batch.id, revision: batch.revision, confirmed: true };
  await expect(
    t.post('m.costing.cancelCalculation', { ...cancel, confirmed: false }),
  ).rejects.toThrow(/确认/);
  await expect(
    t.post('m.costing.cancelCalculation', { ...cancel, revision: 999 }),
  ).rejects.toThrow(/版本/);
  expect(await t.snapshot()).toEqual(committed);
  const cancelled = await t.post<Batch>('m.costing.cancelCalculation', cancel);
  expect(await t.post<Batch>('m.costing.cancelCalculation', cancel)).toEqual(cancelled);
  expect((await t.snapshot()).control.costBatch).toBeNull();
  expect((await t.snapshot(202602)).periodOpeningReady).toBe(false);
  await expect(t.post('m.costing.commit', payload)).rejects.toThrow(/请求号/);
  const fresh = await t.get<CalculationResult>('m.costing.preview', { period: 202601 });
  const republished = await t.post<Batch>('m.costing.commit', {
    ...payload,
    fingerprint: fresh.fingerprint,
    requestKey: randomUUID(),
  });
  expect(republished.inventoryBatchId).not.toBe(batch.inventoryBatchId);
  expect((await t.batches()).filter((b) => b.status === 'calculated')).toHaveLength(1);
});
