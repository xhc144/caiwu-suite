import ExcelJS from 'exceljs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderPrintDocument } from '@caiwu/print';
import {
  emptyTemplate,
  PrintSettingsSchema,
  StyleSchema,
  type ReportSnapshot,
  type PrintSettings,
} from '../shared';
import { reportHtml, reportPrintJob, reportPrintLayout } from '../web/print';
import { workbookBase64 } from '../server/export';

function snapshot(rows = 6, cols = 2, print?: Partial<PrintSettings>): ReportSnapshot {
  const template = emptyTemplate({ code: '101', name: '报表<&标题', rows, cols });
  if (print) template.print = PrintSettingsSchema.parse(print);
  template.cells = [
    { address: 'A1', kind: 'text', source: '预印标题<script>', unit: 'number', currency: 'CNY' },
    { address: 'A2', kind: 'money', source: '12345', unit: 'cents', currency: 'CNY' },
  ];
  return {
    id: 1,
    reportId: 1,
    revision: 2,
    period: 202601,
    includeUnposted: false,
    unpostedCount: 0,
    generatedAt: '2026-01-31T08:00:00.000Z',
    template,
    cells: [
      { address: 'A1', value: '预印标题<script>', unit: 'text', currency: 'CNY' },
      { address: 'A2', value: '12345', unit: 'cents', currency: 'CNY' },
    ],
    checks: [],
    dependencies: [],
  };
}

async function workbook(s: ReportSnapshot) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(await workbookBase64(s), 'base64')).buffer);
  return wb;
}

/** ExcelJS 的读取器不回读手工分页；直接核对交付 xlsx 内的工作表 XML。 */
function xlsxPart(base64: string, name: string) {
  const zip = Buffer.from(base64, 'base64');
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  for (let at = zip.indexOf(signature); at >= 0; at = zip.indexOf(signature, at + 4)) {
    const length = zip.readUInt16LE(at + 28);
    if (zip.toString('utf8', at + 46, at + 46 + length) !== name) continue;
    const start = zip.readUInt32LE(at + 42);
    const dataStart = start + 30 + zip.readUInt16LE(start + 26) + zip.readUInt16LE(start + 28);
    const data = zip.subarray(dataStart, dataStart + zip.readUInt32LE(at + 20));
    return (zip.readUInt16LE(at + 10) === 8 ? inflateRawSync(data) : data).toString('utf8');
  }
  throw new Error(`导出文件缺少 ${name}`);
}

