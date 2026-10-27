import { expect, test as base } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import type { LedgerReport } from '../shared';
import { seedGeneralBook } from '../test/general-seed';
import { startGeneralEnvironment, type GeneralEnvironment } from './general-fixture';

const test = base.extend<{ general: GeneralEnvironment }>({
  general: async ({ browser: _browser }, use) => {
    const environment = await startGeneralEnvironment();
    try {
      await use(environment);
    } finally {
      await environment.close();
    }
  },
});

test('w_zc_zc_1：期中未知、月发生/累计展开、查询刷新、精确导出、安全打印与明细追溯', async ({
  page,
  general,
}) => {
  const book = await loginWithNewBook(page, general.request, { startMonth: 7 });
  const seeded = await general.withBook(book.bookId, seedGeneralBook);
  await page.goto(`${general.baseURL}/m/ledgers/general?account=1001&from=202601&to=202608`);
  await expect(page.getByRole('heading', { name: '总分类账' })).toBeVisible();
  await expect(page.getByRole('row', { name: /启用前（月额及余额未知）/ })).toHaveCount(6);
  await expect(page.getByRole('row', { name: /启用期初余额/ })).toContainText('60.00');
  await expect(page.getByRole('row', { name: /2026年07月.*本月发生/ })).toContainText('17.00');
  await expect(page.getByRole('row', { name: /本年累计/ })).toHaveCount(0);
  await page.getByRole('button', { name: '展开全部月份' }).click();
  await expect(page.getByRole('row', { name: /2026年08月.*本年累计/ })).toContainText('117.00');
  await expect(page.getByRole('row', { name: /2026年08月.*期末余额/ })).toContainText('72.00');
  await page.getByRole('checkbox', { name: '包含未过账凭证' }).check();
  await page.getByRole('button', { name: /查询$/ }).click();
  await expect(page.getByRole('row', { name: /2026年07月.*本月发生/ })).toContainText('20.00');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '包含未过账凭证' })).toBeChecked();
  await page.getByRole('button', { name: '展开全部月份' }).click();
  await expect(page.getByRole('row', { name: /2026年08月.*本年累计/ })).toContainText('120.00');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const file = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.rowCount).toBe(15);
  expect(sheet.getRow(1).values.toString()).toContain('启用前月额、余额未知');
  expect(sheet.getRow(3).getCell(5).value).toBe('');
  expect(sheet.getRow(3).getCell(8).value).toBe('');
  expect(sheet.getRow(14).values).toContain('120.00');
  expect(sheet.getRow(15).values).toContain('75.00');
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html, options) => {
        document.body.dataset.generalPrint = html;
        document.body.dataset.generalPrintTitle = options.title;
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect
    .poll(() => page.locator('body').getAttribute('data-general-print'))
    .toContain('120.00');
  expect(await page.locator('body').getAttribute('data-general-print')).toContain(
    "default-src 'none'",
  );
  expect(await page.locator('body').getAttribute('data-general-print-title')).toBe('总分类账');
  const month = page.getByRole('row', { name: /2026年07月.*本月发生/ });
  const link = month.getByRole('link', { name: '查看明细' });
  expect(await link.getAttribute('href')).toContain('includeUnposted=1');
  await link.click();
  await expect(page).toHaveURL(/\/m\/ledgers\/detail\?.*from=202607/);
  await expect(page.getByRole('heading', { name: '三栏明细账' })).toBeVisible();
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('75.00');
  expect(await page.getByRole('link', { name: /记-/ }).first().getAttribute('href')).toContain(
    `id=${seeded.voucherId}`,
  );
});

test('w_zc_zc_1：跨年109个月分页与折叠不截断金额；Excel保留大额整分', async ({ page, general }) => {
  test.setTimeout(60000);
  const book = await loginWithNewBook(page, general.request, { startMonth: 7 });
  await general.withBook(book.bookId, async (svc) => {
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require('1001')).id,
      balance: 9000000000000001,
    });
    await seedVouchers(
      svc,
      Array.from({ length: 105 }, () => ({
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '1001', credit: 1 },
          { account: '4001', debit: 1 },
        ],
      })),
    );
  });
  const q = { kind: 'general', periodFrom: 202607, periodTo: 203507, account: '1001' };
  const report = await callApi<LedgerReport>(general.request, 'm.ledgers.report', q, {
    token: book.token,
    method: 'GET',
  });
  expect(report.rows.filter((r) => r.kind === 'month')).toHaveLength(109);
  expect(report.rows[1]).toMatchObject({ debit: 0, credit: 105, signedBalance: 8999999999999896 });
  await page.goto(`${general.baseURL}/m/ledgers/general?account=1001&from=202607&to=203507`);
  await expect(page.getByRole('row', { name: /2026年07月.*本月发生/ })).toContainText('1.05');
  await page.getByTitle('下一页', { exact: true }).click();
  await expect(page.getByRole('row', { name: /2035年07月.*本月发生/ })).toBeVisible();
  await page.getByRole('button', { name: '展开全部月份' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const file = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.rowCount).toBe(330);
  expect(sheet.getRow(3).getCell(8).value).toBe('90000000000000.01');
  expect(sheet.getRow(3).getCell(8).type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getRow(330).getCell(8).value).toBe('89999999999998.96');
});

test('w_zc_zc：坏科目查询可恢复；w_zc_zc_1只读权限由服务端强制', async ({ page, general }) => {
  const book = await loginWithNewBook(page, general.request, { startMonth: 7 });
  await general.withBook(book.bookId, async (svc) => {
    await seedGeneralBook(svc);
    await svc.users.create({
      code: 'generalviewer',
      name: '总账只读用户',
      password: 'viewer',
      permissions: ['ledgers.view'],
    });
  });
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    general.request,
    'core.auth.login',
    { bookId: book.bookId, userCode: 'generalviewer', password: 'viewer' },
  );
  await page.addInitScript(
    (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
    { token: login.token, bookId: book.bookId, user: login.user, book: login.book },
  );
  await page.goto(`${general.baseURL}/m/ledgers/general?account=BAD&from=202607&to=202608`);
  await expect(page.getByText('查询失败', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出 Excel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打印', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存显示格式' })).toHaveCount(0);
  for (const operation of ['export', 'print']) {
    const response = await general.request.get(
      `/trpc/m.ledgers.${operation}?input=${encodeURIComponent(JSON.stringify({ kind: 'general', periodFrom: 202607, periodTo: 202608, account: '1001', columns: ['date', 'balance'] }))}`,
      { headers: { 'x-caiwu-token': 'e2e-token', authorization: `Bearer ${login.token}` } },
    );
    expect(response.status()).toBe(403);
    expect(await response.text()).toContain('FORBIDDEN');
  }
  await page.goto(`${general.baseURL}/m/ledgers/general?account=1002&from=202607&to=202608`);
  await expect(page.getByRole('row', { name: /2026年07月.*本月发生/ })).toContainText('12.10');
  expect(
    new URL(
      (await page
        .getByRole('row', { name: /2026年07月.*本月发生/ })
        .getByRole('link')
        .getAttribute('href')) || '',
      general.baseURL,
    ).searchParams.get('account'),
  ).toBe('1002');
});
