import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const sourceWarehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '调出仓' },
    { token },
  );
  const targetWarehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '02', name: '调入仓' },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveProduct',
    { code: 'TR1', name: '调拨产品', unit: '件' },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveOpening',
    {
      warehouseId: sourceWarehouseId,
      revision: 0,
      rows: [{ productCode: 'TR1', quantity: '10', unitPrice: '2.55' }],
    },
    { token },
  );
  await page.goto('/m/inventory/transfers');
  await expect(page.getByRole('heading', { name: '仓库调拨', exact: true })).toBeVisible();
  return { token, sourceWarehouseId, targetWarehouseId };
}
async function fill(page: Page, number: string, quantity = '3') {
  await page.getByRole('button', { name: '新增调拨单', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增调拨单', exact: true });
  await drawer.getByLabel('调拨单号', { exact: true }).fill(number);
  await drawer.getByLabel('调拨对方科目', { exact: true }).fill('1001');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('第1行产品', { exact: true }).fill('TR1');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('第1行数量', { exact: true }).fill(quantity);
  await drawer.getByLabel('第1行单价', { exact: true }).fill('2.55');
  return drawer;
}
test('w_cb_ck_copy 调拨：保存成对出入库 → 库存守恒 → 成对审核与取消 → 成对删除恢复', async ({
  page,
  request,
}) => {
  const { token, sourceWarehouseId, targetWarehouseId } = await setup(page, request);
  const drawer = await fill(page, 'UI-DB1');
  await drawer.getByRole('button', { name: '检查调拨及库存' }).click();
  await expect(drawer.getByText(/单据金额 7.65 元/)).toBeVisible();
  await drawer.getByRole('button', { name: '保存调拨单', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'UI-DB1', exact: true }) });
  await expect(row).toContainText('调出仓');
  await expect(row).toContainText('调入仓');
  await expect(row).toContainText('调出-UI-DB1');
  await expect(row).toContainText('调入-UI-DB1');
  const balances = await Promise.all(
    [sourceWarehouseId, targetWarehouseId].map((warehouseId) =>
      callApi<{ balance: string }[]>(
        request,
        'm.inventory.stock',
        { warehouseId, productCode: 'TR1' },
        { token, method: 'GET' },
      ),
    ),
  );
  expect(balances.map((r) => r[0]!.balance)).toEqual(['7', '3']);
  await row.getByRole('button', { name: '审核调拨', exact: true }).click();
  await expect(row).toContainText('已审核');
  await row.getByRole('button', { name: '取消审核调拨', exact: true }).click();
  await expect(row).toContainText('未审核');
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: '删除调拨', exact: true }).click();
  await expect(row).not.toBeVisible();
  const documents = await callApi<unknown[]>(
    request,
    'm.inventory.documents',
    {},
    { token, method: 'GET' },
  );
  expect(documents).toHaveLength(0);
});

test('调拨库存不足默认取消后保留表单，明确确认后两端一起保存', async ({ page, request }) => {
  const { token } = await setup(page, request);
  const drawer = await fill(page, 'UI-NEG', '11');
  await drawer.getByRole('button', { name: '保存调拨单', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: '调出库存不足，默认取消', exact: true });
  await expect(confirmation.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(drawer.getByLabel('第1行数量', { exact: true })).toHaveValue('11');
  expect(
    await callApi<unknown[]>(request, 'm.inventory.documents', {}, { token, method: 'GET' }),
  ).toHaveLength(0);
  await drawer.getByRole('button', { name: '保存调拨单', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: '调出库存不足，默认取消', exact: true });
  await confirmation.getByRole('button', { name: '确认允许负库存', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect(
    await callApi<unknown[]>(request, 'm.inventory.documents', {}, { token, method: 'GET' }),
  ).toHaveLength(2);
});
