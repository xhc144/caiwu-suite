import { expect, test as base } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { startGeneralEnvironment, type GeneralEnvironment } from './general-fixture';
import { seedMultiBook } from '../test/multicolumn-seed';

const test = base.extend<{ ledger: GeneralEnvironment }>({
  ledger: async ({ browser: _browser }, use) => {
    const ledger = await startGeneralEnvironment();
    try {
      await use(ledger);
    } finally {
      await ledger.close();
    }
  },
});

test('w_zc_dlz/_1：真实三级分栏、红字、重新查询、未过账、下载及金额钻取', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  const seed = await ledger.withBook(book.bookId, seedMultiBook);
  await page.goto(
    `${ledger.baseURL}/m/ledgers/multicolumn?account=4999&from=202607&to=202608&mode=net`,
  );
  await expect(page.getByRole('heading', { name: '多栏账' })).toBeVisible();
  const month = page.getByRole('row', { name: /2026年07月.*本月小计/ });
  await expect(month).toContainText('58.00');
  await expect(month.getByRole('cell').nth(8)).toContainText('-13.00');
  await expect(month.getByRole('cell').nth(9)).toContainText('1.00');
  await expect(page.getByRole('columnheader', { name: /499903/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /2026-07-03/ })).toContainText('-3.00');
  expect(
    await page
      .getByRole('row', { name: /2026-07-01/ })
      .getByRole('link', { name: /记-/ })
      .getAttribute('href'),
  ).toBe(`/m/voucher-entry/edit?id=${seed.voucherId}`);
  await page.getByRole('checkbox', { name: '含没有数据的科目' }).check();
  await page.getByRole('checkbox', { name: '包含未过账凭证' }).check();
  await page.getByRole('combobox', { name: /分栏取数/ }).click();
  await page
    .locator('.ant-select-item-option-content')
    .getByText('贷方发生额', { exact: true })
    .click();
  await page.getByRole('button', { name: /查询$/ }).click();
  await expect(month.getByRole('cell').nth(8)).toContainText('22.00');
  await expect(month.getByRole('cell').nth(9)).toContainText('-1.00');
  await expect(page.getByRole('columnheader', { name: /499903/ })).toBeVisible();
  await expect(month).toContainText('61.00');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '包含未过账凭证' })).toBeChecked();
  await expect(month.getByRole('cell').nth(8)).toContainText('22.00');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const file = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.columnCount).toBe(11);
  let found = false;
  sheet.eachRow((r) => {
    if (r.getCell(1).value === '2026年07月' && r.getCell(2).value === '本月小计') {
      expect(r.getCell(9).value).toBe('22.00');
      expect(r.getCell(10).value).toBe('-1.00');
      expect(r.getCell(11).value).toBe('0.00');
      found = true;
    }
  });
  expect(found).toBe(true);
  await month.getByRole('cell').nth(8).getByRole('link').click();
  await expect(page).toHaveURL(/\/m\/ledgers\/detail\?.*account=499901.*includeUnposted=1/);
  await expect(page.getByRole('heading', { name: '三栏明细账' })).toBeVisible();
  await expect(page.getByRole('row', { name: /2026-07-03/ })).toContainText('-3.00');
  await page.goto(
    `${ledger.baseURL}/m/ledgers/multicolumn?account=4999&from=202608&to=202608&mode=net`,
  );
  const ytdLink = page
    .getByRole('row', { name: /本年累计/ })
    .getByRole('cell')
    .nth(8)
    .getByRole('link');
  expect(await ytdLink.getAttribute('href')).toContain('from=202607');
});

