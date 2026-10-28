import { escapeHtml, type PrintJob } from '@caiwu/print';
import { columnName, PrintSettingsSchema, type CellStyle, type ReportSnapshot } from '../shared';
import { displayValue } from './format';

const MM_PER_PX = 25.4 / 96;
const PAPER_MM = { A4: [210, 297], A5: [148, 210], B5: [176, 250] } as const;
const borderCss = {
  none: 'none',
  thin: '0.5pt solid #000',
  medium: '1pt solid #000',
  dashed: '0.5pt dashed #000',
  double: '2pt double #000',
} as const;

/** 固定行高参与分页，合并单元格保持完整；套打始终使用原始尺寸。 */
export function reportPrintLayout(s: ReportSnapshot) {
  const settings = PrintSettingsSchema.parse(s.template.print ?? {});
  const paper = PAPER_MM[settings.paperSize];
  const width = paper[settings.orientation === 'landscape' ? 1 : 0];
  const height = paper[settings.orientation === 'landscape' ? 0 : 1];
  const printableWidth = width - settings.marginMm * 2;
  const printableHeight = height - settings.marginMm * 2;
  if (printableWidth <= 0 || printableHeight <= 0)
    throw new Error('页边距占满了纸张，请减小页边距后重新打印。');
  const overlay = settings.mode === 'overlay';
  const colWidths = Array.from(
    { length: s.template.cols },
    (_, i) => s.template.colWidths.find((c) => c.col === i + 1)?.width ?? 160,
  );
  const rawWidth = colWidths.reduce((a, b) => a + b, 0) * MM_PER_PX;
  const scale = overlay ? 1 : Math.min(1, printableWidth / rawWidth);
  const rowHeights = Array.from(
    { length: s.template.rows },
    (_, i) =>
      (s.template.rowHeights.find((r) => r.row === i + 1)?.height ?? 36) * MM_PER_PX * scale,
  );
  const headerHeight = overlay ? 0 : 25;
  const footerHeight = overlay ? 0 : 7;
  const x = overlay ? settings.offsetXmm : 0;
  const y = overlay ? settings.offsetYmm : 0;
  if (overlay && (settings.marginMm + x < 0 || settings.marginMm + y < 0))
    throw new Error('套打偏移使内容超出纸张左侧或上侧，请调整偏移或页边距。');
  if (overlay && rawWidth + Math.max(0, x) > printableWidth + 0.01)
    throw new Error('报表原始列宽超过套打纸张，请减小列宽、横向偏移或改用更宽的纸张。');
  const availableHeight = printableHeight - headerHeight - footerHeight - Math.max(0, y);
  const repeatRows = Array.from({ length: settings.repeatRows }, (_, i) => i + 1);
  const sumHeight = (rows: number[]) => rows.reduce((sum, row) => sum + rowHeights[row - 1]!, 0);
  const repeatHeight = sumHeight(repeatRows);
  if (repeatHeight > availableHeight)
    throw new Error('重复打印标题行超过一页可用高度，请减少重复行数或行高。');
  const pages: number[][] = [];
  let body: number[] = [];
  let bodyHeight = 0;
  const flush = () => {
    pages.push([...repeatRows, ...body]);
    body = [];
    bodyHeight = 0;
  };
  for (let row = settings.repeatRows + 1; row <= s.template.rows;) {
    let end = row;
    // 相接的跨行合并可能连成一个不可拆分区间。
    for (;;) {
      const next = s.template.merges.reduce(
        (n, m) => (m.row <= end && m.row + m.rows > row ? Math.max(n, m.row + m.rows - 1) : n),
        end,
      );
      if (next === end) break;
      end = next;
    }
    const block = Array.from({ length: end - row + 1 }, (_, i) => row + i);
    const blockHeight = sumHeight(block);
    if (repeatHeight + blockHeight > availableHeight + 0.01)
      throw new Error(
        `第${row}至${end}行超过一页可用高度，请减小行高、取消跨页合并或减少重复标题行。`,
      );
    if (
      body.length &&
      (settings.rowBreaks.includes(row) ||
        repeatHeight + bodyHeight + blockHeight > availableHeight + 0.01)
    )
      flush();
    body.push(...block);
    bodyHeight += blockHeight;
    row = end + 1;
  }
  if (body.length || !pages.length) flush();
  return {
    settings,
    pages,
    scale,
    colWidths: colWidths.map((w) => w * MM_PER_PX * scale),
    rowHeights,
    tableWidth: rawWidth * scale,
    printableWidth,
    printableHeight,
    headerHeight,
    x,
    y,
  };
}

function cellCss(style: CellStyle | undefined, scale: number, grid: boolean) {
  const border = grid ? borderCss.thin : 'none';
  return [
    `text-align:${style?.align ?? 'left'}`,
    `white-space:${style?.wrap ? 'pre-wrap' : 'nowrap'}`,
    `font-weight:${style?.bold ? 'bold' : 'normal'}`,
    `font-family:${style?.fontFamily ?? '宋体'}`,
    `font-size:${(style?.fontSize ?? 11) * scale}pt`,
    `font-style:${style?.italic ? 'italic' : 'normal'}`,
    `text-decoration:${style?.underline ? 'underline' : 'none'}`,
    `color:${style?.color ?? '#000000'}`,
    ...(['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => {
      const value = style?.[`border${side}`];
      return `border-${side.toLowerCase()}:${value === undefined ? border : borderCss[value]}`;
    }),
    `padding:${2 * scale}px ${4 * scale}px`,
  ].join(';');
}

