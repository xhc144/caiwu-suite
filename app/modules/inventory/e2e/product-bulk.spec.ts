import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
test('w_cb_cpda/w_cb_tyzs：所选产品文本批改预览保存，恢复本行回到已保存版本', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  for (const code of ['P1', 'P2'])
    await callApi(
      request,
      'm.inventory.saveProduct',
      { code, name: `产品${code}`, specification: '原规格' },
      { token },
    );
  await page.goto('/m/inventory/master');
  await page.getByLabel('选择产品P1', { exact: true }).check();
  await page.getByLabel('批量字段', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .getByText('规格', { exact: true })
    .click();
  await page.getByLabel('批量数值', { exact: true }).fill('新规格');
  await page.getByRole('button', { name: '批量预览' }).click();
  const modal = page.getByRole('dialog', { name: '批量修改预览', exact: true });
  await expect(modal.getByRole('cell', { name: 'P1', exact: true })).toBeVisible();
  await expect(modal.getByRole('cell', { name: 'P2', exact: true })).toHaveCount(0);
  await expect(modal.getByRole('cell', { name: '新规格', exact: true })).toBeVisible();
  await modal.getByRole('button', { name: '确认修改', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const products = await callApi<{ code: string; specification: string }[]>(
    request,
    'm.inventory.products',
    {},
    { token, method: 'GET' },
  );
  expect(products.map((p) => [p.code, p.specification])).toEqual([
    ['P1', '新规格'],
    ['P2', '原规格'],
  ]);
  const first = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'P1', exact: true }) });
  await first.getByRole('button', { name: '编辑/修改编号', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑产品 / 修改编号' });
  await drawer.getByLabel('规格', { exact: true }).fill('未保存规格');
  page.once('dialog', (d) => d.accept());
  await drawer.getByRole('button', { name: '恢复本行', exact: true }).click();
  await expect(drawer.getByLabel('规格', { exact: true })).toHaveValue('新规格');
});
