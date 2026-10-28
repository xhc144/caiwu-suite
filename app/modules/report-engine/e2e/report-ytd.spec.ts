import { expect, type Locator } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

async function choose(select: Locator, text: string) {
  await select.click();
  await select
    .page()
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: text })
    .click();
}

test('w_bb_def_help F8定义外币和数量累计，二月生成跨月结果并导出Excel', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        {
          account: '100202',
          debit: 7100,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 1000,
          dims: { cashflow: 'CF01' },
        },
        { account: '1403', debit: 100, quantity: '1.234567', unitPrice: '1' },
        { account: '6001', credit: 7200 },
      ],
    },
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        {
          account: '100202',
          debit: 2130,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 300,
          dims: { cashflow: 'CF01' },
        },
        { account: '1403', debit: 100, quantity: '2.000001', unitPrice: '1' },
        { account: '6001', credit: 2230 },
      ],
    },
  ]);
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    emptyTemplate({ code: '101', name: '真实累计向导合成报表', rows: 2, cols: 2 }),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  for (const [cell, account, unit] of [
    ['A1', '100202', '外币金额'],
    ['B1', '1403', '数量'],
  ] as const) {
    await page.getByRole('textbox', { name: cell, exact: true }).focus();
    await page.keyboard.press('F8');
    const wizard = page.getByRole('dialog', { name: '报表函数向导（F8）' });
    await wizard.getByRole('combobox').first().fill(account);
    await page.keyboard.press('Enter');
    await choose(wizard.getByLabel('期间口径'), '本年累计借方');
    await choose(wizard.getByLabel('返回单位'), unit);
    if (account === '100202') await choose(wizard.getByLabel('币种'), 'USD');
    await wizard.getByRole('button', { name: '插入到当前单元格', exact: true }).click();
    await expect(wizard).not.toBeVisible();
  }
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByTestId('result-A1')).toContainText('13.00');
  await expect(page.getByTestId('result-B1')).toContainText('3.234568');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await (await downloaded).path())!);
  expect(workbook.worksheets[0]!.getCell('A1').value).toBe(13);
  expect(workbook.worksheets[0]!.getCell('B1').value).toBe(3.234568);
});
