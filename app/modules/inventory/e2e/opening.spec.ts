import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

type Opening = {
  revision: number;
  rows: {
    productCode: string;
    quantity: string;
    unitPrice: string;
    amountCents: number;
    valueBasis: string;
  }[];
};
async function setup(page: Page, request: APIRequestContext) {
  const book = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '合成期初仓' },
    { token: book.token },
  );
  for (const [code, name] of [
    ['P1', '金额产品'],
    ['P2', '单价产品'],
  ])
    await callApi(request, 'm.inventory.saveProduct', { code, name }, { token: book.token });
  const opening = () =>
    callApi<Opening>(
      request,
      'm.inventory.opening',
      { warehouseId },
      { token: book.token, method: 'GET' },
    );
  await page.goto('/m/inventory/opening');
  return { ...book, warehouseId, opening };
}
async function selectProduct(page: Page, index: number, code: string) {
  await page.getByLabel(`第${index}行产品`, { exact: true }).fill(code);
  await page.keyboard.press('Enter');
}
async function selectBasis(page: Page, index: number, text: string) {
  await page.getByLabel(`第${index}行保存口径`, { exact: true }).click();
  await page.locator('.ant-select-item-option-content').getByText(text, { exact: true }).click();
}

test('w_cb_qc 独立合成账套：页面录入两种口径→切换保留草稿→保存→重新打开及库存回读', async ({
  page,
  request,
}) => {
  const { warehouseId, token, opening } = await setup(page, request);
  await page.getByRole('button', { name: '编辑期初', exact: true }).click();
  await page.getByRole('button', { name: '增加明细行', exact: true }).click();
  await selectProduct(page, 1, 'P1');
  await page.getByLabel('第1行数量', { exact: true }).fill('3');
  await page.getByLabel('第1行单价', { exact: true }).fill('7');
  await selectBasis(page, 1, '直接金额');
  await page.getByLabel('第1行金额', { exact: true }).fill('1.01');
  await expect(page.getByLabel('第1行单价', { exact: true })).toHaveValue('0.336667');
  await expect(page.getByLabel('第1行单价', { exact: true })).toBeDisabled();
  await selectBasis(page, 1, '数量×单价');
  await expect(page.getByLabel('第1行单价', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('第1行金额', { exact: true })).toHaveValue('21.00');
  await selectBasis(page, 1, '直接金额');
  await expect(page.getByLabel('第1行金额', { exact: true })).toHaveValue('1.01');
  await page.getByRole('button', { name: '增加明细行', exact: true }).click();
  await selectProduct(page, 2, 'P2');
  await page.getByLabel('第2行数量', { exact: true }).fill('2.5');
  await page.getByLabel('第2行单价', { exact: true }).fill('3.33');
  await expect(page.getByLabel('第2行金额', { exact: true })).toHaveValue('8.33');
  await expect(page.getByRole('button', { name: 'Excel 导入预览', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存全部期初', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存全部期初', exact: true })).not.toBeVisible();
  await page.reload();
  expect((await opening()).rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        productCode: 'P1',
        quantity: '3',
        unitPrice: '0.336667',
        amountCents: 101,
        valueBasis: 'amount',
      }),
      expect.objectContaining({
        productCode: 'P2',
        quantity: '2.5',
        unitPrice: '3.33',
        amountCents: 833,
        valueBasis: 'unitPrice',
      }),
    ]),
  );
  await expect(page.getByRole('row').filter({ hasText: 'P1' })).toContainText('直接金额');
  await expect(page.getByRole('row').filter({ hasText: 'P2' })).toContainText('8.33');
  await page.getByRole('button', { name: '编辑期初', exact: true }).click();
  await expect(page.getByLabel('第1行金额', { exact: true })).toHaveValue('1.01');
  await expect(page.getByLabel('第1行单价', { exact: true })).toHaveValue('0.336667');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '保存全部期初', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存全部期初', exact: true })).not.toBeVisible();
  expect((await opening()).rows[0]).toMatchObject({
    quantity: '3',
    amountCents: 101,
    valueBasis: 'amount',
  });
  const stock = await callApi<{ balance: string; balanceCents: number }[]>(
    request,
    'm.inventory.stock',
    { warehouseId, productCode: 'P1' },
    { token, method: 'GET' },
  );
  expect(stock[0]).toMatchObject({ balance: '3', balanceCents: 101 });
});

