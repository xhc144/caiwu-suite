import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { InventorySnapshot, Voucher, VoucherHeader } from '@caiwu/core';
import { callApi } from '@caiwu/testkit/e2e';
import type { CalculationResult } from '../shared';
import { confirmCostVoucher, costVoucherPreview, seed } from './fixtures';

async function publish(request: APIRequestContext, token: string) {
  const preview = await callApi<CalculationResult>(
    request,
    'm.costing.preview',
    { period: 202601 },
    { token, method: 'GET' },
  );
  return callApi<{ id: number; revision: number }>(
    request,
    'm.costing.commit',
    {
      period: 202601,
      fingerprint: preview.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    },
    { token, method: 'POST' },
  );
}

test('w_cb_pz：独立合成账套，确认生成真实1000分凭证→来源锁→未审核撤销→重新生成', async ({
  page,
  request,
}) => {
  const t = await seed(page, request);
  await publish(request, t.token);
  const vouchers = () =>
    callApi<{ total: number; items: VoucherHeader[] }>(
      request,
      'core.vouchers.list',
      { sourceModule: 'costing', sourceType: 'cost' },
      { token: t.token, method: 'GET' },
    );
  await costVoucherPreview(page, t.issue.id);
  const costRow = page.getByRole('row').filter({ hasText: '6401 主营业务成本' });
  await expect(costRow).toContainText('10.00');
  const stockRow = page.getByRole('row').filter({ hasText: '1405 库存商品' });
  await expect(stockRow).toContainText('-5');
  expect((await vouchers()).total).toBe(0);
  await page.getByRole('button', { name: '生成成本凭证', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '返回核对', exact: true }).click();
  expect((await vouchers()).total).toBe(0);
  expect(
    (await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 })).voucherSources,
  ).toEqual([]);
  await confirmCostVoucher(page);
  const saved = await vouchers();
  expect(saved.total).toBe(1);
  const v = await callApi<Voucher>(
    request,
    'core.vouchers.get',
    { id: saved.items[0]!.id },
    { token: t.token, method: 'GET' },
  );
  expect(v).toMatchObject({
    status: 'pending',
    date: '2026-01-10',
    debitTotal: 1000,
    creditTotal: 1000,
    number: 1,
    source: { module: 'costing', type: 'cost', id: String(t.issue.id) },
  });
  expect(v.lines).toHaveLength(2);
  expect(v.lines[0]).toMatchObject({ accountCode: '6401', debit: 1000, credit: 0 });
  expect(v.lines[1]).toMatchObject({
    accountCode: '1405',
    debit: 0,
    credit: 1000,
    quantity: '-5',
    unitPrice: '2.000000000000',
  });
  const source = await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 });
  expect(source.voucherSources).toEqual([
    {
      document_id: t.issue.id,
      purpose: 'cost',
      voucher_id: v.id,
      owner_module: 'costing',
      actor_id: 1,
    },
  ]);
  expect(source.movements.find((m) => m.documentId === t.issue.id)!.outboundCostCents).toBe(1000);
  await page.reload();
  await expect(page.getByText(`已有成本凭证 ${v.displayNo} · 待审核`)).toBeVisible();
  await expect(page.getByRole('link', { name: '查看成本凭证', exact: true })).toHaveAttribute(
    'href',
    `/m/voucher-entry/edit?id=${v.id}`,
  );
  await page.getByRole('button', { name: '撤销成本凭证', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保留凭证', exact: true }).click();
  expect((await vouchers()).total).toBe(1);
  await page.getByRole('button', { name: '撤销成本凭证', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认删除并释放关联', exact: true })
    .click();
  await expect(
    page.getByText('未审核成本凭证已撤销，成本用途关联已释放；重新预览后可再次生成'),
  ).toBeVisible();
  expect((await vouchers()).total).toBe(0);
  const released = await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 });
  expect(released.voucherSources).toEqual([]);
  expect(released.control).toEqual(source.control);
  expect(released.movements).toEqual(source.movements);
  await costVoucherPreview(page, t.issue.id);
  await confirmCostVoucher(page);
  expect((await vouchers()).total).toBe(1);
  expect(
    (await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 })).voucherSources,
  ).toHaveLength(1);
});

test('w_cb_pz：确认期间来源改变时旧预览拒绝，刷新后生成且重复HTTP提交不多写', async ({
  page,
  request,
}) => {
  const t = await seed(page, request);
  await publish(request, t.token);
  await costVoucherPreview(page, t.issue.id);
  await page.getByRole('button', { name: '生成成本凭证', exact: true }).click();
  await t.document('receipt', '1', '1', '2026-02-01');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认生成待审核凭证', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByText('来源、科目映射或操作员已变化，不能使用旧预览生成凭证'),
  ).toBeVisible();
  expect(
    (await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 })).voucherSources,
  ).toEqual([]);
  const empty = await callApi<{ total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token: t.token, method: 'GET' },
  );
  expect(empty.total).toBe(0);
  await page.getByRole('dialog').getByRole('button', { name: '返回核对', exact: true }).click();
  await costVoucherPreview(page, t.issue.id);
  await confirmCostVoucher(page);
  const types = await callApi<{ id: number }[]>(request, 'core.reference.voucherTypes', undefined, {
    token: t.token,
    method: 'GET',
  });
  const preview = await callApi<{ fingerprint: string }>(
    request,
    'm.costing.previewVoucher',
    { documentId: t.issue.id, purpose: 'cost' },
    { token: t.token, method: 'GET' },
  );
  await expect(
    callApi(
      request,
      'm.costing.generateVoucher',
      {
        documentId: t.issue.id,
        purpose: 'cost',
        fingerprint: preview.fingerprint,
        voucherTypeId: types[0]!.id,
        confirmed: true,
      },
      { token: t.token, method: 'POST' },
    ),
  ).rejects.toThrow(/重复生成/);
  const saved = await callApi<{ total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token: t.token, method: 'GET' },
  );
  expect(saved.total).toBe(1);
});
