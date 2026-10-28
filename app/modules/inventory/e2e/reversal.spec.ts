import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

test('w_ck_rk/w_ck_ck：反冲预览取消不改库存，确认后恢复数量并保留原单', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '反冲演示仓' },
    { token },
  );
  await callApi(request, 'm.inventory.saveProduct', { code: 'P1', name: '反冲产品' }, { token });
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    {},
    { token, method: 'GET' },
  );
  const cash = accounts.find((a) => a.code === '1001')!.id;
  await callApi(
    request,
    'm.inventory.saveDocument',
    {
      kind: 'receipt',
      number: 'R-ORIGINAL',
      warehouseId,
      date: '2026-01-10',
      requestKey: crypto.randomUUID(),
      category: '采购',
      accountId: cash,
      taxRate: '13',
      lines: [{ productCode: 'P1', quantity: '3', unitPrice: '3.33', priceIncludesTax: true }],
    },
    { token },
  );
  await page.goto('/m/inventory/receipts');
  const source = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'R-ORIGINAL', exact: true }) });
  await source.getByRole('button', { name: '反冲', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '单据反冲', exact: true });
  await expect(dialog).toContainText('以相反方向新增其他出库');
  await dialog.getByLabel('反冲单号', { exact: true }).fill('FC-RECEIPT');
  await dialog.getByRole('button', { name: '预览并确认反冲' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认整张反冲' });
  await expect(confirmation.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog.getByLabel('反冲单号', { exact: true })).toHaveValue('FC-RECEIPT');
  let rows = await callApi<{ balance: string }[]>(
    request,
    'm.inventory.stock',
    { warehouseId },
    { token, method: 'GET' },
  );
  expect(rows[0]!.balance).toBe('3');
  await dialog.getByRole('button', { name: '预览并确认反冲' }).click();
  await page
    .getByRole('dialog', { name: '确认整张反冲' })
    .getByRole('button', { name: '确认反冲', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  rows = await callApi(request, 'm.inventory.stock', { warehouseId }, { token, method: 'GET' });
  expect(rows[0]!.balance).toBe('0');
  await expect(source).toBeVisible();
  await page
    .getByRole('navigation', { name: '进销存页面入口' })
    .getByRole('link', { name: '出库单', exact: true })
    .click();
  await expect(page.getByRole('row').filter({ hasText: 'FC-RECEIPT' })).toBeVisible();
});

test('w_ck_ck：出库反冲先明确退回入库计价，保存失败保留输入', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '退回仓' },
    { token },
  );
  await callApi(request, 'm.inventory.saveProduct', { code: 'P1', name: '退回产品' }, { token });
  await callApi(
    request,
    'm.inventory.saveOpening',
    { warehouseId, revision: 0, rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2' }] },
    { token },
  );
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    {},
    { token, method: 'GET' },
  );
  const cash = accounts.find((a) => a.code === '1001')!.id,
    cost = accounts.find((a) => a.code === '6401')!.id;
  await callApi(
    request,
    'm.inventory.saveDocument',
    {
      kind: 'issue',
      number: 'S-ORIGINAL',
      warehouseId,
      date: '2026-01-10',
      requestKey: crypto.randomUUID(),
      category: '销售',
      accountId: cash,
      costAccountId: cost,
      taxRate: '0',
      lines: [{ productCode: 'P1', quantity: '3', unitPrice: '5' }],
    },
    { token },
  );
  await page.goto('/m/inventory/issues');
  await page
    .getByRole('row')
    .filter({ hasText: 'S-ORIGINAL' })
    .getByRole('button', { name: '反冲', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '单据反冲', exact: true });
  await dialog.getByLabel('反冲单号', { exact: true }).fill('FC-ISSUE');
  await expect(dialog.getByLabel('反冲第1行单价')).toHaveValue('');
  await dialog.getByRole('button', { name: '预览并确认反冲' }).click();
  await expect(page.getByText(/请输入非负十进制数/)).toBeVisible();
  await expect(dialog.getByLabel('反冲单号', { exact: true })).toHaveValue('FC-ISSUE');
  await dialog.getByLabel('反冲第1行单价').fill('2');
  await dialog.getByRole('button', { name: '预览并确认反冲' }).click();
  await page
    .getByRole('dialog', { name: '确认整张反冲' })
    .getByRole('button', { name: '确认反冲', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const rows = await callApi<{ balance: string }[]>(
    request,
    'm.inventory.stock',
    { warehouseId },
    { token, method: 'GET' },
  );
  expect(rows[0]!.balance).toBe('10');
});
