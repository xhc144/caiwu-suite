import { expect, test as base } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { formatMoney, type BalanceRow } from '@caiwu/core';
import { startLedgerEnvironment, type LedgerEnvironment } from './fixture';

const test = base.extend<{ ledger: LedgerEnvironment }>({
  ledger: async ({ browser: _browser }, use) => {
    const environment = await startLedgerEnvironment();
    try {
      await use(environment);
    } finally {
      await environment.close();
    }
  },
});

test('w_zc_slz_1：真实账套期初/借贷/期末、未过账、刷新、xlsx与凭证穿透', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request, { product: 'chengben' });
  await ledger.seed(book.bookId);
  const q = { periodFrom: 202602, periodTo: 202602, accountCodes: ['1001'], rollup: false };
  const balances = await callApi<BalanceRow[]>(ledger.request, 'core.ledger.balances', q, {
    token: book.token,
  });
  expect(balances[0]).toMatchObject({ opening: 60000, debit: 2600, credit: 1000, closing: 61600 });
  await page.goto(
    `${ledger.baseURL}/m/ledgers/detail?account=1001&from=202602&to=202602&dims=%7B%7D`,
  );
  await expect(page.getByRole('heading', { name: '三栏明细账' })).toBeVisible();
  const opening = page.getByRole('row', { name: /期初余额/ });
  const closing = page.getByRole('row', { name: /期末余额/ });
  await expect(opening).toContainText(formatMoney(balances[0]!.opening));
  await expect(closing).toContainText(formatMoney(balances[0]!.closing));
  const monthly = page.getByRole('row', { name: /本月小计/ });
  await expect(monthly).toContainText('26.00');
  await expect(monthly).toContainText('10.00');
  await expect(page.getByRole('row', { name: /红字收款/ })).toContainText('-2.00');
  await expect(
    page.getByRole('row', { name: /草稿不计入|作废不计入|待审核付款|已审核收款/ }),
  ).toHaveCount(0);
  await page.getByRole('checkbox', { name: '包含未过账凭证' }).check();
  await page.getByRole('button', { name: /查询$/ }).click();
  await expect(closing).toContainText('617.00');
  expect(new URL(page.url()).searchParams.get('account')).toBe('1001');
  expect(new URL(page.url()).searchParams.get('from')).toBe('202602');
  const unposted = await callApi<BalanceRow[]>(
    ledger.request,
    'core.ledger.balances',
    { ...q, includeUnposted: true },
    { token: book.token },
  );
  await expect(closing).toContainText(formatMoney(unposted[0]!.closing));
  await expect(page.getByRole('row', { name: /待审核付款/ })).toHaveCount(1);
  await expect(page.getByRole('row', { name: /草稿不计入|作废不计入/ })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('includeUnposted')).toBe('1');
  await page.reload();
  await expect(closing).toContainText('617.00');
  await expect(page.getByRole('checkbox', { name: '包含未过账凭证' })).toBeChecked();
  for (let i = 0; i < 2; i++) {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel' }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile((await download.path())!);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.rowCount).toBeGreaterThan(8);
    expect(sheet.getRow(2).values).toContain('余额');
    expect(sheet.getRow(sheet.rowCount).values).toContain('617.00');
    expect(sheet.getRow(1).values.toString()).toContain('包含未过账');
  }
  await page.getByRole('row', { name: /本月收款/ }).dblclick();
  await expect(page).toHaveURL(/\/m\/voucher-entry\/edit\?id=\d+$/);
});

test('w_zc_xjrjz_1/w_zc_yhrjz_1：日记账日月小计、USD筛选和打印内容', async ({ page, ledger }) => {
  const book = await loginWithNewBook(page, ledger.request, { product: 'chengben' });
  await ledger.seed(book.bookId);
  await page.goto(`${ledger.baseURL}/m/ledgers/cash?from=202602&to=202602&account=1001`);
  await expect(page.getByRole('heading', { name: '现金日记账' })).toBeVisible();
  await expect(page.getByRole('row', { name: /2026-02-03.*本日小计/ })).toContainText('615.00');
  await expect(page.getByRole('columnheader', { name: /^收入/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^付出/ })).toBeVisible();
  // 仅捕获打印桥的真实 HTML，查询和金额服务不 mock。
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.printedLedger = html;
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect
    .poll(() => page.locator('body').getAttribute('data-printed-ledger'))
    .toContain('本日小计');
  expect(await page.locator('body').getAttribute('data-printed-ledger')).toContain('616.00');
  await page.goto(
    `${ledger.baseURL}/m/ledgers/bank?from=202602&to=202602&account=1002&currency=USD`,
  );
  await expect(page.getByRole('heading', { name: '银行日记账' })).toBeVisible();
  await expect(page.getByRole('row', { name: /美元收款/ })).toContainText('71.00');
  await expect(page.getByRole('row', { name: /银行付款/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('71.00');
});

test('w_zc_slz_1：坏dims恢复、空打印不启动、格式取消/保存/恢复取消和刷新', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request, { product: 'chengben' });
  await page.goto(`${ledger.baseURL}/m/ledgers/detail?dims=broken`);
  await expect(page.getByText('筛选条件无效', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await expect(page.getByText('当前筛选没有账簿记录，请调整期间或科目范围')).toBeVisible();
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async () => {
        document.body.dataset.unexpectedPrint = '1';
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect(
    page.getByText('当前筛选没有账簿记录，不能导出或打印', { exact: true }),
  ).toBeVisible();
  expect(await page.locator('body').getAttribute('data-unexpected-print')).toBeNull();
  expect(await page.locator('iframe').count()).toBe(0);
  await ledger.seed(book.bookId);
  await page.goto(`${ledger.baseURL}/m/ledgers/detail?account=1001&from=202602&to=202602`);
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('616.00');
  await page.getByRole('button', { name: '保存显示格式' }).click();
  const drawer = page.getByRole('dialog', { name: '保存账簿显示格式' });
  await drawer.getByRole('checkbox', { name: '凭证状态', exact: true }).uncheck();
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /^凭证状态/ })).toBeVisible();
  await page.getByRole('button', { name: '保存显示格式' }).click();
  await drawer.getByRole('checkbox', { name: '凭证状态', exact: true }).uncheck();
  await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /^凭证状态/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /^凭证状态/ })).toHaveCount(0);
  await page.getByRole('button', { name: '恢复标准格式' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /^凭证状态/ })).toHaveCount(0);
  await page.getByRole('button', { name: '恢复标准格式' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /^凭证状态/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('616.00');
});
