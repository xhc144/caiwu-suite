import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { enterprisePages } from './output';
import type { EnterpriseResult } from './model';
/** 传入公共事务已保存、来源门禁复核通过的同一成功结果。 */
export async function enterpriseWorkbookBase64(result: EnterpriseResult) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '财务报表';
  for (const [i, page] of enterprisePages(result).entries()) {
    const ws = wb.addWorksheet(`${i + 1}${page.title}`.slice(0, 31), {
      pageSetup: {
        paperSize: 9,
        orientation: page.landscape ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        margins: { left: 0.35, right: 0.35, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
    });
    ws.addRow([page.title]);
    ws.mergeCells(1, 1, 1, page.headers.length);
    ws.addRow([`编制单位：${page.orgName} ${page.period} 单位：元`]);
    ws.mergeCells(2, 1, 2, page.headers.length);
    ws.addRow(page.headers);
    ws.pageSetup.printTitlesRow = '1:3';
    ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 1 }];
    for (const cells of page.rows) {
      const row = ws.addRow(
        cells.map((c) => {
          if (!c.amount || c.value === '不适用') return c.value;
          const n = c.eps ? new Decimal(c.value) : new Decimal(c.value).div(100);
          if (n.sd() > 15)
            throw new Error('金额超过Excel精确数值位数，不能静默舍入，请调整报告单位');
          return n.toNumber();
        }),
      );
      cells.forEach((c, j) => {
        const x = row.getCell(j + 1);
        x.font = { bold: c.bold ?? false, size: 10 };
        x.alignment = {
          vertical: 'middle',
          wrapText: true,
          horizontal: c.amount ? 'right' : 'left',
        };
        if (c.amount) x.numFmt = c.eps ? '0.0000' : '#,##0.00';
        x.border = { bottom: { style: 'hair' } };
      });
      row.height = page.landscape ? 22 : 30;
    }
    for (let j = 1; j <= page.headers.length; j++)
      ws.getColumn(j).width =
        j === 1 ? (page.landscape ? 42 : 40) : page.headers.length === 6 && j === 4 ? 40 : 22;
    ws.getRow(1).font = { bold: true, size: 15 };
    ws.getRow(1).height = 28;
    ws.getRow(2).height = 30;
    ws.getRow(3).height = 30;
  }
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
