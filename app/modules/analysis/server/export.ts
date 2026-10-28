import ExcelJS from 'exceljs';
import type { Worksheet } from 'exceljs';
import { centsToYuan } from '@caiwu/core';
import type { AgingReport, TrendReport } from '../shared';
import type { ContractReport } from './contracts';
import type { AnalysisSheet } from '../custom';

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
    `原始到期日未知，逾期天数未知；按期初优先约定核销，其余按业务日期 FIFO；当日为0天；期初残额未分龄；客供和币种分别核销；未来业务日期单列；${MONEY_NOTE}`,
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
  const detail = wb.addWorksheet('账龄来源');
  detail.addRow([
    '科目',
    '辅助项',
    '币种',
    '凭证ID',
    '分录ID',
    '凭证字号',
    '凭证日期',
    '原始业务日期',
    '起龄日期',
    '日期来源',
    '原始到期日',
    '逾期天数',
    '原始正向金额',
    '核销后剩余敞口',
  ]);
  for (const row of report.rows)
    for (const lot of row.lots)
      detail.addRow([
        row.accountCode,
        lot.groupName ?? row.groupName,
        row.currency,
        lot.voucherId,
        lot.lineId,
        lot.voucherNo,
        lot.date,
        lot.originalBizDate ?? '未知',
        lot.bizDate ?? '未知',
        lot.dateBasis === 'business'
          ? '原始业务日期'
          : lot.dateBasis === 'voucher'
            ? '业务日期缺失，取凭证日期'
            : '期初历史日期未知',
        '未知',
        '未知',
        excelMoney(lot.amount),
        excelMoney(lot.remaining),
      ]);
  formatSheet(detail, 1, [13, 14]);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
export async function exportContracts(report: ContractReport) {
  const wb = new Workbook();
  const ws = wb.addWorksheet('合同账款');
  ws.addRow([
    `收付 ${report.filter.from} 至 ${report.filter.to}；仅明确关联的已过账整条分录；本位币 ${report.baseCurrency}；期初收付截至启用日 ${report.openingDate}；原始到期日与逾期天数未知；${MONEY_NOTE}`,
  ]);
  ws.addRow(['快照', report.generatedAt]);
  ws.addRow([
    '合同号',
    '名称',
    '客供',
    '签订日期',
    '类型',
    '合同金额',
    '期初收付',
    '本期收付',
    '累计收付',
    '未完成金额',
    '到期日',
    '说明',
    '备注',
  ]);
  for (const r of report.rows)
    ws.addRow([
      r.code,
      r.name,
      r.partnerName,
      r.signed_date,
      r.kind === 'receipt' ? '收款' : '付款',
      ...[r.amount, r.opening, r.current, r.cumulative, r.remaining].map(excelMoney),
      '未知',
      r.description,
      r.remark,
    ]);
  ws.addRow([
    '合计',
    '',
    '',
    '',
    '',
    ...[
      report.totals.amount,
      report.totals.opening,
      report.totals.current,
      report.totals.cumulative,
      report.totals.remaining,
    ].map(excelMoney),
  ]);
  formatSheet(ws, 3, [6, 7, 8, 9, 10]);
  const detail = wb.addWorksheet('关联分录');
  detail.addRow([
    '合同号',
    '凭证ID',
    '分录ID',
    '日期',
    '凭证字号',
    '科目',
    '摘要',
    '收付款金额',
    '关联人ID',
    '关联时间',
  ]);
  for (const r of report.rows)
    for (const l of r.lines.filter((line) => line.date <= report.filter.to))
      detail.addRow([
        r.code,
        l.voucherId,
        l.line_id,
        l.date,
        l.displayNo,
        l.accountCode,
        l.summary,
        excelMoney(l.amount),
        l.linked_by,
        l.linked_at,
      ]);
  formatSheet(detail, 1, [8]);
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

export async function exportAnalysisSheet(name: string, report: AnalysisSheet) {
  const wb = new Workbook();
  const ws = wb.addWorksheet('分析结果');
  ws.addRow([name, '金额单位：元；比例单位：%']);
  ws.addRow([report.title, report.generatedAt]);
  ws.addRow([report.note]);
  ws.addRow([
    '项目编号',
    '项目',
    '单位',
    ...report.periods.map(String),
    report.source.kind === 'custom' ? '末期数' : '累计 / 末月余额',
    '月均',
    '占比%',
  ]);
  const units = { money: '元', percent: '%', number: '数值' };
  for (const r of report.rows)
    ws.addRow([
      r.key,
      r.name,
      units[r.unit],
      ...r.values.map((v) => (v === null ? '早于启用期间' : excelMoney(v))),
      excelMoney(r.total),
      excelMoney(r.average),
      r.ratio,
    ]);
  formatSheet(
    ws,
    4,
    Array.from({ length: report.periods.length + 2 }, (_, i) => i + 4),
  );
  const original = wb.addWorksheet('取数原值');
  original.addRow(['项目编号', '项目', '公式', ...report.periods.map(String)]);
  for (const r of report.rows)
    original.addRow([
      r.key,
      r.name,
      r.formula,
      ...r.originalValues.map((v) => (v === null ? '早于启用期间' : excelMoney(v))),
    ]);
  formatSheet(
    original,
    1,
    report.periods.map((_, i) => i + 4),
  );
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
