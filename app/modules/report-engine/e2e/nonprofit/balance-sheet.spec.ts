import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import type { Report } from '../../shared';
import { balance401ClosingTemplate } from '../../templates/nonprofit/balance-sheet';
import { balanceFixtureMapping } from '../../test/nonprofit/balance-fixture';
import { test } from './fixture';

test('民非401期末真实生成与下载：受托现金移列、减值和到期分类，年初仍清楚标为未接入', async ({
  page,
  nonprofit,
}) => {
  const bookId = await nonprofit.createBook('balance');
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    nonprofit.request,
    'core.auth.login',
    { bookId, userCode: 'admin', password: 'admin' },
  );
  await page.addInitScript(
    (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
    { token: login.token, bookId, user: login.user, book: login.book },
  );
  const report = await callApi<Report>(
    nonprofit.request,
    'm.report-engine.importTemplate',
    balance401ClosingTemplate(balanceFixtureMapping()),
    { token: login.token, method: 'POST' },
  );
  await page.goto(`${nonprofit.baseURL}/m/report-engine/view?id=${report.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-C6').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '60000',
  );
  await expect(page.getByTestId('result-C23').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '16000',
  );
  await expect(page.getByTestId('result-B6')).toContainText('待接入真实取数');
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await wait).path())!);
  const ws = wb.worksheets[0]!;
  expect(ws.getCell('C12').value).toBe(110);
  expect(ws.getCell('C18').value).toBe(260);
  expect(ws.getCell('C24').value).toBe(600);
  expect(ws.getCell('C36').value).toBe(100);
  expect(ws.getCell('C37').value).toBe(2490);
  expect(ws.getCell('F28').value).toBe(2490);
  expect(ws.getCell('B37').value).toBe('待接入真实取数');
  expect(ws.getCell('A1').value).toContain('年初未接入');
});
