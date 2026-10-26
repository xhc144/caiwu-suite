import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Report, ReportSnapshot } from '../../shared';
import { workbookBase64 } from '../../server/export';
import { balanceSheetSlots, cashflowSlots, enterpriseProfit } from '../../templates/enterprise';
import { test } from './fixture';

test('W2-02 独立账套→真实UI引入企业表样→期末净额/现金项目→重算→真实xlsx保留缺项', async ({
  page,
  enterprise,
}) => {
  const { bookId, token } = await loginWithNewBook(page, enterprise.request, {
    product: 'qingsong',
  });
  const templates = await enterprise.seed(bookId);
  await page.goto(`${enterprise.baseURL}/m/report-engine`);
  await page.getByLabel('引入JSON模板').setInputFiles({
    name: '201.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(templates.balance)),
  });
  const bsRow = page.getByRole('row').filter({ hasText: templates.balance.name });
  await expect(bsRow).toBeVisible();
  await expect(bsRow.getByText('只读模板')).toBeVisible();
  await bsRow.getByRole('button', { name: '生成/查看', exact: true }).click();
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(
    page.getByTestId(`result-${balanceSheetSlots.cash!.current}`).locator('[data-cents]'),
  ).toHaveAttribute('data-cents', '174195');
  await expect(
    page.getByTestId(`result-${balanceSheetSlots.fixedAssets!.current}`).locator('[data-cents]'),
  ).toHaveAttribute('data-cents', '95000');
  await expect(page.getByTestId(`result-${balanceSheetSlots.cash!.comparative}`)).toContainText(
    '比较期间',
  );
  await expect(page.getByTestId('result-A2')).toContainText('不可用作完整法定报表');
  await expect(
    page.getByText('资产总计＝负债和所有者权益总计（待配置项会报错）：错误', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '失败操作不会覆盖上次成功结果。' }),
  ).toContainText('审核');
  const reports = await callApi<Report[]>(
    enterprise.request,
    'm.report-engine.list',
    {},
    { token },
  );
  const bs = reports.find((r) => r.template.code === '201')!;
  const saved = await callApi<ReportSnapshot>(
    enterprise.request,
    'm.report-engine.snapshot',
    { id: bs.id, period: 202601 },
    { token, method: 'GET' },
  );
  // 保留全部离线xlsx金额/格式断言；公共失败禁导出已通过真实浏览器断言。
  // 正常生成和真实下载正例另见purchase-reclassification.spec.ts。
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(await workbookBase64(saved), 'base64')).buffer);
  const ws = wb.worksheets[0]!;
  expect(ws.getCell(balanceSheetSlots.cash!.current).value).toBe(1741.95);
  expect(ws.getCell(balanceSheetSlots.fixedAssets!.current).value).toBe(950);
  expect(ws.getCell(balanceSheetSlots.cash!.comparative).value).toContain('比较期间');
  expect(ws.getCell('A2').value).toContain('未完成');
  expect(ws.getCell(balanceSheetSlots.cash!.current).note).toContain('BALANCE');
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(
    page.getByTestId(`result-${balanceSheetSlots.cash!.current}`).locator('[data-cents]'),
  ).toHaveAttribute('data-cents', '174195');

  await page.goto(`${enterprise.baseURL}/m/report-engine`);
  await page.getByLabel('引入JSON模板').setInputFiles({
    name: '203.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(templates.cashflow)),
  });
  await page
    .getByRole('row')
    .filter({ hasText: templates.cashflow.name })
    .getByRole('button', { name: '生成/查看', exact: true })
    .click();
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(
    page.getByTestId(`result-${cashflowSlots.salesReceipts!.current}`).locator('[data-cents]'),
  ).toHaveAttribute('data-cents', '14000');
  await expect(
    page.getByTestId(`result-${cashflowSlots.purchases!.current}`).locator('[data-cents]'),
  ).toHaveAttribute('data-cents', '305');
  await expect(
    page
      .getByTestId(`result-${cashflowSlots.otherOperatingReceipts!.current}`)
      .locator('[data-cents]'),
  ).toHaveAttribute('data-cents', '2500');
  await expect(
    page.getByTestId(`result-${cashflowSlots.salesReceipts!.comparative}`),
  ).toContainText('比较期间');
  // 202只有官方表样，不把利润表导入成功称为利润计算完成。
  const profit = await callApi<Report>(
    enterprise.request,
    'm.report-engine.importTemplate',
    enterpriseProfit(),
    { token, method: 'POST' },
  );
  await page.goto(`${enterprise.baseURL}/m/report-engine/view?id=${profit.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-B5')).toContainText('待配置');
  await expect(page.getByTestId('result-A2')).toContainText('结转前利润');
});
