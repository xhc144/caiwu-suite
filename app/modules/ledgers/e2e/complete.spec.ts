import { expect, test as base } from '@playwright/test';
import ExcelJS from 'exceljs';
import { parseCodeScheme } from '@caiwu/core';
import { seedVouchers } from '@caiwu/testkit';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedMultiBook } from '../test/multicolumn-seed';
import { seedLedgerBook } from '../test/seed';
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

test('w_zc_dlz_1/w_zc_fhdlz_1：自动分栏、自定义保存刷新、辅助对象分别成账', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request);
  await ledger.withBook(book.bookId, seedMultiBook);
  await page.goto(`${ledger.baseURL}/m/ledgers/multi?account=6601&from=202602&to=202602`);
  await expect(page.getByRole('heading', { name: '多栏账', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /660101 差旅费（借减贷）/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /660102 办公费（借减贷）/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /本月小计/ })).toContainText('7.70');
  await expect(page.getByRole('row', { name: /本月小计/ })).toContainText('3.40');
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('20.20');

  await page.getByRole('button', { name: '设置多栏栏目' }).click();
  const drawer = page.getByRole('dialog', { name: '设置多栏账栏目' });
  await drawer.getByRole('button', { name: '增加栏目' }).click();
  await drawer.getByRole('textbox', { name: '第1栏名称' }).fill('差旅支出');
  const account = drawer.getByRole('combobox', { name: '第1栏科目' });
  await account.fill('660101');
  await account.press('Enter');
  await account.press('Escape');
  const side = drawer.getByRole('combobox', { name: '第1栏方向' });
  await side.click();
  await side.press('ArrowUp');
  await side.press('ArrowUp');
  await side.press('Enter');
  await drawer.getByRole('button', { name: '确认保存栏目' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /差旅支出（借方）/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /其他未分栏科目（借减贷）/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /本月小计/ })).toContainText('3.90');
  expect(new URL(page.url()).searchParams.get('multiMode')).toBe('custom');
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /差旅支出（借方）/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('20.20');

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const download = await downloading;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.worksheets[0]!.getRow(2).values).toContain('差旅支出（借方）');
  expect(workbook.worksheets[0]!.getRow(workbook.worksheets[0]!.rowCount).values).toContain(
    '20.20',
  );

  await page.goto(
    `${ledger.baseURL}/m/ledgers/auxiliary-multi?account=6601&from=202602&to=202602&dimensionType=department`,
  );
  await expect(page.getByRole('heading', { name: '辅助多栏账', exact: true })).toBeVisible();
  const closing = page.getByRole('row', { name: /期末余额/ });
  await expect(closing).toHaveCount(3);
  await expect(closing.filter({ hasText: '未指定' })).toContainText('7.90');
  await expect(closing.filter({ hasText: '部门：01' })).toContainText('8.50');
  await expect(closing.filter({ hasText: '部门：02' })).toContainText('3.80');
});

