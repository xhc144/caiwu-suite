import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import ExcelJS from 'exceljs';
import { test, expect } from './fixture';

test('w_fx_1 季度定基真实分析、Excel与打印；上年缺来源保持未知、结构显式基数', async ({
  page,
  isolated,
}) => {
  const book = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(book.bookId, async (svc) => {
    await seedVouchers(
      svc,
      Array.from({ length: 6 }, (_, month) => ({
        date: `2026-${String(month + 1).padStart(2, '0')}-10`,
        status: 'posted' as const,
        lines: [
          { account: '1122', debit: (month + 1) * 10001, dims: { partner: 'C001' } },
          { account: '6001', credit: (month + 1) * 10001 },
        ],
      })),
    );
  });
  await callApi(
    isolated.request,
    'm.analysis.definitions.save',
    {
      code: '101',
      name: '季度应收分析',
      expectedRevision: 0,
      rows: [
        { key: 1, name: '应收发生', formula: '借方("1122")', unit: 'money' },
        { key: 2, name: '发生基数', formula: '项目(1) * 2', unit: 'money', subtotal: true },
      ],
    },
    { token: book.token },
  );
  await page.goto(`${isolated.origin}/m/analysis/methods`);
  await expect(page.getByRole('heading', { name: '结构、比较与趋势分析' })).toBeVisible();
  const setSelect = async (name: string, text: string) => {
    await page.getByRole('combobox', { name, exact: true }).click();
    await page.locator('.ant-select-dropdown:visible').getByText(text, { exact: true }).click();
  };
  await setSelect('结束期间', '2026年06月');
  await setSelect('趋势间隔', '季');
  await setSelect('趋势比较方式', '定基比较');
  await setSelect('区间取数', '逐月合计（发生额）');
  await page.getByRole('button', { name: '开始方法分析', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: '应收发生' });
  await expect(row).toContainText('600.06');
  await expect(row).toContainText('1500.15');
  await expect(row).toContainText('250.00%');
  // ECharts 初始化后会用实际图表数据覆盖容器的 aria-label。
  const chart = page
    .getByRole('figure')
    .getByRole('img', { name: /图表类型是折线图/ })
    .first();
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('aria-label', /2026年第1季.*100.*2026年第2季.*250/);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '重新取数并导出 Excel' }).click();
  const download = await downloading;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.worksheets[0]!.getRow(4).values).toEqual(
    expect.arrayContaining(['600.06', '1500.15', '250.00']),
  );
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.comparisonPrint = html;
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '打印当前方法结果' }).click();
  await expect
    .poll(() => page.locator('body').getAttribute('data-comparison-print'))
    .toContain('1500.15');
  await setSelect('分析方法', '比较分析');
  await page.getByRole('button', { name: '开始方法分析', exact: true }).click();
  await expect(row).toContainText('未知');
  await expect(row).toContainText('基期或报告期早于账套启用期间');
  await expect(row).toContainText('600.06');
  await setSelect('分析方法', '结构分析');
  await setSelect('结构分析基数项目', '2 发生基数（元）');
  await page.getByRole('button', { name: '开始方法分析', exact: true }).click();
  await expect(row).toContainText('50.00%');
  await expect(row).toContainText('600.06');
});
