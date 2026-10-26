import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { coordinates, type ReportSnapshot } from '../shared';

/** 原始内容只写成字符串；白名单公式写入注释，绝不作为Excel可执行公式。 */
export async function workbookBase64(snapshot: ReportSnapshot) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('期间报表');
  for (const { row, height } of snapshot.template.rowHeights) ws.getRow(row).height = height * 0.75;
  for (const { col, width } of snapshot.template.colWidths) ws.getColumn(col).width = width / 7;
  for (const c of snapshot.cells) {
    const { row, col } = coordinates(c.address);
    const out = ws.getCell(row, col);
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
    c.font = { bold: s.bold };
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
    ['金额规则', '借正贷负；原值为分，显示元；金额单元格四舍五入至分'],
    ['审核项', '结果', '差额（金额为分）', '阈值', '原因'],
    ...snapshot.checks.map((c) => [
      c.name,
      c.status === 'pass' ? '通过' : c.status === 'fail' ? '不通过' : '错误',
      c.difference ?? '',
      c.tolerance,
      c.reason ?? '',
    ]),
    ['依赖报表编码', '定义版本'],
    ...snapshot.dependencies.map((d) => [d.code, d.revision]),
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
