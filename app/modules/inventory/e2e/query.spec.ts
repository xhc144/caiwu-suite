import { expect, test, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function choose(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).click();
  if (label.endsWith('字段')) await page.getByLabel(label, { exact: true }).fill(text);
  await page.locator('.ant-select-dropdown:visible').getByText(text, { exact: true }).click();
}

test('w_ck_cx_rkd/w_ck_cx_ckd：括号组合、多列排序、自选列、重复头、导出和原单穿透', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const post = <T = unknown>(name: string, input: unknown) =>
    callApi<T>(request, `m.inventory.${name}`, input, { token });
  const warehouseId = await post<number>('saveWarehouse', { code: '01', name: '查询仓' });
  await post('saveProduct', { code: 'P1', name: '精密产品' });
  await post('saveProduct', { code: 'P2', name: '普通产品' });
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token, method: 'GET' },
  );
  const accountId = accounts.find((a) => a.code === '1001')!.id;
  await post('saveDocument', {
    requestKey: 'query-e2e-receipt-1',
    kind: 'receipt',
    warehouseId,
    number: 'Q-R1',
    date: '2026-01-10',
    category: '采购',
    accountId,
    lines: [
      { productCode: 'P1', quantity: '2', unitPrice: '3', note: '保留此行' },
      { productCode: 'P2', quantity: '10', unitPrice: '1', note: '排除此行' },
    ],
  });
  await post('saveDocument', {
    requestKey: 'query-e2e-receipt-2',
    kind: 'receipt',
    warehouseId,
    number: 'Q-R2',
    date: '2026-01-11',
    category: '采购',
    accountId,
    lines: [{ productCode: 'P1', quantity: '3', unitPrice: '5' }],
  });
  await page.goto('/m/inventory/query');
  await expect(page.getByRole('heading', { name: '单据综合查询', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('共查询到 3 条明细');
  await page.getByRole('button', { name: '增加条件', exact: true }).click();
  await choose(page, '条件1.1字段', '数量');
  await choose(page, '条件1.1运算符', '大于等于');
  await page.getByLabel('条件1.1值', { exact: true }).fill('2');
  await page.getByRole('button', { name: '增加括号组', exact: true }).click();
  await choose(page, '第1.2组逻辑', '任意满足（或）');
  await choose(page, '条件1.2.1运算符', '等于');
  await page.getByLabel('条件1.2.1值', { exact: true }).fill('Q-R2');
  await page.getByRole('button', { name: '组1.2增加条件', exact: true }).click();
  await choose(page, '条件1.2.2字段', '明细说明');
  await page.getByLabel('条件1.2.2值', { exact: true }).fill('保留');
  await page.getByRole('button', { name: '增加排序', exact: true }).click();
  await choose(page, '排序1字段', '数量');
  await choose(page, '排序1方向', '降序');
  await page.getByRole('button', { name: '增加排序', exact: true }).click();
  await choose(page, '排序2字段', '产品编号');
  await page.getByLabel('查询显示列', { exact: true }).fill('明细说明');
  await page.keyboard.press('Enter');
  await page.getByLabel('查询显示列', { exact: true }).press('Escape');
  await page.getByRole('button', { name: '执行综合查询', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('共查询到 2 条明细');
  await expect(page.getByRole('columnheader', { name: /^明细说明/ })).toBeVisible();
  const rows = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: '查看原单', exact: true }) });
  await expect(rows.nth(0)).toContainText('Q-R2');
  await expect(rows.nth(1)).toContainText('Q-R1');
  await expect(page.getByRole('cell', { name: '普通产品', exact: true })).not.toBeVisible();
  await page.getByLabel('条件1.1值', { exact: true }).fill('不是数字');
  await page.getByRole('button', { name: '执行综合查询', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('数量应为数字');
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: '清空查询条件', exact: true }).click();
  await page.getByRole('checkbox', { name: '重复单据头不显示', exact: true }).check();
  await page.getByRole('button', { name: '执行综合查询', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('共查询到 3 条明细');
  await expect(rows.nth(0)).toContainText('Q-R1');
  await expect(rows.nth(1)).not.toContainText('Q-R1');
  await expect(rows.nth(1)).toContainText('普通产品');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出 Excel$/ }).click();
  expect((await download).suggestedFilename()).toBe('单据综合查询.xlsx');
  await rows.nth(2).getByRole('button', { name: '查看原单', exact: true }).click();
  await expect(page).toHaveURL(/\/m\/inventory\/receipts\?id=/);
  await expect(page.getByRole('dialog')).toContainText('Q-R2');
});
