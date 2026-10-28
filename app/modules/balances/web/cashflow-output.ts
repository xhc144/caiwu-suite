import { formatMoney, sumCents } from '@caiwu/core';
import { escapeHtml } from '@caiwu/print';
import { downloadBlob } from '@caiwu/ui';
import {
  cashflowCaption,
  cashflowRows,
  type CashflowReport,
  type CashflowSettings,
} from '../cashflow';
import { excelMoney } from './output';

export function cashflowSummary(report: CashflowReport): [string, number][] {
  return [
    ['现金银行期初', report.cashOpening],
    ['现金银行期末', report.cashClosing],
    ['现金银行净变动', report.totals.cashNet],
    ['已分配流入', report.totals.inflow],
    ['已分配流出', report.totals.outflow],
    ['内部互转净额', report.totals.internalNet],
    ['未分配差额', report.totals.unallocatedNet],
    ['余额核对差额', report.balanceDifference],
    [report.ytdComplete ? '本年现金银行净变动' : '启用后现金银行净变动', report.ytd.cashNet],
  ];
}
const headings = [
  '日期',
  '凭证字号',
  '分录行',
  '摘要',
  '项目',
  '流向',
  '分配状态',
  '科目编码',
  '科目名称',
  '收款（借方）',
  '付款（贷方）',
  '本期净额累计',
];
const values = (r: CashflowReport['rows'][number]) => [
  r.date,
  r.displayNo,
  String(r.lineNo),
  r.summary,
  r.projectName,
  r.directionName,
  r.allocated ? '已分配' : '未分配',
  r.accountCode,
  r.accountName,
  r.debit,
  r.credit,
  r.runningNet,
];

function rowsForProject(report: CashflowReport, display: CashflowSettings['display'], key: string) {
  if (!key) return cashflowRows(report, display.sort);
  let running = 0;
  const rows = report.rows
    .filter((r) => r.projectKey === key)
    .map((r) => {
      running = sumCents([running, r.debit, -r.credit]);
      return { ...r, runningNet: running };
    });
  return cashflowRows({ ...report, rows }, display.sort);
}
export async function exportCashflowReport(
  report: CashflowReport,
  display: CashflowSettings['display'],
  batch = false,
) {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  const summary = wb.addWorksheet('现金流量试算');
  summary.addRow(['现金流量试算平衡表']);
  summary.addRow([cashflowCaption(report)]);
  summary.addRow([
    '顶部核对包含所选科目全部项目；历史未填项目或流向列为未分配；互转不计对外收付。',
  ]);
  for (const [label, amount] of cashflowSummary(report))
    summary.addRow([label, excelMoney(amount)]);
  summary.addRow([
    '项目编码',
    '项目名称',
    '流入',
    '流出',
    '互转净额',
    '未分配差额',
    '本期净额',
    report.ytdComplete ? '本年流入' : '启用后流入',
    report.ytdComplete ? '本年流出' : '启用后流出',
    report.ytdComplete ? '本年净额' : '启用后净额',
  ]);
  for (const p of report.projects)
    summary.addRow([
      p.code,
      p.name,
      ...[
        p.inflow,
        p.outflow,
        p.internalNet,
        p.unallocatedNet,
        p.cashNet,
        p.ytd.inflow,
        p.ytd.outflow,
        p.ytd.cashNet,
      ].map(excelMoney),
    ]);
  summary.columns.forEach((c, i) => {
    c.width = i === 1 ? 48 : 22;
  });
  const groups = batch
    ? report.projects.map((p) => ({ key: p.key, title: p.name }))
    : [{ key: '', title: '当前项目明细' }];
  if (!groups.length) groups.push({ key: '', title: '无发生额' });
  for (const [i, g] of groups.entries()) {
    const ws = wb.addWorksheet(`明细${i + 1}`);
    ws.addRow([g.title]);
    ws.addRow([cashflowCaption(report)]);
    ws.addRow([
      '本期净额累计按日期顺序计算，从零开始，不是现金银行余额；累计列均为本位币。金额超出 Excel 精度时保留精确文本。',
    ]);
    ws.addRow(headings);
    for (const r of rowsForProject(report, display, g.key))
      ws.addRow(values(r).map((v) => (typeof v === 'number' ? excelMoney(v) : v)));
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.columns.forEach((c, j) => {
      c.width = j === 3 || j === 4 ? 40 : 22;
      if (j >= 9) c.numFmt = '#,##0.00;[Red]-#,##0.00';
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `现金流量试算-${report.periodFrom}-${report.periodTo}${batch ? '-各项目' : ''}.xlsx`,
  );
}
export function cashflowHtml(
  report: CashflowReport,
  display: CashflowSettings['display'],
  continuous = false,
): string {
  const summary = `<h2>现金流量试算平衡表</h2><p>${escapeHtml(cashflowCaption(report))}</p><table><tbody>${cashflowSummary(
    report,
  )
    .map(
      ([label, amount]) => `<tr><th>${escapeHtml(label)}</th><td>${formatMoney(amount)}</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table><p>顶部核对为所选科目全部项目。互转不计对外收付；未分配 ${report.totals.unallocatedCount} 行。本期净额累计从零开始，按日期计算，不是现金银行余额。</p>`;
  const groups = continuous
    ? report.projects.map((p) => ({ key: p.key, name: p.name }))
    : [{ key: '', name: '项目明细' }];
  return (
    summary +
    `<h3>项目汇总</h3><table><thead><tr>${['项目编码', '项目名称', '流入', '流出', '互转净额', '未分配差额', '本期净额', '本年流入', '本年流出', '本年净额'].map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${report.projects.map((p) => `<tr><td>${escapeHtml(p.code)}</td><td>${escapeHtml(p.name)}</td>${[p.inflow, p.outflow, p.internalNet, p.unallocatedNet, p.cashNet, p.ytd.inflow, p.ytd.outflow, p.ytd.cashNet].map((v) => `<td>${formatMoney(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` +
    groups
      .map(
        (g) =>
          `<section class="cw-page-break"><h3>${escapeHtml(g.name)}</h3><p>${escapeHtml(cashflowCaption(report))}</p><table><thead><tr>${headings.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rowsForProject(
            report,
            display,
            g.key,
          )
            .map(
              (r) =>
                `<tr>${values(r)
                  .map((v) => `<td>${escapeHtml(typeof v === 'number' ? formatMoney(v) : v)}</td>`)
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table></section>`,
      )
      .join('')
  );
}