test('w_zc_dlz：末级拒绝、启用前留空、只读用户及导出403', async ({ page, ledger }) => {
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  await ledger.withBook(book.bookId, async (svc) => {
    await seedMultiBook(svc);
    await svc.users.create({
      code: 'multiviewer',
      name: '多栏只读',
      password: 'viewer',
      permissions: ['ledgers.view'],
    });
  });
  await page.goto(`${ledger.baseURL}/m/ledgers/multicolumn?account=49990101&from=202607&to=202607`);
  await expect(
    page
      .getByRole('tabpanel', { name: '多栏账' })
      .getByText('所选科目是末级科目，不能生成多栏账', { exact: true }),
  ).toBeVisible();
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    ledger.request,
    'core.auth.login',
    { bookId: book.bookId, userCode: 'multiviewer', password: 'viewer' },
  );
  await page.addInitScript((s) => sessionStorage.setItem('caiwu.session', JSON.stringify(s)), {
    token: login.token,
    bookId: book.bookId,
    user: login.user,
    book: login.book,
  });
  await page.goto(
    `${ledger.baseURL}/m/ledgers/multicolumn?account=4999&from=202606&to=202607&mode=net`,
  );
  const unknown = page.getByRole('row', { name: /启用前（月额及余额未知）/ });
  await expect(unknown).toBeVisible();
  expect((await unknown.getByRole('cell').nth(8).textContent())!.trim()).toBe('');
  await expect(page.getByRole('button', { name: '导出 Excel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打印', exact: true })).toHaveCount(0);
  const response = await ledger.request.get(
    `/trpc/m.ledgers.multiExport?input=${encodeURIComponent(JSON.stringify({ account: '4999', periodFrom: 202607, periodTo: 202607 }))}`,
    { headers: { 'x-caiwu-token': 'e2e-token', authorization: `Bearer ${login.token}` } },
  );
  expect(response.status()).toBe(403);
  expect(await response.text()).toContain('FORBIDDEN');
});

test('w_zc_dlz_1：105笔分页及大金额Excel保持完整整分', async ({ page, ledger }) => {
  test.setTimeout(60000);
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  await ledger.withBook(book.bookId, async (svc) => {
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require('100201')).id,
      balance: 9000000000000001,
    });
    await seedVouchers(
      svc,
      Array.from({ length: 105 }, () => ({
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '100201', credit: 1 },
          { account: '4001', debit: 1 },
        ],
      })),
    );
  });
  await page.goto(
    `${ledger.baseURL}/m/ledgers/multicolumn?account=1002&from=202607&to=202607&mode=credit`,
  );
  await expect(page.getByRole('row', { name: /本月小计/ })).toHaveCount(0);
  await page.getByTitle('下一页', { exact: true }).click();
  await expect(
    page
      .getByRole('row', { name: /本月小计/ })
      .getByRole('cell')
      .nth(8),
  ).toContainText('1.05');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const file = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.rowCount).toBe(111);
  expect(sheet.getRow(3).getCell(8).value).toBe('90000000000000.01');
  expect(sheet.getRow(111).getCell(8).value).toBe('89999999999998.96');
  expect(sheet.getRow(111).getCell(8).type).toBe(ExcelJS.ValueType.String);
});

test('w_zc_dlz：不支持参数URL经两种重置入口清除后可重新选择科目正常查询', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  await ledger.withBook(book.bookId, seedMultiBook);
  for (const button of ['重置筛选', '重置']) {
    const unsupported = new URLSearchParams({
      currency: 'USD',
      dims: '{"partner":1}',
      accountTo: '499902',
    });
    await page.goto(
      `${ledger.baseURL}/m/ledgers/multicolumn?account=4999&from=202607&to=202607&mode=net&${unsupported}`,
    );
    const panel = page.getByRole('tabpanel', { name: '多栏账' });
    await expect(panel.getByText('筛选条件无效', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: button, exact: true }).click();
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return ['currency', 'dims', 'accountTo'].filter((key) => params.has(key));
      })
      .toEqual([]);
    await expect(
      panel.getByText('请选择含下级科目的上级科目后查询', { exact: true }),
    ).toBeVisible();
    const account = panel.getByRole('combobox', { name: /上级科目/ });
    await account.fill('4999');
    await account.press('Enter');
    await panel.getByRole('button', { name: /查询$/ }).click();
    await expect(panel.getByRole('row', { name: /本月小计/ })).toContainText('58.00');
    await expect(panel.getByText('筛选条件无效', { exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('account')).toBe('4999');
    await page.reload();
    await expect(page.getByRole('row', { name: /本月小计/ })).toContainText('58.00');
    for (const key of ['currency', 'dims', 'accountTo'])
      expect(new URL(page.url()).searchParams.has(key)).toBe(false);
  }
});