export function reportHtml(s: ReportSnapshot): string {
  const layout = reportPrintLayout(s);
  const { settings, scale } = layout;
  const overlay = settings.mode === 'overlay';
  const cells = new Map(s.cells.map((c) => [c.address, c]));
  const styles = new Map(s.template.styles.map((c) => [c.address, c]));
  const pages = layout.pages.map((pageRows, pageIndex) => {
    const rows = pageRows.map((row) => {
      const cols: string[] = [];
      for (let col = 1; col <= s.template.cols; col++) {
        const merge = s.template.merges.find(
          (m) => row >= m.row && row < m.row + m.rows && col >= m.col && col < m.col + m.cols,
        );
        if (merge && (row !== merge.row || col !== merge.col)) continue;
        const address = `${columnName(col)}${row}`;
        const c = cells.get(address);
        const style = styles.get(address);
        const height = layout.rowHeights
          .slice(row - 1, row - 1 + (merge?.rows ?? 1))
          .reduce((a, b) => a + b, 0);
        const content = c && (!overlay || c.unit !== 'text') ? displayValue(c, style?.format) : '';
        const css = overlay
          ? `${cellCss(style, 1, false)};border:none;padding:0`
          : cellCss(style, scale, settings.showGrid);
        cols.push(
          `<td${merge ? ` rowspan="${merge.rows}" colspan="${merge.cols}"` : ''} style="${css}"><div style="max-height:${Math.max(0, height - (overlay ? 0 : 4 * scale * MM_PER_PX))}mm;overflow:hidden">${escapeHtml(content)}</div></td>`,
        );
      }
      return `<tr data-report-row="${row}" style="height:${layout.rowHeights[row - 1]}mm">${cols.join('')}</tr>`;
    });
    const header = overlay
      ? ''
      : `<header class="report-print-heading"><h1>${escapeHtml(s.template.name)}</h1><p>期间 ${s.period} · ${s.includeUnposted ? '含待审核和已审核（不含草稿、作废）' : '仅已过账'} · 生成时未过账 ${s.unpostedCount} 张</p><p>金额单位：元 · ${escapeHtml(s.generatedAt)} · 定义版本 ${s.revision}</p></header>`;
    const footer = overlay
      ? ''
      : `<footer class="report-print-footer">借正贷负；正常方向按公式声明。报表第 ${pageIndex + 1} / ${layout.pages.length} 页</footer>`;
    return `<section class="report-print-page" data-report-page="${pageIndex + 1}" style="width:${layout.printableWidth}mm;height:${layout.printableHeight}mm">${header}<div class="report-print-origin" style="left:${layout.x}mm;top:${layout.headerHeight + layout.y}mm"><table style="width:${layout.tableWidth}mm"><colgroup>${layout.colWidths.map((width) => `<col style="width:${width}mm">`).join('')}</colgroup><tbody>${rows.join('')}</tbody></table></div>${footer}</section>`;
  });
  const checks =
    !overlay && s.checks.length
      ? `<section class="report-print-audit"><h2>报表审核</h2><ul>${s.checks.map((c) => `<li>${escapeHtml(c.name)}：${c.status === 'pass' ? '通过' : c.status === 'fail' ? '不通过' : '错误'}；${c.condition !== undefined ? `${escapeHtml(c.condition)}；${escapeHtml(c.reason)}` : `差额 ${escapeHtml(c.difference ?? c.reason)}；阈值 ${escapeHtml(c.tolerance)}（金额为分）`}</li>`).join('')}</ul></section>`
      : '';
  return `<article class="report-print${overlay ? ' report-print-overlay' : ''}">${pages.join('')}${checks}</article>`;
}

export function reportPrintJob(s: ReportSnapshot): PrintJob {
  const { settings } = reportPrintLayout(s);
  return {
    title: s.template.name,
    html: reportHtml(s),
    pageSize: settings.paperSize,
    orientation: settings.orientation,
    marginMm: settings.marginMm,
    css: `.report-print-page{position:relative;box-sizing:border-box;break-after:page;page-break-after:always}.report-print-page:last-child{break-after:auto;page-break-after:auto}.report-print-origin{position:absolute}.report-print table{border-collapse:collapse;table-layout:fixed}.report-print td{box-sizing:border-box;line-height:1.1;vertical-align:middle;overflow:hidden;overflow-wrap:anywhere}.report-print-heading{height:25mm;overflow:hidden}.report-print-heading h1{font-size:16pt;line-height:1.2;margin:0 0 2mm}.report-print-heading p{font-size:9pt;line-height:1.2;margin:0 0 1mm}.report-print-footer{position:absolute;bottom:1mm;left:0;font-size:8pt}.report-print-audit{break-before:page;font-size:10pt}.report-print-audit li{break-inside:avoid}.report-print-overlay td{border:none!important}`,
  };
}
