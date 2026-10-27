import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

test('W2-01 真实库存前置：试算→保存→取消；收入和凭证预览不假生成', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token, method: 'GET' },
  );
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.inventory.${name}`, input, { token, method: 'POST' });
  const warehouseId = await post<number>('saveWarehouse', { code: '01', name: '试算仓库' });
  await post('saveProduct', {
    code: 'P1',
    name: '试算产品',
    inventoryAccountId: id('1405'),
    salesAccountId: id('6001'),
  });
  await post('saveOpening', {
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const document = (kind: 'receipt' | 'issue', q: string, price: string) =>
    post<{ id: number }>('saveDocument', {
      requestKey: `e2e-${kind}-costing`,
      kind,
      warehouseId,
      number: kind === 'receipt' ? 'RK01' : 'CK01',
      date: '2026-01-10',
      category: kind === 'receipt' ? '采购' : '销售',
      accountId: id('1001'),
      costAccountId: id('6401'),
      lines: [{ productCode: 'P1', quantity: q, unitPrice: price }],
    });
  const receipt = await document('receipt', '10', '3');
  await document('issue', '5', '10');
  await page.goto('/m/costing/calculation');
  await expect(page.getByRole('heading', { name: '成本试算', exact: true })).toBeVisible();
  await expect(page.getByText('当前提供成本试算，正式核算尚未开放')).toBeVisible();
  await page.getByRole('button', { name: '重新试算', exact: true }).click();
  const cost = page.getByRole('row').filter({ hasText: '试算产品' });
  await expect(cost).toContainText('10.00');
  await expect(cost).toContainText('30.00');
  await page.getByRole('button', { name: '保存试算', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '未正式核算' })).toHaveCount(1);
  await page.getByRole('button', { name: '取消试算', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '已取消' })).toHaveCount(1);
  await page.getByRole('button', { name: '查看试算', exact: true }).click();
  await expect(page.getByText(/试算 #1 · 已取消/)).toBeVisible();

  await page.goto('/m/costing/profit');
  await expect(page.getByRole('heading', { name: '收入成本利润表', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查询销售明细', exact: true }).click();
  const sale = page.getByRole('row').filter({ hasText: 'CK01' });
  await expect(sale).toContainText('50.00');
  await expect(sale).toContainText('待成本核算');

  await page.goto(`/m/costing/vouchers?id=${receipt.id}`);
  await expect(page.getByRole('heading', { name: '出入库凭证预览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(page.getByText('预览借方 30.00；贷方 30.00')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '1405 库存商品' })).toContainText('30.00');
  await expect(page.getByRole('button', { name: '生成凭证', exact: true })).toHaveCount(0);
  const vouchers = await callApi<{ total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token, method: 'GET' },
  );
  expect(vouchers.total).toBe(0);
});
