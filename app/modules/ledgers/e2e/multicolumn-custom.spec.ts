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

test('w_zc_dlz_1：已保存的自定义格式仍保留空记录阻止，明确含无数据后才生成零账页', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  await callApi(
    ledger.request,
    'm.ledgers.saveMultiFormat',
    {
      account: '1002',
      columns: [{ name: '合成空栏目', accountCodes: ['100201'], mode: 'debit' }],
      expectedRevision: 0,
      confirmed: true,
    },
    { token: book.token },
  );
  await page.goto(`${ledger.baseURL}/m/ledgers/multicolumn?account=1002&from=202607&to=202607`);
  await expect(page.getByRole('columnheader', { name: /合成空栏目/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /期初余额|本月小计|期末余额/ })).toHaveCount(0);
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  await expect(
    page.getByText('当前条件没有多栏账记录，不能导出', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '含没有数据的科目' }).check();
  await page.getByRole('button', { name: /查询$/ }).click();
  await expect(page.getByRole('row', { name: /本月小计/ })).toContainText('0.00');
});

test('w_zc_dlz_1：自定义栏目应用、确认保存、重新打开、取消与恢复及真实Excel', async ({
  page,
  ledger,
}) => {
  test.setTimeout(60000);
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  await ledger.withBook(book.bookId, seedMultiBook);
  const url = `${ledger.baseURL}/m/ledgers/multicolumn?account=4999&from=202607&to=202607&mode=net`;
  await page.goto(url);
  await page.getByRole('button', { name: '自定义栏目', exact: true }).click();
  await page.getByRole('textbox', { name: /第1栏名称$/ }).fill('第一自定义净额');
  await page.getByRole('textbox', { name: /第2栏名称$/ }).fill('第二自定义贷方');
  await page.getByRole('combobox', { name: /第2栏取数方向$/ }).click();
  await page
    .locator('.ant-select-item-option-content')
    .getByText('贷方发生额', { exact: true })
    .click();
  await page.getByRole('button', { name: '应用到当前查询', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /第一自定义净额/ })).toBeVisible();
  const month = page.getByRole('row', { name: /本月小计/ });
  await expect(month.getByRole('cell').nth(8)).toContainText('-13.00');
  await expect(month.getByRole('cell').nth(9)).toContainText('-1.00');
  expect(new URL(page.url()).searchParams.has('columns')).toBe(false);
  await page.getByRole('button', { name: '自定义栏目', exact: true }).click();
  await page.getByRole('button', { name: '确认保存到账套', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /第一自定义净额/ })).toBeVisible();
  await expect(month.getByRole('cell').nth(9)).toContainText('-1.00');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const file = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.getRow(2).getCell(10).value).toContain('第二自定义贷方（贷方发生额）');
  const cells = sheet.getRows(3, sheet.rowCount - 2)!;
  expect(cells.find((r) => r.getCell(2).value === '本月小计')!.getCell(10).value).toBe('-1.00');
  await page.getByRole('button', { name: '恢复标准格式', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /第一自定义净额/ })).toBeVisible();
  await page.getByRole('button', { name: '恢复标准格式', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /第一自定义净额/ })).toHaveCount(0);
  await page.reload();
  await expect(month.getByRole('cell').nth(9)).toContainText('1.00');
});

test('w_zc_fhdlz：真实部门筛选入口，期初/逐笔/累计同口径并携带条件穿透', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  await ledger.withBook(book.bookId, async (svc) => {
    const { codeScheme } = await svc.book.info();
    for (const code of ['4999', '499901', '499902'])
      await svc.accounts.create(
        {
          code,
          name: `合成部门科目${code}`,
          categoryId: 'equity',
          dimensions: [{ type: 'department' }],
        },
        codeScheme,
      );
    const d = (await svc.dimensions.getByCode('department', '01'))!;
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require('499901')).id,
      balance: 1000,
      ytdDebit: 200,
      dimensions: { department: d.id },
    });
    await seedVouchers(svc, [
      {
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '499901', debit: 101, dims: { department: '01' } },
          { account: '4001', credit: 101 },
        ],
      },
      {
        date: '2026-07-02',
        status: 'posted',
        lines: [
          { account: '499902', debit: 900, dims: { department: '02' } },
          { account: '4001', credit: 900 },
        ],
      },
    ]);
  });
  await page.goto(
    `${ledger.baseURL}/m/ledgers/aux-multicolumn?account=4999&from=202607&to=202607&mode=net`,
  );
  await expect(page.getByRole('heading', { name: '辅助多栏明细账' })).toBeVisible();
  const department = page.getByRole('combobox', { name: /部门/ });
  await department.fill('01');
  await department.press('Enter');
  await page.getByRole('button', { name: /查询$/ }).click();
  const month = page.getByRole('row', { name: /本月小计/ });
  await expect(month).toContainText('11.01');
  await expect(page.getByRole('row', { name: /2026-07-02/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /本年累计/ })).toContainText('3.01');
  await page.reload();
  await expect(month).toContainText('11.01');
  await month.getByRole('cell').nth(8).getByRole('link').click();
  const params = new URL(page.url()).searchParams;
  expect(params.get('account')).toBe('499901');
  expect(JSON.parse(params.get('dims')!).department).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: '三栏明细账' })).toBeVisible();
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('11.01');
});

test('w_zc_dlz_1：248个自定义栏经真实POST查询及导出，第249栏被服务端拒绝', async ({
  page,
  ledger,
}) => {
  test.setTimeout(60000);
  const book = await loginWithNewBook(page, ledger.request, { startMonth: 7 });
  await ledger.withBook(book.bookId, seedMultiBook);
  const columns = Array.from({ length: 248 }, (_, i) => ({
    name: `合成第${i + 1}栏`,
    accountCodes: ['499901'],
    mode: 'net',
  }));
  await callApi(
    ledger.request,
    'm.ledgers.saveMultiFormat',
    { account: '4999', columns, expectedRevision: 0, confirmed: true },
    { token: book.token },
  );
  await page.goto(`${ledger.baseURL}/m/ledgers/multicolumn?account=4999&from=202607&to=202607`);
  await expect(page.getByRole('columnheader', { name: /合成第1栏/ })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const file = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await file.path())!);
  expect(workbook.worksheets[0]!.columnCount).toBe(256);
  columns.push({ name: '第249栏', accountCodes: ['499902'], mode: 'net' });
  const result = await ledger.request.post('/trpc/m.ledgers.multiExportFile', {
    headers: { 'x-caiwu-token': 'e2e-token', authorization: `Bearer ${book.token}` },
    data: { account: '4999', periodFrom: 202607, periodTo: 202607, columns },
  });
  expect(result.ok()).toBe(false);
  expect(await result.text()).toContain('248');
});
