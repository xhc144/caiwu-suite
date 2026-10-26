import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { cellText, displayColumns, reportCaption } from '../presentation';
import type { ColumnId, LedgerQuery, LedgerReport } from '../shared';
import { ledgersService } from './service';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function assertPrintable(report: LedgerReport) {
  if (!report.rows.length)
    throw new BusinessError({
      code: 'LEDGERS_EMPTY',
      message: '当前筛选没有账簿记录，不能导出或打印',
      hint: '请调整期间、科目、币种或辅助核算条件后重新查询。',
      actions: [{ label: '调整筛选', to: '/m/ledgers/detail' }],
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
  input: LedgerQuery & { columns: ColumnId[] },
) {
  const report = await load(svc, input);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title);
  const columns = displayColumns(input.kind, input.columns);
  sheet.addRow([reportCaption(report)]);
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.addRow(columns.map((c) => c.label)).font = { bold: true };
  for (const row of report.rows) {
    // 文本金额保证所有安全整数分均精确落盘，不受 Excel 15 位有效数限制。
    const output = sheet.addRow(columns.map((c) => cellText(row, c.id)));
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
export async function printReport(svc: CoreServices, input: LedgerQuery & { columns: ColumnId[] }) {
  const report = await load(svc, input);
  const columns = displayColumns(input.kind, input.columns);
  return {
    title: report.title,
    report,
    html: `<h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(reportCaption(report))}</p><table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>${report.rows.map((row) => `<tr${row.kind !== 'entry' ? ' style="font-weight:bold;background:#f0f2f5"' : ''}>${columns.map((c) => `<td${c.money ? ' class="num"' : ''}>${escapeHtml(cellText(row, c.id))}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  };
}
