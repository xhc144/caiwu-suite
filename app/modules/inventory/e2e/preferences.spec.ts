import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
test('w_cb_tzxx/w_ck_rk1：默认税率只带入新单，精度不损失原输入，首末定位边界正确', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '精度仓' },
    { token },
  );
  await callApi(request, 'm.inventory.saveProduct', { code: 'PREC', name: '精度产品' }, { token });
  await page.goto('/m/inventory/settings');
  await page.getByLabel('默认普票税率（%）', { exact: true }).fill('3');
  await page.getByLabel('默认专票税率（%）', { exact: true }).fill('13');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.goto('/m/inventory/receipts');
  await page.getByRole('button', { name: '新增入库单', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增入库单', exact: true });
  await drawer.getByLabel('单号', { exact: true }).fill('PREC-A');
  await drawer.getByLabel('发票种类', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .getByText('增值税专用发票', { exact: true })
    .click();
  await expect(drawer.getByLabel('税率（%）', { exact: true })).toHaveValue('13');
  await drawer.getByLabel('付款科目', { exact: true }).fill('1001');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('第1行产品', { exact: true }).fill('PREC');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('第1行数量', { exact: true }).fill('1.234567');
  await drawer.getByLabel('第1行单价', { exact: true }).fill('3.123456');
  await drawer.getByRole('button', { name: '保存单据', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveDocument',
    {
      requestKey: crypto.randomUUID(),
      kind: 'receipt',
      warehouseId,
      number: 'PREC-B',
      date: '2026-01-11',
      category: '采购',
      accountId: accounts.find((a) => a.code === '1001')!.id,
      lines: [{ productCode: 'PREC', quantity: '1', unitPrice: '1' }],
    },
    { token },
  );
  await page.reload();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'PREC-A', exact: true }) });
  await row.getByRole('button', { name: '查看/编辑', exact: true }).click();
  const a = page.getByRole('dialog', { name: '单据 PREC-A', exact: true });
  await expect(a.getByLabel('第1行数量', { exact: true })).toHaveValue('1.234567');
  await a.getByRole('button', { name: '第一张', exact: true }).click();
  const b = page.getByRole('dialog', { name: '单据 PREC-B', exact: true });
  await expect(b).toBeVisible();
  await expect(b.getByRole('button', { name: '第一张' })).toBeDisabled();
  await b.getByRole('button', { name: '最后一张' }).click();
  await expect(a).toBeVisible();
  await expect(a.getByRole('button', { name: '下一张' })).toBeDisabled();
});
