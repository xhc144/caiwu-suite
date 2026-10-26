import { expect, test } from '@playwright/test';
import type { InventorySnapshot } from '@caiwu/core';
import { callApi } from '@caiwu/testkit/e2e';
import { seed, preview, confirmPublish, cancelLatest } from './fixtures';

test('w_cb_hz / w_cb_fgz 页面闭环：黄金成本1000分、余15/3000→确认发布→刷新真实结果→撤销解锁', async ({
  page,
  request,
}) => {
  const t = await seed(page, request);
  await preview(page);
  const row = page.getByRole('row').filter({ hasText: '黄金产品' });
  await expect(row.getByRole('cell').nth(6)).toHaveText('15');
  await expect(row.getByRole('cell').nth(9)).toHaveText('10.00');
  await expect(row.getByRole('cell').nth(12)).toHaveText('30.00');
  await page.getByRole('button', { name: '发布正式核算', exact: true }).click();
  expect(await t.batches()).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: '返回核对', exact: true }).click();
  expect(await t.batches()).toEqual([]);
  await confirmPublish(page);
  await expect(page.getByText('202601 正式成本核算已发布，本月库存已锁定；凭证尚未生成。')).toBeVisible();
  const official = await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 });
  const batches = await t.batches();
  expect(batches).toHaveLength(1);
  expect(official.control.costBatch).toBe(batches[0]!.inventory_batch_id);
  expect(official.movements.find((m) => m.documentId === t.issue.id)!.outboundCostCents).toBe(1000);
  expect(
    (
      await t.get<{ balance: string; balanceCents: number; issueCostCents: number }[]>('stock', {
        warehouseId: t.warehouseId,
      })
    )[0],
  ).toMatchObject({ balance: '15', balanceCents: 3000, issueCostCents: 1000 });
  await expect(t.document('receipt', '1', '1')).rejects.toThrow(/核算|锁定/);
  await page.goto('/m/costing/profit');
  await page.getByRole('button', { name: '查询销售明细', exact: true }).click();
  await expect(page.getByText('不含税收入 50.00；销售成本 10.00；销售毛利 40.00')).toBeVisible();
  await page.goto('/m/costing/calculation');
  await expect(page.getByRole('row').filter({ hasText: '已正式核算' })).toHaveCount(1);
  await page.getByRole('button', { name: '查看核算结果', exact: true }).click();
  await expect(page.getByText(/正式批次 #1 · 202601 · 已正式核算/)).toBeVisible();
  await cancelLatest(page);
  await expect(page.getByText('202601 正式成本核算已撤销，库存已恢复核算前态。')).toBeVisible();
  expect((await t.batches())[0]).toMatchObject({ status: 'cancelled', revision: 2 });
  expect(
    (await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 })).control.costBatch,
  ).toBeNull();
  await t.document('receipt', '1', '1');
  const vouchers = await callApi<{ total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token: t.token, method: 'GET' },
  );
  expect(vouchers.total).toBe(0);
});

test('w_cb_pdk 页面正式发布：盘点14余2800分，撤销恢复盘点金额快照', async ({ page, request }) => {
  const t = await seed(page, request);
  const count = await t.post<{ revision: number }>('generateCount', {
    warehouseId: t.warehouseId,
    period: 202601,
    revision: 0,
    confirmed: false,
  });
  await t.post('saveCount', {
    warehouseId: t.warehouseId,
    period: 202601,
    revision: count.revision,
    rows: [{ productCode: 'P1', actual: '14' }],
  });
  const before = await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 });
  await preview(page);
  const row = page.getByRole('row').filter({ hasText: '黄金产品' });
  await expect(row.getByRole('cell').nth(6)).toHaveText('14');
  await expect(row.getByRole('cell').nth(10)).toHaveText('-2.00');
  await expect(row.getByRole('cell').nth(12)).toHaveText('28.00');
  await confirmPublish(page);
  await expect(page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  expect(
    (
      await t.get<{ balance: string; balanceCents: number }[]>('stock', {
        warehouseId: t.warehouseId,
      })
    )[0],
  ).toMatchObject({ balance: '14', balanceCents: 2800 });
  expect(
    (
      await t.get<{ rows: { bookCents: number; actualCents: number }[] }>('count', {
        warehouseId: t.warehouseId,
        period: 202601,
      })
    ).rows[0],
  ).toMatchObject({ bookCents: 3000, actualCents: 2800 });
  await cancelLatest(page);
  await expect(page.getByText(/202601 正式成本核算已撤销/)).toBeVisible();
  expect(
    (await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 })).counts[0]!.lines,
  ).toEqual(before.counts[0]!.lines);
});

test('w_cb_hz 页面旧预览拒绝：来源变化后确认不会保存成本批次或库存字段', async ({ page, request }) => {
  const t = await seed(page, request);
  await preview(page);
  await t.document('receipt', '1', '2');
  const before = await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 });
  await confirmPublish(page);
  await expect(page.getByRole('dialog').getByText('来源数据或操作员已变化，不能发布旧试算')).toBeVisible();
  expect(await t.batches()).toEqual([]);
  expect(await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 })).toEqual(before);
  await page.getByRole('dialog').getByRole('button', { name: '返回核对', exact: true }).click();
  await page.getByRole('button', { name: '重新试算', exact: true }).click();
  await expect(
    page.getByRole('row').filter({ hasText: '黄金产品' }).getByRole('cell').nth(6),
  ).toHaveText('16');
  await confirmPublish(page);
  await expect(page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  expect(await t.batches()).toHaveLength(1);
});

test('w_cb_hz / w_cb_fgz 页面连续月份：2月未就绪拒绝→1月发布→承接正式结存→仅末月撤销', async ({
  page,
  request,
}) => {
  const t = await seed(page, request);
  await page.goto('/m/costing/calculation');
  await page.getByRole('spinbutton', { name: '核算年月', exact: true }).fill('202602');
  await page.getByRole('button', { name: '重新试算', exact: true }).click();
  await expect(page.getByText('本月正式期初尚未就绪')).toBeVisible();
  expect(await t.batches()).toEqual([]);
  await preview(page);
  await confirmPublish(page);
  await expect(page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  await t.document('issue', '2', '20', '2026-02-10');
  await preview(page, 202602);
  await expect(
    page.getByRole('row').filter({ hasText: '黄金产品' }).getByRole('cell').nth(7),
  ).toHaveText('30.00');
  await confirmPublish(page);
  await expect(page.getByText(/202602 正式成本核算已发布/)).toBeVisible();
  expect((await t.batches()).filter((b) => b.status === 'calculated')).toHaveLength(2);
  await expect(page.getByRole('button', { name: '撤销正式核算', exact: true })).toHaveCount(1);
  await cancelLatest(page);
  await expect(page.getByText(/202602 正式成本核算已撤销/)).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: '202601' })
      .getByRole('button', { name: '撤销正式核算', exact: true }),
  ).toBeVisible();
});
