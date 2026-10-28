import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { reportCellText, reportColumns, reportCaption } from '../presentation';
import { buildLedgerPrintView, selectReportAccounts, type PrintOptionsInput } from '../printing';
import type { ColumnId, LedgerQuery, LedgerReport } from '../shared';
import { ledgersService } from './service';

export function assertPrintable(report: LedgerReport) {
  if (!report.rows.length)
    throw new BusinessError({
      code: 'LEDGERS_EMPTY',
      message: '当前筛选没有账簿记录，不能导出或打印',
      hint: '请调整期间、科目、币种或辅助核算条件后重新查询。',
      actions: [{ label: '调整筛选', to: '/m/ledgers/detail' }],
    });
}
/** 原版 w_zc_dlz_1 / w_zc_fhdlz_1 的另存列数上限，打印仍可分附页。 */
export function assertExportColumns(report: LedgerReport) {
  if (
    (report.query.kind === 'multi' || report.query.kind === 'auxiliary-multi') &&
    (report.dynamicColumns?.length ?? 0) > 248
  )
    throw new BusinessError({
      code: 'LEDGERS_EXPORT_COLUMNS',
      message: '多栏账的栏目超过 248 列，不能导出',
      hint: '请减少自定义栏目、改选下级科目，或使用正页和附页打印。',
    });
}
async function load(svc: CoreServices, input: LedgerQuery) {
  await svc.permissions.require('ledgers.view');
  const report = await ledgersService(svc).report(input);
  assertPrintable(report);
  return report;
}
export async function exportReport(
  svc: CoreServices,
  input: LedgerQuery & { columns: ColumnId[]; accountCodes?: string[] },
) {
  await svc.permissions.require('ledgers.export');
  const report = selectReportAccounts(await load(svc, input), input.accountCodes);
  assertExportColumns(report);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title);
  const columns = reportColumns(report, input.columns);
  sheet.addRow([reportCaption(report)]);
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.addRow(columns.map((c) => c.label)).font = { bold: true };
  for (const row of report.rows) {
    // 文本金额保证所有安全整数分均精确落盘，不受 Excel 15 位有效数限制。
    const output = sheet.addRow(columns.map((c) => reportCellText(row, c.id, c.money)));
    if (row.kind !== 'entry') output.font = { bold: true };
  }
  columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.id === 'summary' || c.id === 'account' ? 30 : 18;
  });
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    fileName: `${report.title}-${input.periodFrom}-${input.periodTo}.xlsx`,
    base64: Buffer.from(buffer).toString('base64'),
    report,
  };
}
export async function printReport(
  svc: CoreServices,
  input: LedgerQuery & { columns: ColumnId[]; printOptions?: PrintOptionsInput },
) {
  await svc.permissions.require('ledgers.print');
  const report = await load(svc, input);
  return {
    ...buildLedgerPrintView(report, reportColumns(report, input.columns), input.printOptions),
    report,
  };
}
