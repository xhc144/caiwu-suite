import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
test('w_ck_tz/w_ck_tz1：范围连续台账包含各产品，隐藏无发生项，完整导出数量与未知成本', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '连续台账仓' },
    { token },
  );
  for (const code of ['B1', 'B2', 'B3'])
    await callApi(request, 'm.inventory.saveProduct', { code, name: `产品${code}` }, { token });
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
      kind: 'receipt',
      warehouseId,
      requestKey: crypto.randomUUID(),
      number: 'B-R1',
      date: '2026-01-10',
      category: '采购',
      accountId: accounts.find((a) => a.code === '1001')!.id,
      lines: [
        { productCode: 'B1', quantity: '2', unitPrice: '3' },
        { productCode: 'B2', quantity: '1', unitPrice: '4' },
      ],
    },
    { token },
  );
  await page.goto('/m/inventory/stock');
  await page.getByRole('button', { name: '按产品范围连续台账' }).click();
  const drawer = page.getByRole('dialog', { name: '产品范围连续台账' });
  await expect(drawer.getByText('库存台账-B1 产品B1', { exact: true })).toBeVisible();
  await expect(drawer.getByText('库存台账-B3 产品B3', { exact: true })).toBeVisible();
  await drawer.getByRole('checkbox', { name: '隐藏本期无发生台账' }).check();
  await expect(drawer.getByText('库存台账-B3 产品B3', { exact: true })).not.toBeVisible();
  const download = page.waitForEvent('download');
  await drawer.getByRole('button', { name: '导出全部产品台账' }).click();
  const bytes = await readFile((await (await download).path())!);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(bytes).buffer);
  const ws = wb.worksheets[0]!;
  expect(ws.rowCount).toBe(5);
  expect(ws.getCell('A2').value).toBe('B1');
  expect(ws.getCell('A4').value).toBe('B2');
  expect(ws.getCell('G3').value).toBe('2');
  expect(ws.getCell('I3').value).toBe('6.00');
  expect(ws.getCell('G5').value).toBe('1');
});