test('w_zc_fhslz/w_zc_slz_sl/_fb/_slfb：辅助、数量、复币与数量复币完整账页', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request);
  await ledger.withBook(book.bookId, async (svc) => {
    await seedLedgerBook(svc);
    await svc.accounts.create(
      {
        code: '1499',
        name: '合成外币数量材料',
        categoryId: 'asset',
        currency: 'USD',
        quantityUnit: '件',
      },
      parseCodeScheme('4-2-2'),
    );
    await seedVouchers(svc, [
      {
        date: '2026-02-17',
        status: 'posted',
        summary: '数量复币材料入库',
        lines: [
          {
            account: '1499',
            debit: 14200,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 2000,
            quantity: '2.5',
            unitPrice: '56.8',
          },
          { account: '4001', credit: 14200 },
        ],
      },
    ]);
  });
  await page.goto(
    `${ledger.baseURL}/m/ledgers/auxiliary?account=1122&from=202602&to=202602&dimensionType=partner`,
  );
  await expect(page.getByRole('heading', { name: '辅助明细账', exact: true })).toBeVisible();
  const partners = page.getByRole('row', { name: /期末余额/ });
  await expect(partners).toHaveCount(2);
  await expect(partners.filter({ hasText: 'C001' })).toContainText('13.00');
  await expect(partners.filter({ hasText: 'S001' })).toContainText('2.00');

  await page.goto(`${ledger.baseURL}/m/ledgers/quantity?account=1403&from=202602&to=202602`);
  await expect(page.getByRole('heading', { name: '数量金额明细账', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^结余数量/ })).toBeVisible();
  const quantity = page.getByRole('row', { name: /期末余额/ });
  await expect(quantity).toContainText('123.45');
  await expect(quantity).toContainText('1.2345');
  await expect(quantity).toContainText('千克');
  await expect(page.getByRole('row', { name: /数量样本/ })).toContainText('100');

  await page.goto(
    `${ledger.baseURL}/m/ledgers/foreign?account=100202&from=202602&to=202602&currency=USD`,
  );
  await expect(page.getByRole('heading', { name: '复币明细账', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^原币余额/ })).toBeVisible();
  const foreign = page.getByRole('row', { name: /期末余额/ });
  await expect(foreign).toContainText('71.00');
  await expect(foreign).toContainText('10.00');
  await expect(page.getByRole('row', { name: /美元收款/ })).toContainText('7.1');

  await page.goto(
    `${ledger.baseURL}/m/ledgers/quantity-foreign?account=1499&from=202602&to=202602&currency=USD`,
  );
  await expect(page.getByRole('heading', { name: '数量复币明细账', exact: true })).toBeVisible();
  const combined = page.getByRole('row', { name: /期末余额/ });
  await expect(combined).toContainText('142.00');
  await expect(combined).toContainText('20.00');
  await expect(combined).toContainText('2.5');
  await expect(combined).toContainText('56.8');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await (await downloading).path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.getRow(2).values).toContain('原币余额');
  expect(sheet.getRow(2).values).toContain('结余数量');
  expect(sheet.getRow(sheet.rowCount).values).toEqual(
    expect.arrayContaining(['142.00', '20.00', '2.5', '56.8']),
  );
});

