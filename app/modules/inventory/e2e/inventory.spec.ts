import { expect, test, type Locator, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
async function select(page: Page, container: Locator, label: string, text: string) {
  await container.getByLabel(label, { exact: true }).fill(text);
  await page.keyboard.press('Enter');
}
async function newDocument(
  page: Page,
  kind: 'receipt' | 'issue',
  number: string,
  quantity: string,
) {
  await page.goto(`/m/inventory/${kind === 'receipt' ? 'receipts' : 'issues'}`);
  await page
    .getByRole('button', { name: `新增${kind === 'receipt' ? '入库单' : '出库单'}`, exact: true })
    .click();
  const d = page.getByRole('dialog');
  await d.getByLabel('单号', { exact: true }).fill(number);
  await select(page, d, kind === 'receipt' ? '付款科目' : '收款科目', '1001');
  if (kind === 'issue') await select(page, d, '成本科目', '6401');
  await select(page, d, '第1行产品', 'P1');
  await d.getByLabel('第1行数量', { exact: true }).fill(quantity);
  await d.getByLabel('第1行单价', { exact: true }).fill('3.33');
  return d;
}
test('M16 独立闭环：期初10 → 入库5 → 出库3 → 库存台账12 → 盘点11差异−1；复制、负库存及审核保护', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto('/m/inventory/master');
  await expect(page.getByRole('heading', { name: '产品与仓库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增仓库', exact: true }).click();
  let drawer = page.getByRole('dialog');
  await drawer.getByLabel('仓库编码', { exact: true }).fill('01');
  await drawer.getByLabel('仓库名称', { exact: true }).fill('原料仓');
  await drawer.getByRole('button', { name: '保存仓库', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: '新增产品', exact: true }).click();
  drawer = page.getByRole('dialog');
  await drawer.getByLabel('产品编号', { exact: true }).fill('P1');
  await drawer.getByLabel('产品名称', { exact: true }).fill('试用产品');
  await drawer.getByLabel('默认入库价', { exact: true }).fill('2.55');
  await drawer.getByRole('button', { name: '保存产品', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.goto('/m/inventory/opening');
  await page.getByRole('button', { name: '编辑期初', exact: true }).click();
  await page.getByRole('button', { name: '增加明细行' }).click();
  await select(page, page.locator('main'), '第1行产品', 'P1');
  await page.getByLabel('第1行数量', { exact: true }).fill('10');
  await page.getByLabel('第1行单价', { exact: true }).fill('2.55');
  await page.getByRole('button', { name: '保存全部期初' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'P1' })).toContainText('10');
  drawer = await newDocument(page, 'receipt', 'R1', '5');
  await drawer.getByRole('button', { name: '保存单据', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  drawer = await newDocument(page, 'issue', 'S1', '3');
  await drawer.getByRole('button', { name: '保存单据', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.goto('/m/inventory/stock?productCode=P1');
  const stock = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: '查看台账' }) });
  await expect(stock).toContainText('12');
  const issueRow = page.getByRole('row').filter({ hasText: 'S1' });
  await expect(issueRow).toContainText('12');
  await issueRow.getByRole('button', { name: '查看原单' }).click();
  await expect(page).toHaveURL(/\/m\/inventory\/issues\?id=/);
  await expect(page.getByRole('dialog')).toContainText('S1');
  await page.goto('/m/inventory/counts');
  await page.getByRole('button', { name: '生成账面快照', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'P1' })).toContainText('12');
  await page.getByRole('button', { name: '录入实盘', exact: true }).click();
  await page.getByLabel('实盘P1', { exact: true }).fill('11');
  await page.getByRole('button', { name: '保存实盘', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'P1' })).toContainText('-1');
  await page.goto('/m/inventory/receipts');
  let row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'R1', exact: true }) });
  await row.getByRole('button', { name: '审核', exact: true }).click();
  await expect(row).toContainText('已审核');
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText(/单据 R1 已审核，不能修改或删除/)).toBeVisible();
  await row.getByRole('button', { name: '复制新增', exact: true }).click();
  drawer = page.getByRole('dialog');
  await expect(drawer.getByLabel('单号', { exact: true })).toHaveValue('');
  await drawer.getByLabel('单号', { exact: true }).fill('R2');
  await drawer.getByRole('button', { name: '保存单据', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'R2', exact: true }) });
  await expect(row).toContainText('未审核');
  drawer = await newDocument(page, 'issue', 'S2', '100');
  page.once('dialog', (d) => d.dismiss());
  await drawer.getByRole('button', { name: '保存单据', exact: true }).click();
  await expect(drawer).toBeVisible();
  expect(
    await callApi<unknown[]>(
      request,
      'm.inventory.documents',
      { keyword: 'S2' },
      { token, method: 'GET' },
    ),
  ).toHaveLength(0);
  page.once('dialog', (d) => d.accept());
  await drawer.getByRole('button', { name: '保存单据', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.goto('/m/inventory/stock?productCode=P1');
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('button', { name: '查看台账' }) }),
  ).toContainText('-83');
});

test('w_cb_cpda/w_cb_qc/w_ck_rk1/w_cb_pdk_1 未保存退出与刷新可取消', async ({ page, request }) => {
  await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto('/m/inventory/master');
  await page.getByRole('button', { name: '新增产品', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('产品编号', { exact: true }).fill('UNSAVED');
  page.once('dialog', (dialog) => dialog.dismiss());
  await d.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(d.getByLabel('产品编号', { exact: true })).toHaveValue('UNSAVED');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.keyboard.press('Control+F4');
  await expect(d).toBeVisible();
  await Promise.all([
    page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.type()).toBe('beforeunload');
      await dialog.dismiss();
    }),
    page.evaluate(() => {
      setTimeout(() => window.location.reload(), 0);
    }),
  ]);
  await expect(d.getByLabel('产品编号', { exact: true })).toHaveValue('UNSAVED');
});
