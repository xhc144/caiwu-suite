import { it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { calculateEnterprise } from '../../templates/enterprise/calculate';
import { enterpriseWorkbookBase64 } from '../../templates/enterprise/output.server';
import { enterprisePages, enterprisePrintHtml } from '../../templates/enterprise/output';
import { fixture } from './fixture';
it('w_bb_saveas xlsx金额为数值，完整权益分组、重复表头与A4设置', async () => {
  const { c, d } = fixture(),
    r = calculateEnterprise(c, d),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    Uint8Array.from(Buffer.from(await enterpriseWorkbookBase64(r), 'base64')).buffer,
  );
  expect(wb.worksheets).toHaveLength(14);
  const bs = wb.worksheets[0]!;
  expect(bs.getCell('B5').value).toBe(2200);
  expect(bs.pageSetup.paperSize).toBe(9);
  expect(bs.pageSetup.printTitlesRow).toBe('1:3');
  expect(wb.worksheets.filter((w) => w.pageSetup.orientation === 'landscape')).toHaveLength(6);
  const pages = enterprisePages(r);
  expect(pages.filter((p) => p.title.startsWith('所有者权益变动表'))).toHaveLength(6);
  const html = enterprisePrintHtml(r, 'equity');
  expect(html).toContain('实收资本（或股本）');
  expect(html).toContain('其他权益工具·优先股');
  expect(html).toContain('其他权益工具·永续债');
  expect(html).toContain('所有者权益合计');
  expect(html).toContain('本年年末余额');
});
