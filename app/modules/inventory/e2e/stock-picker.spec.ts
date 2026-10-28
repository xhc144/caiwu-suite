import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
test('w_cb_xt_kc_sc/w_ck_ck1：独立库存速查按仓库搜索，选择后只填产品不改数量单价', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '库存速查仓' },
    { token },
  );
  for (const code of ['P1', 'P2'])
    await callApi(request, 'm.inventory.saveProduct', { code, name: `产品${code}` }, { token });
  await callApi(
    request,
    'm.inventory.saveOpening',
    { warehouseId, revision: 0, rows: [{ productCode: 'P2', quantity: '5', unitPrice: '2' }] },
    { token },
  );
  await page.goto('/m/inventory/issues');
  await page.getByRole('button', { name: '新增出库单', exact: true }).click();
  const draft = page.getByRole('dialog', { name: '新增出库单', exact: true });
  await draft.getByLabel('第1行数量', { exact: true }).fill('3');
  await draft.getByLabel('第1行单价', { exact: true }).fill('9');
  await draft.getByLabel('第1行库存速查', { exact: true }).click();
  const picker = page.getByRole('dialog', { name: '库存产品速查', exact: true });
  await picker.getByLabel('库存速查条件', { exact: true }).fill('P2');
  const row = picker
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'P2', exact: true }) });
  await expect(row.getByRole('cell', { name: '5', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: '选用P2', exact: true }).click();
  await expect(picker).not.toBeVisible();
  await expect(draft.getByText('P2 产品P2', { exact: true })).toBeVisible();
  await expect(draft.getByLabel('第1行数量', { exact: true })).toHaveValue('3');
  await expect(draft.getByLabel('第1行单价', { exact: true })).toHaveValue('9');
});
