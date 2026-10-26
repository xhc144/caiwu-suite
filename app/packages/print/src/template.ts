import { escapeHtml } from './driver';
import { layoutGeometry, type PrintLayout } from './layout';
import { wrapPrintText, type PrintView, type PrintPage } from './models';
export type SafePrintTemplate = {
  name: string;
  rows: number;
  cols: number;
  rowHeight: number;
  colWidth: number;
  cells: {
    row: number;
    col: number;
    text: string;
    field?: string;
    align: 'left' | 'center' | 'right';
  }[];
};
const fields = new Set([
  'unit',
  'period',
  'account',
  'title',
  'date',
  'voucherNo',
  'summary',
  'debit',
  'credit',
  'balance',
]);
export function buildTemplateView(
  template: SafePrintTemplate,
  layout: PrintLayout,
  data: Record<string, string> = {},
): PrintView {
  const g = layoutGeometry(layout),
    s = { ...layout, perPage: 1 as const };
  if (
    !Number.isInteger(template.rows) ||
    template.rows < 1 ||
    template.rows > 999 ||
    !Number.isInteger(template.cols) ||
    template.cols < 1 ||
    template.cols > 250 ||
    !template.cells.length
  )
    throw new Error('格式行列或内容无效');
  if (
    !Number.isFinite(template.rowHeight) ||
    template.rowHeight < 3 ||
    template.rowHeight > 30 ||
    !Number.isFinite(template.colWidth) ||
    template.colWidth < 5 ||
    template.colWidth > 100
  )
    throw new Error('格式行高或列宽无效');
  const map = new Map<string, { text: string; align: string }>();
  for (const cell of template.cells) {
    if (
      !Number.isInteger(cell.row) ||
      cell.row < 1 ||
      cell.row > template.rows ||
      !Number.isInteger(cell.col) ||
      cell.col < 1 ||
      cell.col > template.cols ||
      !['left', 'center', 'right'].includes(cell.align) ||
      (cell.field && !fields.has(cell.field))
    )
      throw new Error('格式含越界单元格、不支持的字段或对齐');
    if (map.has(`${cell.row}:${cell.col}`)) throw new Error('格式含重复单元格');
    map.set(`${cell.row}:${cell.col}`, {
      text: cell.field ? (data[cell.field] ?? '') : cell.text,
      align: cell.align,
    });
  }
  if (template.colWidth > g.contentWidth)
    throw new Error('列宽超过可打印宽度，请减小列宽或加宽纸张');
  const per = Math.max(1, Math.floor(g.contentWidth / template.colWidth));
  const pages: PrintPage[] = [];
  const rowMm = Math.max(template.rowHeight, g.lineMm);
  for (let col = 1; col <= template.cols; col += per) {
    const count = Math.min(per, template.cols - col + 1),
      visual: string[] = [];
    for (let row = 1; row <= template.rows; row++) {
      const cells = Array.from({ length: count }, (_, i) => {
        const c = map.get(`${row}:${col + i}`);
        return {
          lines: wrapPrintText(c?.text ?? '', template.colWidth, s.fontSize),
          align: c?.align ?? 'left',
        };
      });
      const height = Math.max(...cells.map((c) => c.lines.length));
      for (let line = 0; line < height; line++)
        visual.push(
          `<tr>${cells.map((c) => `<td style="text-align:${c.align};height:${rowMm}mm">${escapeHtml(c.lines[line] ?? '')}</td>`).join('')}</tr>`,
        );
    }
    const part = col === 1 ? '正页' : `附页 ${Math.floor((col - 1) / per)}`;
    const heading = wrapPrintText(`${template.name} · ${part}`, g.contentWidth, s.fontSize * 1.25);
    const overhead = heading.length * g.lineMm * 1.25 + 4 * g.lineMm + 6;
    const capacity = Math.floor((g.contentHeight / (s.scale / 100) - overhead) / rowMm);
    if (capacity < 1) throw new Error('格式页眉和内容无法放入纸张，请减小字体或边距');
    for (let row = 0; row < visual.length; row += capacity) {
      pages.push({
        entityIds: [],
        labels: [`${template.name} ${part} 第 ${pages.length + 1} 页`],
        html: `<section class="scaled">${heading.map((h) => `<h2 class="single-line">${escapeHtml(h)}</h2>`).join('')}<p>未提供数据的字段留空。</p><table style="width:${count * template.colWidth}mm"><tbody>${visual.slice(row, row + capacity).join('')}</tbody></table><footer>第 ${s.startPage + pages.length} 页</footer></section>`,
      });
    }
  }
  return { title: template.name, pages, layout: s };
}
