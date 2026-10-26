import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test } from './fixture';

test('w_zw_ye：真实安全整数极值凭证导出本位币，XLSX 回读保留原来的一分', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 9007199254740901 },
          { account: '4001', credit: 9007199254740901 },
        ],
      },
    ]);
  });
  await page.goto(
    `${localServer.url}/m/balances?from=202601&to=202601&codeFrom=1001&codeTo=1001&level=-1`,
  );
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: '明细 1001', exact: true }) }),
  ).toContainText('90,071,992,547,409.01');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await downloaded).path())!);
  const ws = wb.worksheets[0]!;
  expect(ws.getCell('A3').text).toContain('精确两位小数文本');
  for (const cell of ['E5', 'G5', 'J5', 'E6', 'G6'])
    expect(ws.getCell(cell).value).toBe('90071992547409.01');
  expect(ws.getCell('D5').value).toBe(0);
  expect(ws.getCell('F5').value).toBe(0);
});

test('w_zw_fhwbye：真实 USD 正额与 EUR 红字贷方极值，原币/本位币逐分导出不串币', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await svc.db
      .insertInto('currency')
      .values({ code: 'EUR', name: '欧元', symbol: '€', is_base: 0, disabled: 0, sort: 2 })
      .execute();
    for (const [code, currency] of [
      ['100203', 'USD'],
      ['100204', 'EUR'],
    ] as const)
      await svc.accounts.create(
        {
          code,
          name: `合成${currency}精度样例`,
          currency,
          dimensions: [{ type: 'project', required: false }],
        },
        [4, 2, 2],
      );
    await seedVouchers(svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          {
            account: '100203',
            debit: 9007199254740901,
            currency: 'USD',
            rate: '1',
            fcAmount: 9007199254740901,
            dims: { project: 'XM01' },
          },
          { account: '4001', credit: 9007199254740901 },
        ],
      },
      {
        date: '2026-01-11',
        status: 'posted',
        lines: [
          {
            account: '100204',
            credit: -Number.MAX_SAFE_INTEGER,
            currency: 'EUR',
            rate: '1',
            fcAmount: -Number.MAX_SAFE_INTEGER,
            dims: { project: 'XM01' },
          },
          { account: '4001', debit: -Number.MAX_SAFE_INTEGER },
        ],
      },
    ]);
  });
  await page.goto(
    `${localServer.url}/m/balances/auxiliary/foreign?from=202601&to=202601&codeFrom=1002&codeTo=1002&level=-1`,
  );
  await expect(page.getByRole('region', { name: /^USD余额 XM01 / })).toContainText(
    '90,071,992,547,409.01',
  );
  await expect(page.getByRole('region', { name: /^EUR余额 XM01 / })).toContainText(
    '-90,071,992,547,409.91',
  );
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await downloaded).path())!);
  expect(wb.worksheets).toHaveLength(2);
  const usd = wb.worksheets.find((ws) => ws.getCell('A2').text.includes('币种：USD'))!;
  const eur = wb.worksheets.find((ws) => ws.getCell('A2').text.includes('币种：EUR'))!;
  expect(usd.getCell('A5').value).toBe('100203');
  expect(eur.getCell('A5').value).toBe('100204');
  for (const row of [5, 6]) {
    for (const col of [5, 7, 12, 14])
      expect(usd.getRow(row).getCell(col).value).toBe('90071992547409.01');
    for (const col of [6, 8, 13])
      expect(eur.getRow(row).getCell(col).value).toBe('-90071992547409.91');
    expect(eur.getRow(row).getCell(14).value).toBe('90071992547409.91');
  }
  expect(eur.getCell('J5').value).toBe('90071992547409.91');
});
