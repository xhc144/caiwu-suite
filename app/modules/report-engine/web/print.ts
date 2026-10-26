import { escapeHtml } from '@caiwu/print';
import { columnName, type ReportSnapshot } from '../shared';
import { displayValue } from './Grid';

export function reportHtml(s: ReportSnapshot): string {
  const cells = new Map(s.cells.map((c) => [c.address, c]));
  const styles = new Map(s.template.styles.map((c) => [c.address, c]));
  const rows: string[] = [];
  for (let row = 1; row <= s.template.rows; row++) {
    const cols: string[] = [];
    for (let col = 1; col <= s.template.cols; col++) {
      const merge = s.template.merges.find(
        (m) => row >= m.row && row < m.row + m.rows && col >= m.col && col < m.col + m.cols,
      );
      if (merge && (row !== merge.row || col !== merge.col)) continue;
      const address = `${columnName(col)}${row}`,
        c = cells.get(address),
        style = styles.get(address);
      cols.push(
        `<td${merge ? ` rowspan="${merge.rows}" colspan="${merge.cols}"` : ''} style="text-align:${style?.align ?? 'left'};white-space:${style?.wrap ? 'pre-wrap' : 'nowrap'};font-weight:${style?.bold ? 'bold' : 'normal'}">${escapeHtml(c ? displayValue(c, style?.format) : '')}</td>`,
      );
    }
    rows.push(`<tr>${cols.join('')}</tr>`);
  }
  return `<h1>${escapeHtml(s.template.name)}</h1><p>期间 ${s.period} · ${s.includeUnposted ? '含待审核和已审核（不含草稿/作废）' : '仅已过账'} · 生成时未过账 ${s.unpostedCount} 张 · ${escapeHtml(s.generatedAt)} · 定义版本 ${s.revision}</p><p>金额显示元；有符号净额借正贷负，正常方向取值按公式声明。</p><table>${rows.join('')}</table><ul>${s.checks.map((c) => `<li>${escapeHtml(c.name)}：${c.status === 'pass' ? '通过' : c.status === 'fail' ? '不通过' : '错误'}；差额 ${escapeHtml(c.difference ?? c.reason)}；阈值 ${escapeHtml(c.tolerance)}（金额为分）</li>`).join('')}</ul>`;
}
