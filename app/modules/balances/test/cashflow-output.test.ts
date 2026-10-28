import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { renderPrintDocument } from '@caiwu/print';
import { downloadBlob } from '@caiwu/ui';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import balancesServer from '../server';
import { exportCashflowReport, cashflowHtml } from '../web/cashflow-output';
import { defaultCashflowSettings } from '../cashflow';
import { seedCashflowCases } from './cashflow-fixtures';

vi.mock('@caiwu/ui', () => ({ downloadBlob: vi.fn() }));
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
  vi.mocked(downloadBlob).mockClear();
});
afterEach(async () => app.close());
const display = defaultCashflowSettings.display;
async function workbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await vi.mocked(downloadBlob).mock.calls[0]![0].arrayBuffer());
  return wb;
}
it('w_zc_xjll_1 各项目真实 XLSX 明细、收付及本年累计，互转每项目累计从零开始', async () => {
  await seedCashflowCases(app.svc);
  const report = await app
    .call(balancesServer)
    .exportCashflow({ periodFrom: 202602, periodTo: 202602 });
  await exportCashflowReport(report, display, true);
  const wb = await workbook();
  expect(wb.worksheets).toHaveLength(5);
  const internal = wb.worksheets.find((w) => w.getCell('A1').text === '现金银行内部互转')!;
  expect(internal.getCell('L5').value).toBe(6);
  expect(internal.getCell('L6').value).toBe(0);
  const summary = wb.worksheets[0]!;
  const rows = summary.getRows(1, summary.rowCount)!;
  const inflow = rows.find((r) => r.getCell(1).value === 'CF01')!;
  expect(inflow.getCell(3).value).toBe(257.1);
  expect(inflow.getCell(8).value).toBe(357.1);
  expect(wb.worksheets.slice(1).reduce((n, w) => n + w.rowCount - 4, 0)).toBe(7);
  const html = cashflowHtml(report, display, true);
  expect(html).toContain('项目汇总');
  expect(html).toContain('内部互转');
  expect(() => renderPrintDocument({ title: '现金流量', html })).not.toThrow();
});
it('w_zc_xjll_1 极值金额逐分导出为精确文本，用户摘要转义后可安全打印', async () => {
  await seedVouchers(app.svc, [
    {
      date: '2026-02-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 9007199254740901, summary: '合成 <script> & <b>' },
        { account: '4001', credit: 9007199254740901 },
      ],
    },
  ]);
  const report = await app
    .call(balancesServer)
    .exportCashflow({ periodFrom: 202602, periodTo: 202602 });
  await exportCashflowReport(report, display);
  const wb = await workbook();
  expect(wb.worksheets[1]!.getCell('J5').value).toBe('90071992547409.01');
  expect(wb.worksheets[1]!.getCell('L5').value).toBe('90071992547409.01');
  const summaryRows = wb.worksheets[0]!.getRows(1, wb.worksheets[0]!.rowCount)!;
  expect(summaryRows.find((r) => r.getCell(1).text === '现金银行净变动')!.getCell(2).value).toBe(
    '90071992547409.01',
  );
  const html = cashflowHtml(report, display);
  expect(html).toContain('&lt;script&gt; &amp; &lt;b&gt;');
  expect(() => renderPrintDocument({ title: '现金流量', html })).not.toThrow();
});
