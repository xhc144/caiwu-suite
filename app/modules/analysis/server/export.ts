import ExcelJS from 'exceljs';
import type { Worksheet } from 'exceljs';
import { centsToYuan } from '@caiwu/core';
import type { AgingReport, TrendReport } from '../shared';

const { Workbook } = ExcelJS;
// Excel 数值只有15位有效数字；分值超过15位时，必须保留精确十进制文本。
// https://support.microsoft.com/en-us/excel/excel-specifications-and-limits
const MAX_NUMERIC_CENTS = 999_999_999_999_999;
const MONEY_NOTE = '金额绝对值超过9999999999999.99元时按精确文本保存，避免丢失分值';

function excelMoney(cents: number): number | string {
  const exact = centsToYuan(cents);
  if (Math.abs(cents) > MAX_NUMERIC_CENTS) return exact;
  const numeric = Number(exact);
  return numeric.toFixed(2) === exact ? numeric : exact;
}

function formatSheet(sheet: Worksheet, headerRow: number, moneyColumns: number[]) {
  sheet.getRow(headerRow).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.columns.forEach((column) => {
    column.width = 22;
  });
  for (const i of moneyColumns) {
    const column = sheet.getColumn(i);
    column.numFmt = '#,##0.00;[Red]-#,##0.00';
    column.eachCell((cell) => {
      if (typeof cell.value === 'string' && /^-?\d+\.\d{2}$/.test(cell.value)) {
        cell.numFmt = '@';
        cell.alignment = { horizontal: 'right' };
      }
    });
  }
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: sheet.columnCount },
  };
}
export async function exportAging(report: AgingReport) {
  const wb = new Workbook();
  const sheet = wb.addWorksheet('账龄分析');
  sheet.addRow([
    `截止 ${report.filter.cutoff}；${report.filter.includeUnposted ? '含未过账' : '仅已过账'}；${report.filter.direction === 'receivable' ? '应收' : '应付'}；借正贷负；金额均为本位币 ${report.baseCurrency}`,
  ]);
  sheet.addRow([
    `按期初优先约定核销，其余按业务日期 FIFO；当日为0天；期初残额未分龄；客供和币种分别核销；未来业务日期单列；${MONEY_NOTE}`,
  ]);
  sheet.addRow(['快照', report.generatedAt]);
  sheet.addRow([
    '科目',
    '名称',
    '辅助项',
    '交易币种',
    ...report.bucketLabels,
    '期初未分龄',
    '未来业务日期',
    '反向余额',
    '同截止余额',
  ]);
  const amounts = (r: {
    buckets: number[];
    unaged: number;
    future: number;
    reverse: number;
    closing: number;
  }) => [...r.buckets, r.unaged, r.future, r.reverse, r.closing].map(excelMoney);
  report.rows.forEach((r) =>
    sheet.addRow([r.accountCode, r.accountName, r.groupName, r.currency, ...amounts(r)]),
  );
  sheet.addRow(['合计', '', '', '', ...amounts(report.totals)]);
  formatSheet(
    sheet,
    4,
    Array.from({ length: report.bucketLabels.length + 4 }, (_, i) => i + 5),
  );
  const control = wb.addWorksheet('总账核对');
  control.addRow(['科目', '辅助项', '账龄有符号合计', '同截止日总账', '差额']);
  report.controls.forEach((r) =>
    control.addRow([
      r.accountCode,
      r.groupName,
      ...[r.allocated, r.ledger, r.difference].map(excelMoney),
    ]),
  );
  formatSheet(control, 1, [3, 4, 5]);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
export async function exportTrend(report: TrendReport) {
  const wb = new Workbook();
  const ws = wb.addWorksheet('科目分析');
  const metric = { debit: '借方发生额', credit: '贷方发生额', balance: '期末余额' }[
    report.filter.metric
  ];
  ws.addRow([
    `${report.filter.period}；${report.filter.mode === 'annual' ? '年度' : '月度'}；${metric}；${report.filter.scope === 'operating' ? '经营分析：排除本年度损益结转，年初按总账' : '原始总账'}；${report.filter.includeUnposted ? '含未过账' : '仅已过账'}；${MONEY_NOTE}`,
  ]);
  ws.addRow(['快照', report.generatedAt, '占比分母（元）', excelMoney(report.denominator)]);
  const periods =
    report.filter.mode === 'annual'
      ? Array.from({ length: 12 }, (_, i) => `${i + 1}月`)
      : ['本月数'];
  ws.addRow([
    '科目',
    '名称',
    ...periods,
    '本年累计 / 末月余额',
    '月均',
    '占比%',
    '总账末月数',
    '损益结转调整',
  ]);
  const money = (n: number | null) => (n == null ? '早于启用 / 未查询' : excelMoney(n));
  report.rows.forEach((r) =>
    ws.addRow([
      r.accountCode,
      r.accountName,
      ...(report.filter.mode === 'annual' ? r.months.map(money) : [money(r.current)]),
      money(r.ytd),
      money(r.average),
      r.ratio ?? '无法计算：基数为零',
      money(r.ledgerCurrent),
      money(r.pnlAdjustment),
    ]),
  );
  const ratioColumn = periods.length + 5;
  formatSheet(
    ws,
    3,
    Array.from({ length: periods.length + 5 }, (_, i) => i + 3).filter((i) => i !== ratioColumn),
  );
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
