import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Report, ReportSnapshot } from '../../shared';
import { test } from './fixture';

test('w_bb_get小企业303真实JSON引入→二月生成→刷新→xlsx；银行转存不重复计入', async ({
  page,
  isolatedSmall,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolatedSmall.request);
  await isolatedSmall.seed(bookId);
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine`);
  await page
    .getByLabel('引入JSON模板')
    .setInputFiles(
      fileURLToPath(new URL('../../templates/small-business/303-monthly.json', import.meta.url)),
    );
  await expect(
    page.getByRole('cell', {
      name: '小企业现金流量表（月报取数试算，未完成） 只读模板',
      exact: true,
    }),
  ).toBeVisible();
  const reports = await callApi<Report[]>(
    isolatedSmall.request,
    'm.report-engine.list',
    {},
    { token },
  );
  const r = reports.find((r) => r.template.code === '303')!;
  expect(r.template.readOnly).toBe(true);
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine/view?id=${r.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  // 独立手算：年销售140001、月销售20000；年初100000、月初190000、期末205699分。
  for (const [address, cents] of [
    ['C6', '140001'],
    ['D6', '20000'],
    ['D15', '-301'],
    ['C26', '100000'],
    ['D26', '190000'],
    ['C27', '205699'],
    ['D27', '205699'],
  ])
    await expect(page.getByTestId(`result-${address}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      cents!,
    );
  await expect(page.getByTestId('result-A2')).toContainText('尚未完成完整法定报表');
  const s = await callApi<ReportSnapshot>(
    isolatedSmall.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202602 },
    { token, method: 'GET' },
  );
  expect(s.checks.every((c) => c.status === 'pass')).toBe(true);
  await page.reload();
  await expect(page.getByTestId('result-C27').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '205699',
  );
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const download = await waiting;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await download.path())!);
  expect(wb.worksheets[0]!.getCell('C27').value).toBe(2056.99);
  expect(wb.worksheets[0]!.getCell('D15').value).toBe(-3.01);
  expect(wb.worksheets[0]!.getCell('A1').value).toContain('未完成');
  expect(wb.worksheets[1]!.getCell('B3').value).toBe('仅已过账');
});

test('w_bb_get小企业302年报表样保留上年列和缺项，页面与导出均不冒充已取数', async ({
  page,
  isolatedSmall,
}) => {
  const { token } = await loginWithNewBook(page, isolatedSmall.request);
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine`);
  await page
    .getByLabel('引入JSON模板')
    .setInputFiles(
      fileURLToPath(new URL('../../templates/small-business/302-annual.json', import.meta.url)),
    );
  await expect(
    page.getByRole('cell', { name: '小企业利润表（年报表样，取数未实现） 只读模板', exact: true }),
  ).toBeVisible();
  const reports = await callApi<Report[]>(
    isolatedSmall.request,
    'm.report-engine.list',
    {},
    { token },
  );
  const r = reports.find((r) => r.template.code === '302')!;
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine/view?id=${r.id}&period=202612`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-D5')).toContainText('上年金额');
  await expect(page.getByTestId('result-C6')).toContainText('未实现：需排除损益结转并保留冲减');
  await expect(page.getByTestId('result-D6')).toContainText('未实现：需上年全年');
  await expect(page.getByTestId('result-C6').locator('[data-cents]')).toHaveCount(0);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await waiting).path())!);
  expect(wb.worksheets[0]!.getCell('D5').value).toBe('上年金额');
  expect(wb.worksheets[0]!.getCell('C6').value).toContain('未实现');
});
