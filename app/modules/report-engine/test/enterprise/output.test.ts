import { it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { calculateEnterprise } from '../../templates/enterprise/calculate';
import { enterpriseWorkbookBase64 } from '../../templates/enterprise/output.server';
import { enterprisePages, enterprisePrintHtml } from '../../templates/enterprise/output';
import { fixture, provenance } from './fixture';
it('w_bb_saveas xlsx金额为数值，完整权益分组、重复表头与A4设置', async () => {
  const { c, d } = fixture(),
    r = calculateEnterprise(c, d),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    Uint8Array.from(Buffer.from(await enterpriseWorkbookBase64(r), 'base64')).buffer,
  );
  expect(wb.worksheets).toHaveLength(14);
  const bs = wb.worksheets[0]!;
  expect(bs.getCell('B5').value).toBe(2200);
  expect(bs.pageSetup.paperSize).toBe(9);
  expect(bs.pageSetup.printTitlesRow).toBe('1:3');
  expect(wb.worksheets.filter((w) => w.pageSetup.orientation === 'landscape')).toHaveLength(6);
  const pages = enterprisePages(r);
  expect(pages.filter((p) => p.title.startsWith('所有者权益变动表'))).toHaveLength(6);
  const html = enterprisePrintHtml(r, 'equity');
  expect(html).toContain('实收资本（或股本）');
  expect(html).toContain('其他权益工具·优先股');
  expect(html).toContain('其他权益工具·永续债');
  expect(html).toContain('所有者权益合计');
  expect(html).toContain('本年年末余额');
});
it('w_bb_saveas 现金范围变化后正式第六项及分部追溯调整按实际金额输出', async () => {
  const { c, d } = fixture();
  const policy = c.cashPolicies.find((p) => p.period === 202512 && p.basis === 'closing')!;
  policy.accounts = [];
  policy.restrictedAccounts = [1];
  c.cashScopeChanges.push({
    period: 202512,
    date: '2025-12-31',
    accountId: 1,
    amount: '-220000',
    kind: 'restriction',
    ...provenance,
  });
  for (const [row, amount] of [
    ['discontinuedProfit', '10000'],
    ['continuingProfit', '-10000'],
  ])
    c.adjustments.push({
      period: 202412,
      statement: 'profit',
      row: row!,
      amount: amount!,
      kind: 'policy',
      ...provenance,
    });
  const result = calculateEnterprise(c, d),
    pages = enterprisePages(result),
    cashRows = pages.filter((p) => p.title.startsWith('现金流量表')).flatMap((p) => p.rows),
    profitRows = pages.filter((p) => p.title.startsWith('利润表')).flatMap((p) => p.rows),
    closing = cashRows.find((row) => row[0]!.value === '六、期末现金及现金等价物余额')!,
    scope = cashRows.find((row) => row[0]!.value === '现金范围非账务变化调节（单独披露）')!;
  expect(closing.slice(1).map((cell) => cell.value)).toEqual(['0', '160000']);
  expect(scope.slice(1).map((cell) => cell.value)).toEqual(['-220000', '0']);
  expect(cashRows.some((row) => row[0]!.value === '实际期末现金及现金等价物')).toBe(false);
  expect(
    profitRows.find((row) => row[0]!.value.startsWith('（一）持续经营净利润'))![2]!.value,
  ).toBe('50000');
  expect(
    profitRows.find((row) => row[0]!.value.startsWith('（二）终止经营净利润'))![2]!.value,
  ).toBe('10000');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    Uint8Array.from(Buffer.from(await enterpriseWorkbookBase64(result), 'base64')).buffer,
  );
  const sheet = wb.worksheets.find((sheet) =>
    sheet.getColumn(1).values.includes('六、期末现金及现金等价物余额'),
  )!;
  const row = sheet.getColumn(1).values.indexOf('六、期末现金及现金等价物余额');
  expect(sheet.getCell(row, 2).value).toBe(0);
  expect(sheet.getCell(row, 3).value).toBe(1600);
  const html = enterprisePrintHtml(result, 'cashflow');
  expect(html).toMatch(/六、期末现金及现金等价物余额<\/td><td[^>]*>0\.00<\/td>/);
});
