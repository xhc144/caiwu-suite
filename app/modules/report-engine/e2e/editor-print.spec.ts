import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { renderPrintDocument } from '@caiwu/print';
import { emptyTemplate, PrintSettingsSchema, StyleSchema, type ReportSnapshot } from '../shared';
import { reportPrintJob, reportPrintLayout } from '../web/print';

function snapshot(rows: number): ReportSnapshot {
  const template = emptyTemplate({ code: '101', name: '打印排版测试', rows, cols: 2 });
  template.print = PrintSettingsSchema.parse({ repeatRows: 1 });
  template.cells = Array.from({ length: rows }, (_, i) => ({
    address: `A${i + 1}`,
    kind: i === 0 ? 'text' : 'money',
    source: i === 0 ? '重复标题行' : String(100_000 + i),
    unit: i === 0 ? 'number' : 'cents',
    currency: 'CNY',
  }));
  return {
    id: 1,
    reportId: 1,
    revision: 1,
    period: 202601,
    generatedAt: '2026-01-31T00:00:00.000Z',
    includeUnposted: false,
    unpostedCount: 0,
    template,
    cells: template.cells.map((c) => ({
      address: c.address,
      value: c.source,
      unit: c.kind === 'text' ? 'text' : c.unit,
      currency: c.currency,
    })),
    checks: [],
    dependencies: [],
  };
}

test('w_bb_def 真实PDF按手工分页并重复标题，字体边框及页面不溢出', async ({ page }, info) => {
  const s = snapshot(30);
  s.template.print = PrintSettingsSchema.parse({ repeatRows: 1, rowBreaks: [12] });
  s.template.styles = [
    StyleSchema.parse({
      address: 'A2',
      fontFamily: '楷体',
      fontSize: 18,
      color: '#112233',
      borderBottom: 'double',
    }),
  ];
  await page.setContent(renderPrintDocument(reportPrintJob(s)));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.report-print-page')).toHaveCount(2);
  await expect(page.getByText('重复标题行', { exact: true })).toHaveCount(2);
  const geometry = await page.locator('.report-print-page').evaluateAll((pages) =>
    pages.map((el) => {
      const page = el.getBoundingClientRect();
      const table = el.querySelector('table')!.getBoundingClientRect();
      const footer = el.querySelector('footer')!.getBoundingClientRect();
      return { rightGap: page.right - table.right, bottomGap: footer.top - table.bottom };
    }),
  );
  for (const g of geometry) {
    expect(g.rightGap).toBeGreaterThanOrEqual(-1);
    expect(g.bottomGap).toBeGreaterThanOrEqual(-1);
  }
  const target = info.outputPath('editor-manual-pages.pdf');
  await page.pdf({ path: target, preferCSSPageSize: true, printBackground: true });
  expect(execFileSync('pdfinfo', [target], { encoding: 'utf8' })).toMatch(/Pages:\s+2/);
  const text = execFileSync('pdftotext', ['-layout', target, '-'], { encoding: 'utf8' });
  expect(text.match(/重复标题行/g)).toHaveLength(2);
  for (let i = 1; i < 30; i++) expect(text).toContain((1000 + i / 100).toFixed(2));
});

test('w_bb_def 跨行合并不会被自动分页切开，真实PDF逐行保留结果', async ({ page }, info) => {
  const s = snapshot(8);
  s.template.rowHeights = Array.from({ length: 8 }, (_, i) => ({ row: i + 1, height: 200 }));
  s.template.merges = [{ row: 3, col: 2, rows: 3, cols: 1 }];
  expect(reportPrintLayout(s).pages).toEqual([
    [1, 2],
    [1, 3, 4, 5],
    [1, 6, 7, 8],
  ]);
  await page.setContent(renderPrintDocument(reportPrintJob(s)));
  const target = info.outputPath('editor-automatic-pages.pdf');
  await page.pdf({ path: target, preferCSSPageSize: true });
  expect(execFileSync('pdfinfo', [target], { encoding: 'utf8' })).toMatch(/Pages:\s+3/);
  const text = execFileSync('pdftotext', ['-layout', target, '-'], { encoding: 'utf8' });
  for (let i = 1; i < 8; i++) expect(text).toContain((1000 + i / 100).toFixed(2));
});

test('w_bb_def_gs 真实套打PDF保持毫米尺寸和偏移，仅输出数值', async ({ page }, info) => {
  const s = snapshot(6);
  s.template.print = PrintSettingsSchema.parse({ mode: 'overlay', offsetXmm: 3, offsetYmm: -2 });
  await page.setContent(renderPrintDocument(reportPrintJob(s)));
  const geometry = await page.locator('.report-print-page').evaluate((el) => {
    const p = el.getBoundingClientRect();
    const t = el.querySelector('table')!.getBoundingClientRect();
    const r = el.querySelector('tr')!.getBoundingClientRect();
    return { x: t.left - p.left, y: t.top - p.top, width: t.width, rowHeight: r.height };
  });
  expect(geometry.x).toBeCloseTo((3 * 96) / 25.4, 0);
  expect(geometry.y).toBeCloseTo((-2 * 96) / 25.4, 0);
  expect(geometry.width).toBeCloseTo(320, 0);
  expect(geometry.rowHeight).toBeCloseTo(36, 0);
  const target = info.outputPath('editor-overlay.pdf');
  await page.pdf({ path: target, preferCSSPageSize: true });
  expect(execFileSync('pdfinfo', [target], { encoding: 'utf8' })).toMatch(/Pages:\s+1/);
  const text = execFileSync('pdftotext', ['-layout', target, '-'], { encoding: 'utf8' });
  expect(text).not.toContain('重复标题行');
  expect(text).not.toContain('打印排版测试');
  expect(text).not.toContain('202601');
  expect(text).toContain('1000.01');
});

test('w_bb_proc 审核差额单独成页，真实PDF保留原因且不添加空白页', async ({ page }, info) => {
  const s = snapshot(6);
  s.checks = [
    { name: '资产负债核对', status: 'fail', difference: '123', tolerance: '0' },
    {
      name: '利润核对',
      status: 'error',
      difference: null,
      tolerance: '0',
      reason: '引用的报表不存在',
    },
  ];
  await page.setContent(renderPrintDocument(reportPrintJob(s)));
  const target = info.outputPath('editor-checks.pdf');
  await page.pdf({ path: target, preferCSSPageSize: true });
  expect(execFileSync('pdfinfo', [target], { encoding: 'utf8' })).toMatch(/Pages:\s+2/);
  const text = execFileSync('pdftotext', ['-layout', target, '-'], { encoding: 'utf8' });
  expect(text).toContain('资产负债核对');
  expect(text).toContain('不通过');
  expect(text).toContain('引用的报表不存在');
});