test('w_cb_qc：真实模板混合金额/单价→预览→保存→正式导出→覆盖回导金额及口径不变', async ({
  page,
  request,
}) => {
  const { opening } = await setup(page, request);
  await page.getByRole('button', { name: 'Excel 导入预览', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Excel 导入：先预览再确认保存', exact: true });
  const downloading = page.waitForEvent('download');
  await modal.getByRole('button', { name: '下载导入模板', exact: true }).click();
  const template = await downloading;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(await readFile((await template.path())!)).buffer);
  const ws = wb.worksheets[0]!;
  expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
    '产品编号',
    '数量',
    '保存口径',
    '单价（元）',
    '金额（元）',
  ]);
  ws.addRow(['P1', '3', '直接金额', null, '1.01']);
  ws.addRow(['P2', '2.5', '数量×单价', '3.33', null]);
  await modal.getByLabel('导入Excel文件').setInputFiles({
    name: '合成期初.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await modal.getByRole('button', { name: '预览校验', exact: true }).click();
  await expect(modal.getByText('预览 2 行，0 个错误', { exact: true })).toBeVisible();
  await expect(modal.getByText('期初金额合计 9.34', { exact: true })).toBeVisible();
  expect((await opening()).rows).toEqual([]);
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '确认保存导入', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const old = await opening();
  const exporting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const exported = await exporting;
  expect(exported.suggestedFilename()).toBe('库存期初.xlsx');
  const buffer = await readFile((await exported.path())!);
  const readback = new ExcelJS.Workbook();
  await readback.xlsx.load(new Uint8Array(buffer).buffer);
  expect([1, 2, 3, 4, 5].map((i) => readback.worksheets[0]!.getRow(2).getCell(i).value)).toEqual([
    'P1',
    '3',
    '直接金额',
    '',
    '1.01',
  ]);
  expect([1, 2, 3, 4, 5].map((i) => readback.worksheets[0]!.getRow(3).getCell(i).value)).toEqual([
    'P2',
    '2.5',
    '数量×单价',
    '3.33',
    '',
  ]);
  await page.getByRole('button', { name: 'Excel 导入预览', exact: true }).click();
  await modal.getByLabel('导入Excel文件').setInputFiles({
    name: '回导.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await modal.getByRole('checkbox', { name: '允许覆盖已有数据（需再次预览）' }).check();
  await modal.getByRole('button', { name: '预览校验', exact: true }).click();
  await expect(modal.getByText('预览 2 行，0 个错误', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '确认保存导入', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  const restored = await opening();
  expect(restored.revision).toBe(old.revision + 1);
  expect(
    restored.rows.map(({ productCode, quantity, unitPrice, amountCents, valueBasis }) => ({
      productCode,
      quantity,
      unitPrice,
      amountCents,
      valueBasis,
    })),
  ).toEqual(
    old.rows.map(({ productCode, quantity, unitPrice, amountCents, valueBasis }) => ({
      productCode,
      quantity,
      unitPrice,
      amountCents,
      valueBasis,
    })),
  );
});

test('w_cb_qc：不支持边界显示原因；并发修改拒绝旧表单且保留用户金额', async ({ page, request }) => {
  const { token, warehouseId, opening } = await setup(page, request);
  const initial = {
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '3', valueBasis: 'amount', amountCents: 100 }],
  };
  await callApi(request, 'm.inventory.saveOpening', initial, { token });
  await page.reload();
  await page.getByRole('button', { name: '编辑期初', exact: true }).click();
  await page.getByLabel('第1行数量', { exact: true }).fill('0');
  await page.getByRole('button', { name: '保存全部期初', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '数量为零，无法反算期初单价' }),
  ).toBeVisible();
  expect((await opening()).rows[0]!.amountCents).toBe(100);
  await page.getByLabel('第1行数量', { exact: true }).fill('20000');
  await page.getByLabel('第1行金额', { exact: true }).fill('0.01');
  await page.getByRole('button', { name: '保存全部期初', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '六位小数反算单价无法回算到输入金额' }),
  ).toBeVisible();
  await page.getByLabel('第1行数量', { exact: true }).fill('3');
  await page.getByLabel('第1行金额', { exact: true }).fill('3.00');
  await callApi(
    request,
    'm.inventory.saveOpening',
    {
      ...initial,
      revision: 1,
      confirmReplace: true,
      rows: [{ ...initial.rows[0], amountCents: 200 }],
    },
    { token },
  );
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '保存全部期初', exact: true }).click();
  await expect(page.getByText('数据已被其他操作修改', { exact: true })).toBeVisible();
  await expect(page.getByLabel('第1行金额', { exact: true })).toHaveValue('3.00');
  expect((await opening()).rows[0]!.amountCents).toBe(200);
});
