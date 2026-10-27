import { afterAll, beforeAll, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import { annual, seedFullYear, confirmFixture } from './fixture';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import { statementSnapshot } from '../../templates/nonprofit/layout';
import { nonprofitWorkbookBase64 } from '../../templates/nonprofit/export.server';
import { nonprofitPrintHtml } from '../../templates/nonprofit/print';
import { coordinates } from '../../shared';
import type { Configuration } from '../../templates/nonprofit/model';

let book: TestBook, c: Configuration;
beforeAll(async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  c = await confirmFixture(book.svc, await seedFullYear(book.svc));
});
afterAll(async () => book?.close());
for (const code of ['401', '402', '403'] as const)
  it(`w_bb_saveas ${code}真实xlsx逐金额格回读、合并、格式及A4重复表头；同一快照打印`, async () => {
    const { statement } = await generateNonprofit(book.svc, { ...annual, code }, c);
    const snapshot = statementSnapshot(statement, {
      id: 1,
      reportId: Number(code),
      revision: 1,
      generatedAt: '2026-12-31T23:59:59Z',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Uint8Array.from(Buffer.from(await nonprofitWorkbookBase64(snapshot), 'base64')).buffer,
    );
    const sheet = wb.worksheets[0]!;
    expect(sheet.pageSetup.paperSize).toBe(9);
    expect(sheet.pageSetup.orientation).toBe(code === '402' ? 'landscape' : 'portrait');
    expect(sheet.pageSetup.printTitlesRow).toBe('1:4');
    expect(sheet.getCell('A2').value).toBe('编制单位：测试单位有限公司');
    expect(sheet.getCell('A3').value).toContain('202601至202612');
    for (const cell of snapshot.cells) {
      const { row, col } = coordinates(cell.address);
      if (cell.unit === 'cents') {
        expect(typeof sheet.getCell(row, col).value).toBe('number');
        expect(sheet.getCell(row, col).value).toBe(Number(cell.value) / 100);
        expect(sheet.getCell(row, col).numFmt).toBe('#,##0.00');
      } else expect(sheet.getCell(row, col).value).toBe(cell.value);
    }
    expect(sheet.getCell('A1').isMerged).toBe(true);
    expect(sheet.getColumn(1).width).toBeGreaterThan(30);
    const html = nonprofitPrintHtml(snapshot);
    expect(html).toContain('@page{size:A4');
    expect(html).toContain('table-header-group');
    expect(html).toContain('测试单位有限公司');
    expect(html).toContain(statement.rows.at(-1)!.label);
    if (code === '402') for (const label of statement.columns) expect(html).toContain(label);
    if (code === '403') expect(html).toContain('不要求填列（2026年首次执行）');
    const failed = structuredClone(snapshot);
    failed.checks[0]!.status = 'fail';
    await expect(nonprofitWorkbookBase64(failed)).rejects.toThrow(/勾稽未通过/);
    expect(() => nonprofitPrintHtml(failed)).toThrow(/勾稽尚未通过/);
  });
