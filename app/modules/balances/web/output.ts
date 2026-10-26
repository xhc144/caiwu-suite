import { centsToYuan, formatMoney } from '@caiwu/core';
import { escapeHtml } from '@caiwu/print';
import { downloadBlob } from '@caiwu/ui';
import {
  outputRows,
  reportCaption,
  reportTitle,
  groupCaption,
  type OutputRow,
  type Report,
} from '../shared';

export const outputColumns: {
  key: keyof OutputRow;
  title: string;
  money?: boolean;
  foreign?: boolean;
  quantity?: boolean;
}[] = [
  { key: 'code', title: '科目编码' },
  { key: 'name', title: '科目名称' },
  { key: 'openingSide', title: '期初方向' },
  { key: 'opening', title: '期初金额', money: true },
  { key: 'debit', title: '本期借方', money: true },
  { key: 'credit', title: '本期贷方', money: true },
  { key: 'ytdDebit', title: '本年累计借方', money: true },
  { key: 'ytdCredit', title: '本年累计贷方', money: true },
  { key: 'closingSide', title: '期末方向' },
  { key: 'closing', title: '期末金额', money: true },
  { key: 'fcOpening', title: '外币期初（借正贷负）', money: true, foreign: true },
  { key: 'fcDebit', title: '外币本期借方', money: true, foreign: true },
  { key: 'fcCredit', title: '外币本期贷方', money: true, foreign: true },
  { key: 'fcClosing', title: '外币期末（借正贷负）', money: true, foreign: true },
  { key: 'qtyOpening', title: '期初数量（借正贷负）', quantity: true },
  { key: 'qtyDebit', title: '本期借方数量', quantity: true },
  { key: 'qtyCredit', title: '本期贷方数量', quantity: true },
  { key: 'qtyClosing', title: '期末数量（借正贷负）', quantity: true },
];

export function columnsFor(report: Report) {
  return outputColumns.filter(
    (c) => (!c.foreign || report.mode === 'foreign') && (!c.quantity || report.mode === 'quantity'),
  );
}

/** Excel 数值最多保留 15 位有效数字；金额还必须能按两位小数逐分回读。
 * 超出任一条件时保留精确文本，不把安全整数分静默转成失真的元数值。
 */
function excelMoney(cents: number): number | string {
  const exact = centsToYuan(cents);
  // 保守按分值计位数，即使某个更大的整元恰好可转也不依赖 Excel 的截位行为。
  if (Math.abs(cents) > 999_999_999_999_999) return exact;
  const numeric = Number(exact);
  return numeric.toFixed(2) === exact ? numeric : exact;
}

export async function exportReport(report: Report, level: number, expanded: number[]) {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  const columns = columnsFor(report);
  for (const [index, group] of report.groups.entries()) {
    const ws = wb.addWorksheet(`${index + 1}-${group.currency || '本位币'}`);
    ws.addRow([reportTitle(report)]);
    ws.addRow([`${reportCaption(report, group.currency)}；${groupCaption(group)}`]);
    ws.addRow([
      `显示级次：${level === -1 ? '仅末级' : level || '全部'}；合计余额金额以“借方 / 贷方”分别列示；超出 Excel 15 位精度或无法逐分回读的金额使用精确两位小数文本`,
    ]);
    ws.addRow(columns.map((c) => c.title)).font = { bold: true };
    for (const row of outputRows(group, level, expanded)) {
      ws.addRow(
        columns.map((c) => {
          const value = row[c.key];
          return typeof value === 'number' && c.money ? excelMoney(value) : String(value ?? '');
        }),
      );
    }
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.key === 'name' ? 48 : 22;
      if (c.money) col.numFmt = '#,##0.00;[Red]-#,##0.00';
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
  }
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `余额表-${report.periodFrom}-${report.periodTo}.xlsx`,
  );
}

export function reportHtml(report: Report, level: number, expanded: number[]) {
  const cols = columnsFor(report);
  return report.groups
    .map(
      (g) =>
        `<h2>${escapeHtml(reportTitle(report))}</h2><p>${escapeHtml(reportCaption(report, g.currency))}；${escapeHtml(groupCaption(g))}</p><p>合计余额金额按“借方 / 贷方”分别列示</p><table><thead><tr>${cols.map((c) => `<th>${escapeHtml(c.title)}</th>`).join('')}</tr></thead><tbody>${outputRows(
          g,
          level,
          expanded,
        )
          .map(
            (r) =>
              `<tr>${cols
                .map((c) => {
                  const v = r[c.key];
                  return `<td>${escapeHtml(typeof v === 'number' && c.money ? formatMoney(v) : v)}</td>`;
                })
                .join('')}</tr>`,
          )
          .join('')}</tbody></table>`,
    )
    .join('<div class="cw-page-break"></div>');
}
