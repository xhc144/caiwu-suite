import { expect, test as base } from '@playwright/test';
import ExcelJS from 'exceljs';
import { seedVouchers } from '@caiwu/testkit';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { VatMapping } from '../vat-shared';
import { startGeneralEnvironment, type GeneralEnvironment } from './general-fixture';

const test = base.extend<{ ledger: GeneralEnvironment }>({
  ledger: async ({ browser: _browser }, use) => {
    const environment = await startGeneralEnvironment();
    try {
      await use(environment);
    } finally {
      await environment.close();
    }
  },
});

test('w_xt_tz_zc_zzsmxz/w_zc_zzs：设置科目、真实取数、保存冲突保留草稿、Excel及打印', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request);
  await ledger.withBook(book.bookId, async (svc) => {
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require('22210101')).id,
      balance: 1000,
    });
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require('22210102')).id,
      balance: -2000,
    });
    await seedVouchers(svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        summary: '合成进项税额',
        lines: [
          { account: '22210101', debit: 500 },
          { account: '4001', credit: 500 },
        ],
      },
      {
        date: '2026-02-02',
        status: 'posted',
        summary: '合成销项税额',
        lines: [
          { account: '22210102', credit: 800 },
          { account: '4001', debit: 800 },
        ],
      },
    ]);
  });
  await page.goto(`${ledger.baseURL}/m/ledgers/vat?from=202602&to=202602`);
  await expect(page.getByRole('heading', { name: '增值税明细账', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('tabpanel', { name: '增值税明细账', exact: true })
      .getByText('尚未设置增值税明细账的对应科目', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '增值税明细账设置', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '增值税明细账设置', exact: true });
  await drawer.getByRole('button', { name: '增加借方栏目' }).click();
  await drawer.getByRole('textbox', { name: '第1栏名称' }).fill('合成进项分类');
  const input = drawer.getByRole('combobox', { name: '第1栏对应科目' });
  await input.fill('22210101');
  await input.press('Enter');
  await input.press('Escape');
  await drawer.getByRole('button', { name: '增加贷方栏目' }).click();
  await drawer.getByRole('textbox', { name: '第2栏名称' }).fill('合成销项分类');
  const output = drawer.getByRole('combobox', { name: '第2栏对应科目' });
  await output.fill('22210102');
  await output.press('Enter');
  await output.press('Escape');
  await drawer.getByRole('button', { name: '确认保存对应关系' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /借方·合成进项分类/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /贷方·合成销项分类/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /期初余额/ })).toContainText('10.00');
  await expect(page.getByRole('row', { name: /本月小计/ })).toContainText('5.00');
  await expect(page.getByRole('row', { name: /本月小计/ })).toContainText('8.00');
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('13.00');
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /借方·合成进项分类/ })).toBeVisible();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloading;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.getRow(2).values).toContain('借方·合成进项分类');
  expect(sheet.getRow(sheet.rowCount).values).toContain('13.00');
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.vatPrint = html;
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect
    .poll(() => page.locator('body').getAttribute('data-vat-print'))
    .toContain('合成进项分类');
  expect(await page.locator('body').getAttribute('data-vat-print')).toContain('13.00');

  // 另一窗口正式保存后，本窗口的提交应被拒绝，且保留已输入的草稿。
  await page.getByRole('button', { name: '增值税明细账设置', exact: true }).click();
  await drawer.getByRole('textbox', { name: '第1栏名称' }).fill('当前窗口未保存分类');
  const mapping = await callApi<VatMapping>(ledger.request, 'm.ledgers.vat.mapping', undefined, {
    token: book.token,
    method: 'GET',
  });
  await callApi(
    ledger.request,
    'm.ledgers.vat.saveMapping',
    {
      columns: mapping.columns.map((column, index) =>
        index === 0 ? { ...column, label: '其他窗口已保存分类' } : column,
      ),
      expectedRevision: mapping.revision,
      confirmed: true,
    },
    { token: book.token, method: 'POST' },
  );
  await drawer.getByRole('button', { name: '确认保存对应关系' }).click();
  await expect(drawer.getByText('设置未保存，当前内容已保留', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('textbox', { name: '第1栏名称' })).toHaveValue(
    '当前窗口未保存分类',
  );
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await page
    .getByRole('dialog', { name: '放弃未保存的对应关系修改？' })
    .getByRole('button', { name: '放弃修改', exact: true })
    .click();
  await expect(drawer).toHaveCount(0);
});
