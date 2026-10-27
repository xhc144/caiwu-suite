import { escapeHtml } from '@caiwu/print';
import Decimal from 'decimal.js';
import type { ReportSnapshot } from '../../shared';

export function nonprofitPrintHtml(s: ReportSnapshot): string {
  if (s.checks.some((c) => c.status !== 'pass'))
    throw new Error('报表勾稽尚未通过，请修正后再打印');
  const cols = s.template.cols,
    byAddress = new Map(s.cells.map((c) => [c.address, c]));
  const renderRow = (row: number) => {
    const cells: string[] = [];
    for (let col = 1; col <= cols; col++) {
      const merge = s.template.merges.find(
        (m) => row >= m.row && row < m.row + m.rows && col >= m.col && col < m.col + m.cols,
      );
      if (merge && (merge.row !== row || merge.col !== col)) continue;
      const c = byAddress.get(`${String.fromCharCode(64 + col)}${row}`);
      const value = c
        ? c.unit === 'cents'
          ? new Decimal(c.value).div(100).toFixed(2)
          : c.value
        : '';
      cells.push(
        `<${row === 4 ? 'th' : 'td'}${merge ? ` colspan="${merge.cols}"` : ''}>${escapeHtml(value)}</${row === 4 ? 'th' : 'td'}>`,
      );
    }
    return `<tr>${cells.join('')}</tr>`;
  };
  const first = cols > 4 ? 34 : 48;
  const colgroup = `<colgroup><col style="width:${first}%">${Array.from({ length: cols - 1 }, () => `<col style="width:${(100 - first) / (cols - 1)}%">`).join('')}</colgroup>`;
  return `<style>@page{size:A4 ${cols > 4 ? 'landscape' : 'portrait'};margin:10mm}*{box-sizing:border-box}body{font:10pt "Noto Sans CJK SC",sans-serif}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:0.3mm solid #777;padding:1.4mm;overflow-wrap:anywhere;text-align:right}th:first-child,td:first-child{text-align:left}thead tr:first-child td{font-size:16pt;text-align:center;border:0}thead tr:nth-child(2) td,thead tr:nth-child(3) td{text-align:left;border:0}</style><table>${colgroup}<thead>${[1, 2, 3, 4].map(renderRow).join('')}</thead><tbody>${Array.from({ length: s.template.rows - 4 }, (_, i) => renderRow(i + 5)).join('')}</tbody></table>`;
}
