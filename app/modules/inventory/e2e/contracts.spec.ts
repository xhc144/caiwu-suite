import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { importExportColumns } from '../excel';

async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '采购仓' },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveProduct',
    { code: 'HT-P1', name: '合成合同产品' },
    { token },
  );
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token },
  );
  const partners = await callApi<{ id: number; code: string }[]>(
    request,
    'core.dimensions.items',
    { type: 'partner' },
    { token, method: 'GET' },
  );
  return {
    token,
    warehouseId,
    accountId: accounts.find((a) => a.code === '1001')!.id,
    supplierId: partners.find((p) => p.code === 'S001')!.id,
  };
}
test('ht1/ht2/w_ck_rk：页面分批带入剩余量，履约穿透原单', async ({ page, request }) => {
  const { token, warehouseId, supplierId } = await setup(page, request);
  await callApi(
    request,
    'm.inventory.saveContract',
    {
      number: 'HT-BATCH',
      warehouseId,
      supplierId,
      date: '2026-01-05',
      lines: [{ productCode: 'HT-P1', quantity: '10', unitPrice: '3' }],
    },
    { token },
  );
  await page.goto('/m/inventory/contracts');
  let row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'HT-BATCH', exact: true }) });
  await row.getByRole('button', { name: '带入新入库草稿' }).click();
  const receipt = page.getByRole('dialog', { name: '新增入库单', exact: true });
  await receipt.getByLabel('单号', { exact: true }).fill('HT-R1');
  await receipt.getByLabel('付款科目', { exact: true }).fill('1001');
  await page.keyboard.press('Enter');
  await receipt.getByLabel('第1行数量', { exact: true }).fill('4');
  await receipt.getByRole('button', { name: '保存单据', exact: true }).click();
  await expect(receipt).not.toBeVisible();
  await page.goto('/m/inventory/contracts');
  row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'HT-BATCH', exact: true }) });
  await row.getByRole('button', { name: '履约明细' }).click();
  const fulfillment = page.getByRole('dialog', { name: '采购合同履约明细' });
  const product = fulfillment.getByRole('row').filter({ hasText: 'HT-P1' });
  await expect(product.getByRole('cell', { name: '10', exact: true })).toBeVisible();
  await expect(product.getByRole('cell', { name: '4', exact: true })).toBeVisible();
  await expect(product.getByRole('cell', { name: '6', exact: true })).toBeVisible();
  await fulfillment.getByRole('button', { name: '查看入库单' }).click();
  await expect(page.getByRole('dialog', { name: '单据 HT-R1', exact: true })).toBeVisible();
  await page.goto('/m/inventory/contracts');
  row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'HT-BATCH', exact: true }) });
  await row.getByRole('button', { name: '带入新入库草稿' }).click();
  await expect(
    page.getByRole('dialog', { name: '新增入库单' }).getByLabel('第1行数量', { exact: true }),
  ).toHaveValue('6');
});

test('ht1/ht2：完整合同Excel预览、保存、下载回读和跨账套编码文件字段', async ({
  page,
  request,
}) => {
  await setup(page, request);
  const cols = importExportColumns('contracts'),
    wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('采购合同');
  ws.addRow(cols.map((c) => c.title));
  const row = {
    number: 'HT-FILE',
    warehouseCode: '01',
    supplierCode: 'S001',
    date: '2026-01-05',
    dueDate: '2026-01-20',
    agent: '合同会计',
    note: '完整头信息',
    status: 'open',
    productCode: 'HT-P1',
    quantity: '2.5',
    unitPrice: '3.12',
    lineNote: '完整行信息',
  };
  ws.addRow(cols.map((c) => c.value(row)));
  await page.goto('/m/inventory/contracts');
  await page.getByRole('button', { name: 'Excel 导入预览', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Excel 导入：先预览再确认保存' });
  await modal.getByLabel('导入Excel文件', { exact: true }).setInputFiles({
    name: '完整合同.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await modal.getByLabel('预览校验', { exact: true }).click();
  await expect(modal.getByText('预览 1 行，0 个错误')).toBeVisible();
  await expect(modal.getByRole('cell', { name: 'HT-FILE', exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await modal.getByLabel('确认保存导入', { exact: true }).click();
  await expect(modal).not.toBeVisible();
  const downloaded = page.waitForEvent('download');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '导出当前合同头行' }).click();
  const data = await readFile((await (await downloaded).path())!);
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(new Uint8Array(data).buffer);
  const sheet = exported.worksheets[0]!;
  expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(cols.map((c) => c.title));
  expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual(cols.map((c) => c.value(row)));
});
