import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function fixture(page: Page, request: APIRequestContext) {
  const book = await loginWithNewBook(page, request, { product: 'chengben' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, name, input, { token: book.token, method: 'POST' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, name, input, { token: book.token, method: 'GET' });
  const accounts = await get<{ id: number; code: string }[]>('core.accounts.list');
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const types = await get<{ id: number }[]>('core.reference.voucherTypes');
  const voucherTypeId = types[0]!.id;
  const cashflows = await get<{ id: number; code: string }[]>('core.dimensions.items', {
    type: 'cashflow',
  });
  const warehouseId = await post<number>('m.inventory.saveWarehouse', {
    code: '01',
    name: '生产仓库',
  });
  await post('m.inventory.saveProduct', {
    code: 'P1',
    name: '完工测试产品',
    inventoryAccountId: id('1405'),
    salesAccountId: id('6001'),
  });
  const seed = (lines: { accountId: number; debit?: number; credit?: number }[]) =>
    post('m.voucher-entry.save', {
      key: randomUUID(),
      data: {
        voucherTypeId,
        date: '2026-01-10',
        lines: lines.map((line) => ({
          summary: '成本流程测试',
          ...line,
          ...(line.accountId === id('1001')
            ? {
                dimensions: {
                  cashflow: cashflows.find((d) => d.code === (line.credit ? 'CF02' : 'CF01'))!.id,
                },
                cashflowDirection: line.credit ? 'outflow' : 'inflow',
              }
            : {}),
        })),
      },
      acknowledgeCashflowUnknown: true,
    });
  const createAccount = async (code: string, name: string, categoryId: string) => {
    const input = {
      code,
      name,
      categoryId,
      direction: 'debit' as const,
    };
    const plan = await get<{ warnings: { key: string }[] }>('m.masterdata.accounts.preview', input);
    return post<{ id: number }>('m.masterdata.accounts.save', {
      ...input,
      confirmations: plan.warnings.map((w) => w.key),
    });
  };
  return { ...book, post, get, id, seed, createAccount, warehouseId, voucherTypeId };
}

async function choose(page: Page, label: string, value: string) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.fill(value);
  await input.press('Enter');
}

test('w_cb_pz 完工草稿保留非法数量原文，重开后修正、预览、真实保存及取消', async ({
  page,
  request,
}) => {
  const f = await fixture(page, request);
  const material = await f.createAccount('5101', '直接材料', 'cost');
  const labor = await f.createAccount('5102', '直接人工', 'cost');
  const overhead = await f.createAccount('5103', '制造费用', 'cost');
  await f.seed([
    { accountId: material.id, debit: 100 },
    { accountId: labor.id, debit: 200 },
    { accountId: overhead.id, debit: 300 },
    { accountId: f.id('1001'), credit: 600 },
  ]);
  await page.goto('/m/costing/production');
  await choose(page, '入库仓库', '生产仓库');
  await choose(page, '直接材料科目', '5101');
  await choose(page, '直接人工科目', '5102');
  await choose(page, '制造费用科目', '5103');
  await page.getByRole('button', { name: '增加完工产品', exact: true }).click();
  await choose(page, '完工产品1', 'P1');
  await page.getByRole('textbox', { name: '完工数量1', exact: true }).fill('1..2');
  await expect(page.getByRole('button', { name: '预览生产分摊', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存，可关闭后继续', { exact: true })).toBeVisible();
  await page
    .getByRole('tab', { name: '生产成本分摊', exact: true })
    .locator('..')
    .getByRole('button', { name: 'remove', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: '生产成本分摊', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '生产成本分摊', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '完工数量1', exact: true })).toHaveValue('1..2');
  await page.getByRole('textbox', { name: '完工数量1', exact: true }).fill('2..3');
  await page
    .getByRole('tab', { name: '生产成本分摊', exact: true })
    .locator('..')
    .getByRole('button', { name: 'remove', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '有未保存内容', exact: true })
    .getByRole('button', { name: '放弃修改并继续', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '生产成本分摊', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '完工数量1', exact: true })).toHaveValue('1..2');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '完工数量1', exact: true })).toHaveValue('1..2');
  await page.getByRole('textbox', { name: '完工数量1', exact: true }).fill('3');
  await page.getByRole('button', { name: '预览生产分摊', exact: true }).click();
  await expect(page.getByText('完工成本合计 6.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存完工入库及凭证', exact: true }).click();
  await page.getByRole('button', { name: '确认保存完工入库', exact: true }).click();
  await expect(page.getByText('完工入库和分摊凭证已保存', { exact: true })).toBeVisible();
  const saved = await f.get<{
    saved: { id: number; document_id: number; voucher_id: number; result_json: string }[];
  }>('m.costing.productionContext');
  expect(JSON.parse(saved.saved[0]!.result_json)).toMatchObject({
    totalCents: 600,
    rows: [{ quantity: '3', totalCents: 600 }],
  });
  const voucher = await f.get<{
    debitTotal: number;
    creditTotal: number;
    lines: { quantity: string | null }[];
  }>('core.vouchers.get', { id: saved.saved[0]!.voucher_id });
  expect(voucher).toMatchObject({ debitTotal: 600, creditTotal: 600 });
  expect(voucher.lines[0]?.quantity).toBe('3');
  await page
    .getByRole('tab', { name: '生产成本分摊', exact: true })
    .locator('..')
    .getByRole('button', { name: 'remove', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '生产成本分摊', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '完工数量1', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '查看分摊', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('6.00');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '取消完工入库', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('将删除 1 张凭证');
  await page.getByRole('button', { name: '确认取消完工入库', exact: true }).click();
  await expect(page.getByText('完工入库及凭证已取消', { exact: true })).toBeVisible();
  expect(
    (await f.get<{ saved: { status: string }[] }>('m.costing.productionContext')).saved[0]?.status,
  ).toBe('cancelled');
});

test('w_ck_xsmxz 费用附加税保存后可查询销售净利并生成、取消全部损益结转', async ({
  page,
  request,
}) => {
  const f = await fixture(page, request);
  const tax = await f.createAccount('6403', '税金及附加', 'pnl');
  await f.post('m.inventory.saveOpening', {
    warehouseId: f.warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const sale = await f.post<{ id: number }>('m.inventory.saveDocument', {
    requestKey: randomUUID(),
    kind: 'issue',
    warehouseId: f.warehouseId,
    number: '销售01',
    date: '2026-01-15',
    category: '销售',
    accountId: f.id('1001'),
    costAccountId: f.id('6401'),
    lines: [{ productCode: 'P1', quantity: '2', unitPrice: '20' }],
  });
  const preview = await f.get<{ fingerprint: string }>('m.costing.preview', { period: 202601 });
  await f.post('m.costing.commit', {
    period: 202601,
    fingerprint: preview.fingerprint,
    requestKey: randomUUID(),
    confirmed: true,
  });
  for (const purpose of ['revenue', 'cost']) {
    const source = await f.get<{ fingerprint: string; expectedRevision: number }>(
      'm.costing.previewVoucher',
      { documentId: sale.id, purpose },
    );
    await f.post('m.costing.generateVoucher', {
      documentId: sale.id,
      purpose,
      ...source,
      voucherTypeId: f.voucherTypeId,
      confirmed: true,
    });
  }
  await f.seed([
    { accountId: f.id('6601'), debit: 101 },
    { accountId: tax.id, debit: 41 },
    { accountId: f.id('1001'), credit: 142 },
  ]);
  await page.goto('/m/costing/profit');
  await choose(page, '销售费用科目', '6601');
  await choose(page, '销售附加税科目', '6403');
  await choose(page, '本年利润科目', '4103');
  await page.getByRole('button', { name: '保存费用税金设置', exact: true }).click();
  await expect(page.getByText('费用税金归集设置已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查询销售明细', exact: true }).click();
  const report = page.getByRole('row').filter({ hasText: '完工测试产品' });
  await expect(report).toContainText('36.58');
  await expect(report).toContainText('1.01');
  await expect(report).toContainText('0.41');
  await page.getByRole('button', { name: '预览净利润结转', exact: true }).click();
  await expect(page.getByText('本次结转净利润：36.58 元', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '生成净利润结转凭证', exact: true }).click();
  await page.getByRole('button', { name: '确认利润操作', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '查看本月净利润结转凭证', exact: true }),
  ).toBeVisible();
  const result = await f.get<{ totals: { netProfitCents: number } }>('m.costing.profit', {
    from: '2026-01-01',
    to: '2026-01-31',
  });
  expect(result.totals.netProfitCents).toBe(3658);
  await page.getByRole('button', { name: '取消净利润结转', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('将删除 1 张凭证');
  await page.getByRole('button', { name: '确认利润操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '预览净利润结转', exact: true })).toBeVisible();
});