test('w_print_1/w_print_2_zw：连续打印承前过次、套打偏移、页序选择与真实打印桥', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request);
  await ledger.withBook(book.bookId, seedMultiBook);
  await page.goto(
    `${ledger.baseURL}/m/ledgers/auxiliary-multi?account=6601&from=202602&to=202602&dimensionType=department`,
  );
  await expect(page.getByRole('row', { name: /期末余额/ })).toHaveCount(3);
  await page.getByRole('button', { name: '连续打印与套打' }).click();
  const drawer = page.getByRole('dialog', { name: '连续打印与套打' });
  await drawer.getByRole('spinbutton', { name: '每页明细行数' }).fill('3');
  await drawer.getByRole('spinbutton', { name: '印刷起始页码' }).fill('7');
  await drawer.getByRole('textbox', { name: '输出页序号' }).fill('0');
  await drawer.getByRole('button', { name: '生成打印预览' }).click();
  await expect(drawer.getByText('预览未生成', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '打印已预览账页' })).toBeDisabled();

  await drawer.getByRole('textbox', { name: '输出页序号' }).fill('');
  await drawer.getByRole('button', { name: '生成打印预览' }).click();
  const preview = page.frameLocator('iframe[title="账簿打印预览"]');
  await expect(preview.locator('.print-sheet').first()).toBeVisible();
  await expect(preview.locator('footer').first()).toContainText('第 7 页');
  await expect(preview.locator('[data-carry="from"]').first()).toContainText('承前页（本期累计）');
  await expect(preview.locator('[data-carry="to"]').first()).toContainText('过次页（本期累计）');
  await expect(preview.locator('body')).toContainText('部门：未指定');
  await expect(preview.locator('body')).toContainText('部门：01');
  await expect(preview.locator('body')).toContainText('部门：02');
  await expect(preview.locator('body')).toContainText('附页');

  await drawer.getByRole('checkbox', { name: '仅打印数据（隐藏表头和边框）' }).check();
  await drawer.getByRole('spinbutton', { name: '水平偏移（毫米）' }).fill('1');
  await drawer.getByRole('spinbutton', { name: '垂直偏移（毫米）' }).fill('2');
  await drawer.getByRole('textbox', { name: '输出页序号' }).fill('2-3');
  await expect(drawer.getByRole('button', { name: '打印已预览账页' })).toBeDisabled();
  await drawer.getByRole('button', { name: '生成打印预览' }).click();
  await expect(preview.locator('.print-sheet')).toHaveCount(2);
  await expect(preview.locator('footer').first()).toContainText('第 8 页');
  await expect(preview.locator('footer').last()).toContainText('第 9 页');
  await expect(preview.locator('thead').first()).toBeHidden();
  const source = await page.getByTitle('账簿打印预览').getAttribute('srcdoc');
  expect(source).toContain('left:1mm;top:2mm');
  expect(source).toContain('border-color:transparent');
  const overflow = await preview.locator('th,td,.single-line,footer').evaluateAll((cells) =>
    cells
      .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
      .map((cell) => ({
        tag: cell.tagName,
        text: cell.textContent,
        width: cell.clientWidth,
        scroll: cell.scrollWidth,
      })),
  );
  expect(overflow).toEqual([]);
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.completeLedgerPrint = html;
      },
      printToPdf: async () => null,
    };
  });
  await drawer.getByRole('button', { name: '打印已预览账页' }).click();
  await expect
    .poll(() => page.locator('body').getAttribute('data-complete-ledger-print'))
    .toContain('第 8 页');
  const printed = await page.locator('body').getAttribute('data-complete-ledger-print');
  expect(printed).toContain("default-src 'none'");
  expect(printed).toContain('data-page="2"');
  expect(printed).toContain('data-page="3"');
  expect(printed).not.toContain('data-page="1"');
  expect(printed?.match(/class="print-sheet"/g)).toHaveLength(2);
});

test('w_zc_dlz_1：其他窗口保存后焦点刷新保留栏目草稿，陈旧版本保存失败不丢输入', async ({
  page,
  ledger,
}) => {
  const book = await loginWithNewBook(page, ledger.request);
  await ledger.withBook(book.bookId, seedMultiBook);
  await page.goto(`${ledger.baseURL}/m/ledgers/multi?account=6601&from=202602&to=202602`);
  await expect(page.getByRole('row', { name: /期末余额/ })).toContainText('20.20');
  await page.getByRole('button', { name: '设置多栏栏目' }).click();
  const drawer = page.getByRole('dialog', { name: '设置多栏账栏目' });
  await drawer.getByRole('button', { name: '增加栏目' }).click();
  const draft = drawer.getByRole('textbox', { name: '第1栏名称' });
  await draft.fill('尚未保存的差旅草稿');
  const account = drawer.getByRole('combobox', { name: '第1栏科目' });
  await account.fill('660101');
  await account.press('Enter');
  await account.press('Escape');
  await callApi(
    ledger.request,
    'm.ledgers.saveMultiFormat',
    {
      kind: 'multi',
      account: '6601',
      expectedRevision: 0,
      confirmed: true,
      columns: [
        { id: 'other_window', label: '另一个窗口的办公费', accountCodes: ['660102'], side: 'net' },
      ],
    },
    { token: book.token },
  );
  const reloaded = page.waitForResponse(
    (response) =>
      response.url().includes('m.ledgers.multiFormat') && response.request().method() === 'GET',
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await (await reloaded).text()).toContain('other_window');
  await expect(draft).toHaveValue('尚未保存的差旅草稿');
  await drawer.getByRole('button', { name: '确认保存栏目' }).click();
  await expect(drawer.getByText('栏目未保存', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/已被其他窗口修改/)).toBeVisible();
  await expect(draft).toHaveValue('尚未保存的差旅草稿');
  await expect(drawer.getByText('660101 销售费用/差旅费', { exact: true })).toBeVisible();
});
