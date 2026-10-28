import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook } from './scenarios';
import type { Outputs } from '../web/api';

test('w_cn_slz/w_cn_wbhz 外币日记账、汇总、未结账开关和导出显示真实双币金额', async ({
  cashier,
}) => {
  const book = await bankBook(cashier);
  const ids = await cashier.withServices(book.bookId, async (svc) => ({
    coreAccountId: (await svc.accounts.require('100202')).id,
    oppositeAccountId: (await svc.accounts.require('6603')).id,
  }));
  const account = await callApi<{ id: number }>(
    cashier.request,
    'm.cashier.saveAccount',
    {
      data: {
        name: '美元报表银行',
        coreAccountId: ids.coreAccountId,
        currency: 'USD',
        opening: 71000,
        foreignOpening: 10000,
      },
    },
    { token: book.token },
  );
  for (const row of [
    { amount: 14200, foreignAmount: 2000, direction: 'receipt', summary: '美元收款' },
    { amount: 3550, foreignAmount: 500, direction: 'payment', summary: '美元付款' },
  ])
    await callApi(
      cashier.request,
      'm.cashier.createDocument',
      {
        ...row,
        accountId: account.id,
        date: '2026-01-10',
        period: 202601,
        exchangeRate: '7.1',
        oppositeAccountId: ids.oppositeAccountId,
        dimensions: { cashflow: book.cashflow },
        requestKey: randomUUID(),
      },
      { token: book.token },
    );
  const { page } = cashier;
  await page.goto(`/m/cashier/reports?accountId=${account.id}&from=2026-01-01&to=2026-01-31`);
  await expect(page.getByRole('heading', { name: '出纳日记账', exact: true })).toBeVisible();
  await expect(
    page.getByText('USD 原币期初 100.00 · 收款 20.00 · 付款 5.00 · 期末 115.00', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /美元收款/ })).toContainText('142.00');
  await expect(page.getByRole('row', { name: /美元收款/ })).toContainText('20.00');
  await page.getByRole('button', { name: '汇总余额表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '出纳汇总余额表', exact: true })).toBeVisible();
  const usdRow = page.getByRole('row', { name: /美元报表银行/ });
  await expect(usdRow).toContainText('816.50');
  await expect(usdRow).toContainText('115.00');
  await expect(page.getByRole('row', { name: /^USD / })).toContainText('115.00');
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /导出 Excel/ })
    .first()
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('出纳汇总余额表.xlsx');
  const wb = new ExcelJS.Workbook();
  const file = await download.path();
  expect(file).not.toBeNull();
  await wb.xlsx.readFile(file!);
  const sheet = wb.worksheets[0]!;
  const exported = sheet
    .getRows(2, sheet.rowCount - 1)!
    .find((row) => row.getCell(1).value === '美元报表银行')!;
  expect(exported).toBeDefined();
  expect(Array.from({ length: 12 }, (_, i) => exported.getCell(i + 4).value)).toEqual([
    710, 142, 35.5, 816.5, 142, 35.5, 100, 20, 5, 115, 20, 5,
  ]);
  await page.getByLabel('包含未结账单据', { exact: true }).uncheck();
  await page.getByRole('button', { name: /查询/ }).click();
  await expect(
    page.getByText('2026年01月 至 2026年01月 · 仅已结账单据', { exact: true }),
  ).toBeVisible();
  await expect(usdRow).toContainText('710.00');
  await expect(usdRow).toContainText('100.00');
  const p = await callApi<Outputs['periods']>(cashier.request, 'm.cashier.periods', undefined, {
    token: book.token,
    method: 'GET',
  });
  await callApi(
    cashier.request,
    'm.cashier.closePeriod',
    { period: p.current, snapshot: p.snapshot, confirmed: true },
    { token: book.token },
  );
  await page.getByRole('button', { name: /查询/ }).click();
  await expect(usdRow).toContainText('816.50');
  await expect(usdRow).toContainText('115.00');
  await usdRow.getByRole('button', { name: '查看单据', exact: true }).click();
  await expect(page.getByRole('heading', { name: '出纳收付单', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /美元收款/ })).toContainText('142.00');
  await expect(page.getByRole('row', { name: /美元付款/ })).toContainText('35.50');
});
