import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import type { Report, ReportSnapshot } from '../../shared';
import {
  seedInventoryBook,
  storeInventoryYearOpening,
} from '../../test/small-business/inventory-fixture';
import { loginSmallBook, test } from './fixture';

const inventoryFile = fileURLToPath(
  new URL('../../templates/small-business/301.json', import.meta.url),
);

test('w_bb_get小企业301独立存货黄金账套：JSON引入、跨月生成、年结、刷新及xlsx四格读回', async ({
  page,
  isolatedSmall,
}) => {
  const { bookId, token } = await loginSmallBook(page, isolatedSmall.request);
  await isolatedSmall.withCore(bookId, seedInventoryBook);
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine`);
  await page.getByLabel('引入JSON模板').setInputFiles(inventoryFile);
  await expect(
    page.getByRole('cell', {
      name: '小企业资产负债表（部分取数，未完成） 只读模板',
      exact: true,
    }),
  ).toBeVisible();
  const reports = await callApi<Report[]>(
    isolatedSmall.request,
    'm.report-engine.list',
    {},
    { token },
  );
  const r = reports.find((report) => report.template.code === '301')!;
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine/view?id=${r.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  // 一月28702/9898；二月28688/9197；两月的年度期初均为27588/8890分。
  for (const [address, amount] of [
    ['C14', '28702'],
    ['D14', '27588'],
    ['C16', '9898'],
    ['D16', '8890'],
  ] as const)
    await expect(page.getByTestId(`result-${address}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      amount,
    );
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine/view?id=${r.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  const expected = [
    ['C14', '28688'],
    ['D14', '27588'],
    ['C15', '2788'],
    ['D15', '3115'],
    ['C16', '9197'],
    ['D16', '8890'],
    ['C17', '14042'],
    ['D17', '13341'],
    ['C18', '860'],
    ['D18', '1009'],
  ] as const;
  for (const [address, amount] of expected)
    await expect(page.getByTestId(`result-${address}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      amount,
    );
  const before = await callApi<ReportSnapshot>(
    isolatedSmall.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202602 },
    { token, method: 'GET' },
  );
  expect(before.checks).toHaveLength(6);
  expect(before.checks.every((check) => check.status === 'pass')).toBe(true);
  await isolatedSmall.withCore(bookId, storeInventoryYearOpening);
  const generation = page.waitForResponse((response) =>
    new URL(response.url()).pathname.includes('m.report-engine.generate'),
  );
  await page.getByRole('button', { name: '生成/重算' }).click();
  expect((await generation).ok()).toBe(true);
  const after = await callApi<ReportSnapshot>(
    isolatedSmall.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202602 },
    { token, method: 'GET' },
  );
  expect(after.id).toBeGreaterThan(before.id);
  expect(after.cells).toEqual(before.cells);
  await page.reload();
  for (const [address, amount] of expected)
    await expect(page.getByTestId(`result-${address}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      amount,
    );
  await expect(page.getByTestId('result-A2')).toContainText('尚未完成完整法定报表');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await waiting).path())!);
  for (const [address, amount] of [
    ['C14', 286.88],
    ['D14', 275.88],
    ['C15', 27.88],
    ['D15', 31.15],
    ['C16', 91.97],
    ['D16', 88.9],
    ['C17', 140.42],
    ['D17', 133.41],
    ['C18', 8.6],
    ['D18', 10.09],
  ] as const)
    expect(wb.worksheets[0]!.getCell(address).value).toBe(amount);
  expect(wb.worksheets[0]!.getCell('C16').note).toContain('4001');
  expect(wb.worksheets[0]!.getCell('D16').note).toContain('yearStart');
  expect(wb.worksheets[1]!.getCell('B3').value).toBe('仅已过账');
});

test('w_bb_proc缺少存货组成科目不能默认零，失败生成保留上次真实快照', async ({
  page,
  isolatedSmall,
}) => {
  const { bookId, token } = await loginSmallBook(page, isolatedSmall.request);
  await isolatedSmall.withCore(bookId, async (svc) => {
    await svc.periods.ensureYear(2026);
    for (const [code, balance] of [['1403', 101], ['3001', -101]] as const)
      await svc.opening.upsert({
        year: 2025,
        accountId: (await svc.accounts.require(code)).id,
        balance,
      });
  });
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine`);
  await page.getByLabel('引入JSON模板').setInputFiles(inventoryFile);
  await expect(
    page.getByRole('cell', {
      name: '小企业资产负债表（部分取数，未完成） 只读模板',
      exact: true,
    }),
  ).toBeVisible();
  const reports = await callApi<Report[]>(
    isolatedSmall.request,
    'm.report-engine.list',
    {},
    { token },
  );
  const r = reports.find((report) => report.template.code === '301')!;
  await page.goto(`${isolatedSmall.baseURL}/m/report-engine/view?id=${r.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-C14').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '101',
  );
  const before = await callApi<ReportSnapshot>(
    isolatedSmall.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202602 },
    { token, method: 'GET' },
  );
  await isolatedSmall.withCore(bookId, async (svc) => {
    await svc.db.deleteFrom('account').where('code', '=', '1421').execute();
  });
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '失败操作不会覆盖上次成功结果。' }),
  ).toContainText('1421');
  const after = await callApi<ReportSnapshot>(
    isolatedSmall.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202602 },
    { token, method: 'GET' },
  );
  expect(after).toEqual(before);
  await expect(page.getByTestId('result-C14').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '101',
  );
});
