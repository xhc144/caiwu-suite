import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import {
  columnName,
  coordinates,
  PrintSettingsSchema,
  METRIC_LABELS,
  UNIT_LABELS,
  type ReportSnapshot,
} from '../shared';

/** 原始内容只写成字符串；白名单公式写入注释，绝不作为Excel可执行公式。 */
export async function workbookBase64(snapshot: ReportSnapshot) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('期间报表');
  const print = PrintSettingsSchema.parse(snapshot.template.print ?? {});
  ws.properties.defaultRowHeight = 27;
  ws.properties.defaultColWidth = 160 / 7;
  ws.pageSetup = {
    paperSize: { A4: 9, A5: 11, B5: 13 }[print.paperSize],
    orientation: print.orientation,
    margins: {
      left: print.marginMm / 25.4,
      right: print.marginMm / 25.4,
      top: print.marginMm / 25.4,
      bottom: print.marginMm / 25.4,
      header: 0,
      footer: 0,
    },
    fitToPage: print.mode !== 'overlay',
    fitToWidth: 1,
    fitToHeight: 0,
    scale: 100,
    showGridLines: print.mode !== 'overlay' && print.showGrid,
    printArea: `A1:${columnName(snapshot.template.cols)}${snapshot.template.rows}`,
    ...(print.repeatRows > 0 ? { printTitlesRow: `1:${print.repeatRows}` } : {}),
  };
  if (print.mode !== 'overlay')
    ws.headerFooter.oddFooter = `&L${snapshot.template.name.replace(/&/g, '&&')}  ${snapshot.period}&R第 &P / &N 页`;
  for (const row of print.rowBreaks) ws.getRow(row - 1).addPageBreak();
  for (const { row, height } of snapshot.template.rowHeights) ws.getRow(row).height = height * 0.75;
  for (const { col, width } of snapshot.template.colWidths) ws.getColumn(col).width = width / 7;
  for (const c of snapshot.cells) {
    const { row, col } = coordinates(c.address);
    const out = ws.getCell(row, col);
    out.font = { name: '宋体', size: 11 };
    if (c.unit === 'text') out.value = c.value;
    else {
      const n = new Decimal(c.value);
      const display = ['cents', 'foreignCents'].includes(c.unit) ? n.div(100) : n;
      // Excel只保证15位有效数字；超过时保留精确文本。
      out.value = display.sd() > 15 ? display.toFixed() : display.toNumber();
      if (['cents', 'foreignCents'].includes(c.unit)) out.numFmt = '#,##0.00';
    }
    const definition = snapshot.template.cells.find((d) => d.address === c.address);
    if (definition?.kind === 'formula') out.note = `报表白名单公式（数据）：${definition.source}`;
  }
  for (const s of snapshot.template.styles) {
    const c = ws.getCell(s.address);
    c.alignment = { horizontal: s.align, wrapText: s.wrap };
    c.font = {
      name: s.fontFamily ?? '宋体',
      size: s.fontSize ?? 11,
      bold: s.bold,
      italic: s.italic ?? false,
      underline: s.underline ?? false,
      color: { argb: `FF${(s.color ?? '#000000').slice(1).toUpperCase()}` },
    };
    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
    if (sides.some((side) => s[`border${side}`] !== undefined)) {
      // 白底使 Excel 的打印网格线不穿过显式清除的边，再补其余默认网格边。
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      c.border = Object.fromEntries(
        sides.flatMap((side) => {
          const style = s[`border${side}`] ?? (print.showGrid ? 'thin' : 'none');
          return style !== 'none'
            ? [[side.toLowerCase(), { style, color: { argb: 'FF000000' } }]]
            : [];
        }),
      );
    }
    if (s.format === 'decimal2') c.numFmt = '#,##0.00';
    if (s.format === 'percent') c.numFmt = '0.00%';
  }
  for (const m of snapshot.template.merges)
    ws.mergeCells(m.row, m.col, m.row + m.rows - 1, m.col + m.cols - 1);
  const meta = wb.addWorksheet('口径与审核');
  meta.addRows([
    ['名称', snapshot.template.name],
    ['期间', snapshot.period],
    ['取数口径', snapshot.includeUnposted ? '含待审核和已审核（不含草稿/作废）' : '仅已过账'],
    ['生成时未过账凭证数', snapshot.unpostedCount],
    ['生成时间', snapshot.generatedAt],
    ['定义版本', snapshot.revision],
    ['纸张', print.paperSize],
    ['纸张方向', print.orientation === 'portrait' ? '纵向' : '横向'],
    ['页边距（毫米）', print.marginMm],
    ['行前分页', print.rowBreaks.join('、')],
    ['重复标题行', print.repeatRows ? `1至${print.repeatRows}行` : '无'],
    ['打印方式', print.mode === 'overlay' ? '套打；电子表格保留完整报表内容' : '普通打印'],
    ['套打横向偏移（毫米）', print.offsetXmm],
    ['套打纵向偏移（毫米）', print.offsetYmm],
    ['金额规则', '借正贷负；原值为分，显示元；金额单元格四舍五入至分'],
    ['审核项', '结果', '差额（金额为分）', '阈值', '原因'],
    ...snapshot.checks.map((c) => [
      c.name,
      c.status === 'pass' ? '通过' : c.status === 'fail' ? '不通过' : '错误',
      c.difference ?? '',
      c.tolerance,
      c.condition !== undefined ? `${c.condition}；${c.reason ?? ''}` : (c.reason ?? ''),
    ]),
    ['依赖报表编码', '定义版本'],
    ...snapshot.dependencies.map((d) => [d.code, d.revision]),
    [
      '取数报表',
      '单元格',
      '科目',
      '指标',
      '开始期间',
      '结束期间',
      '币种',
      '辅助类型',
      '辅助编码',
      '取数值',
      '单位',
    ],
    ...(snapshot.sources ?? []).map((trace) => [
      trace.reportCode,
      trace.address,
      trace.input.account,
      METRIC_LABELS[trace.input.metric],
      trace.periodFrom,
      trace.periodTo,
      trace.input.currency,
      {
        none: '无',
        project: '项目',
        partner: '客户/供应商',
        department: '部门',
        person: '个人',
        cashflow: '现金流量项目',
      }[trace.input.dimension],
      trace.input.item,
      ['cents', 'foreignCents'].includes(trace.input.unit)
        ? new Decimal(trace.value).div(100).toFixed(2)
        : trace.value,
      UNIT_LABELS[trace.input.unit],
    ]),
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