describe('w_bb_def / w_bb_def_gs 分页、打印标题与套打输出', () => {
  it('没有新增打印字段的历史快照仍可打印，内容转义并按元显示', () => {
    const s = snapshot();
    const job = reportPrintJob(s);
    expect(job).toMatchObject({ pageSize: 'A4', orientation: 'portrait', marginMm: 10 });
    expect(job.html).toContain('预印标题&lt;script&gt;');
    expect(job.html).toContain('123.45');
    expect(job.html).toContain('报表&lt;&amp;标题');
    expect(() => renderPrintDocument(job)).not.toThrow();
    expect(s.template.print).toBeUndefined();
  });

  it('设置行前分页线，每页重复打印前面的标题行，正文既不遗漏也不重复', () => {
    const s = snapshot(6, 2, { rowBreaks: [4], repeatRows: 1 });
    const layout = reportPrintLayout(s);
    expect(layout.pages).toEqual([
      [1, 2, 3],
      [1, 4, 5, 6],
    ]);
    const html = reportHtml(s);
    expect(html.match(/data-report-page=/g)).toHaveLength(2);
    expect(html.match(/预印标题&lt;script&gt;/g)).toHaveLength(2);
    expect(html.match(/123\.45/g)).toHaveLength(1);
    expect(html).toContain('报表第 2 / 2 页');
  });

  it('按实际行高自动分页并保持跨行合并完整，重复行占用各页高度', () => {
    const s = snapshot(8, 2, { repeatRows: 1 });
    s.template.rowHeights = Array.from({ length: 8 }, (_, i) => ({ row: i + 1, height: 200 }));
    s.template.merges = [{ row: 3, col: 2, rows: 3, cols: 1 }];
    const pages = reportPrintLayout(s).pages;
    expect(pages).toEqual([
      [1, 2],
      [1, 3, 4, 5],
      [1, 6, 7, 8],
    ]);
    expect(pages.flatMap((page) => page.slice(1))).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('单个合并区域或重复标题超过纸张时明确报错，不输出截断的报表', () => {
    const s = snapshot(8, 2);
    s.template.rowHeights = Array.from({ length: 8 }, (_, i) => ({ row: i + 1, height: 200 }));
    s.template.merges = [{ row: 2, col: 2, rows: 5, cols: 1 }];
    expect(() => reportHtml(s)).toThrow(/第2至6行超过一页/);
    s.template.merges = [];
    s.template.print = PrintSettingsSchema.parse({ repeatRows: 5 });
    expect(() => reportHtml(s)).toThrow(/重复打印标题行超过/);
  });

  it('普通打印适配纸张宽度，字体、边框、行高列宽都进入输出', () => {
    const s = snapshot(6, 6, { paperSize: 'A5', orientation: 'landscape', showGrid: false });
    s.template.styles = [
      StyleSchema.parse({
        address: 'A2',
        align: 'right',
        fontFamily: '楷体',
        fontSize: 18,
        italic: true,
        underline: true,
        color: '#1122AA',
        borderBottom: 'double',
        borderTop: 'none',
      }),
    ];
    const layout = reportPrintLayout(s);
    expect(layout.scale).toBeLessThan(1);
    expect(layout.tableWidth).toBeCloseTo(layout.printableWidth);
    const job = reportPrintJob(s);
    expect(job.html).toContain('font-family:楷体');
    expect(job.html).toContain('font-style:italic');
    expect(job.html).toContain('text-decoration:underline');
    expect(job.html).toContain('color:#1122AA');
    expect(job.html).toContain('border-bottom:2pt double #000');
    expect(job.html).toContain('border-top:none');
    expect(() => renderPrintDocument(job)).not.toThrow();
  });

  it('套打只输出数值，使用原始尺寸、毫米偏移，不输出静态文字或审核页', () => {
    const s = snapshot(6, 2, { mode: 'overlay', offsetXmm: 3, offsetYmm: -2, rowBreaks: [4] });
    s.checks = [{ name: '审核内容', status: 'pass', difference: '0', tolerance: '0' }];
    const layout = reportPrintLayout(s);
    expect(layout.scale).toBe(1);
    expect(layout.colWidths[0]).toBeCloseTo((160 * 25.4) / 96);
    expect(layout.rowHeights[0]).toBeCloseTo((36 * 25.4) / 96);
    const job = reportPrintJob(s);
    expect(job.html).toContain('left:3mm;top:-2mm');
    expect(job.html).toContain('123.45');
    expect(job.html).not.toContain('预印标题');
    expect(job.html).not.toContain('报表&lt;&amp;标题');
    expect(job.html).not.toContain('审核内容');
    expect(job.html).toContain('border:none;padding:0');
    expect(() => renderPrintDocument(job)).not.toThrow();
  });

  it('套打位置超出纸张或宽度不适合时提示调整，不自动缩放破坏定位', () => {
    expect(() => reportHtml(snapshot(6, 2, { mode: 'overlay', offsetXmm: -11 }))).toThrow(
      /超出纸张/,
    );
    expect(() => reportHtml(snapshot(6, 6, { mode: 'overlay' }))).toThrow(/原始列宽超过套打纸张/);
  });
});

describe('w_bb_saveas 字体、边框和打印设置导出', () => {
  it('真实xlsx保留字体颜色、四边框、纸张、手动分页与重复标题行', async () => {
    const s = snapshot(6, 2, {
      paperSize: 'A5',
      orientation: 'landscape',
      marginMm: 12.7,
      rowBreaks: [4],
      repeatRows: 1,
    });
    s.template.styles = [
      StyleSchema.parse({
        address: 'A2',
        fontFamily: '仿宋',
        fontSize: 16,
        bold: true,
        italic: true,
        underline: true,
        color: '#1133aa',
        borderTop: 'thin',
        borderRight: 'medium',
        borderBottom: 'double',
        borderLeft: 'dashed',
      }),
    ];
    s.template.rowHeights = [{ row: 2, height: 80 }];
    s.template.colWidths = [{ col: 1, width: 210 }];
    const wb = await workbook(s);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A2').font).toMatchObject({
      name: '仿宋',
      size: 16,
      bold: true,
      italic: true,
      underline: true,
      color: { argb: 'FF1133AA' },
    });
    expect(ws.getCell('A2').border).toMatchObject({
      top: { style: 'thin' },
      right: { style: 'medium' },
      bottom: { style: 'double' },
      left: { style: 'dashed' },
    });
    expect(ws.pageSetup).toMatchObject({
      paperSize: 11,
      orientation: 'landscape',
      margins: { left: 0.5, top: 0.5 },
      printArea: 'A1:B6',
      printTitlesRow: '1:1',
      fitToPage: true,
    });
    const xml = xlsxPart(await workbookBase64(s), 'xl/worksheets/sheet1.xml');
    expect(xml).toMatch(/<rowBreaks[^>]*>.*<brk id="3"[^>]*man="1"/);
    expect(ws.getRow(2).height).toBe(60);
    expect(ws.getColumn(1).width).toBe(30);
    expect(ws.getCell('A2').value).toBe(123.45);
  });

  it('套打设置保存在元数据；电子表格继续保留完整文本数据', async () => {
    const s = snapshot(6, 2, { mode: 'overlay', offsetXmm: 2, offsetYmm: 3 });
    const wb = await workbook(s);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('预印标题<script>');
    expect(ws.pageSetup).toMatchObject({ fitToPage: false, scale: 100 });
    expect(Boolean(ws.pageSetup.showGridLines)).toBe(false);
    const meta = wb.getWorksheet('口径与审核')!;
    const rows: unknown[] = [];
    meta.eachRow((row) => rows.push(row.values));
    expect(rows).toContainEqual([undefined, '套打横向偏移（毫米）', 2]);
    expect(rows).toContainEqual([undefined, '套打纵向偏移（毫米）', 3]);
  });

  it('显式清除一条边时，其余默认网格边仍保留，清除边不被打印网格线补回', async () => {
    const s = snapshot();
    s.template.styles = [StyleSchema.parse({ address: 'A2', borderTop: 'none' })];
    const ws = (await workbook(s)).worksheets[0]!;
    expect(ws.getCell('A2').border.top?.style).toBeUndefined();
    expect(ws.getCell('A2').border.bottom?.style).toBe('thin');
    expect(ws.getCell('A2').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFFFF' },
    });
  });
});
