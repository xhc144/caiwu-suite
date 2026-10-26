import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import type { Report } from '../../shared';
import { cashflow403Template } from '../../templates/nonprofit/cashflow';
import { fixtureMapping } from '../../test/nonprofit/fixture';
import { test } from './fixture';

test('民非w_bb_get → w_bb_proc本年真实取数 → w_bb_saveas下载Excel，独立testkit账套', async ({
  page,
  nonprofit,
}) => {
  const bookId = await nonprofit.createBook();
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    nonprofit.request,
    'core.auth.login',
    { bookId, userCode: 'admin', password: 'admin' },
  );
  const token = login.token;
  await page.addInitScript(
    (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
    { token, bookId, user: login.user, book: login.book },
  );
  const report = await callApi<Report>(
    nonprofit.request,
    'm.report-engine.importTemplate',
    cashflow403Template(fixtureMapping()),
    { token, method: 'POST' },
  );
  await page.goto(`${nonprofit.baseURL}/m/report-engine/view?id=${report.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  const confirmation = page.getByRole('dialog', { name: '生成前发现未过账凭证' });
  await expect(confirmation).toContainText('1 张未过账凭证');
  await confirmation.getByRole('button', { name: '按所选口径继续生成' }).click();
  await expect(page.getByTestId('result-B6').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '98000',
  );
  await expect(page.getByTestId('result-B23').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '4700',
  );
  // 引擎默认只展示30行，后续各行在真实下载文件中逐项检查。
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const download = await downloadWait;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await download.path())!);
  const ws = wb.worksheets[0]!;
  expect(ws.getCell('B6').value).toBe(980);
  expect(ws.getCell('B23').value).toBe(47);
  expect(ws.getCell('B19').value).toBe(1080);
  expect(ws.getCell('B30').value).toBe(-253);
  expect(ws.getCell('B39').value).toBe(390);
  expect(ws.getCell('B41').value).toBe(1217);
  expect(ws.getCell('C41').value).toContain('2026首次执行');
  expect(ws.getCell('A1').value).toContain('未完成制度报表接入');
  expect(wb.getWorksheet('口径与审核')!.getCell('B3').value).toBe('仅已过账');
  await page.reload();
  await expect(page.getByTestId('result-B6').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '98000',
  );
});
