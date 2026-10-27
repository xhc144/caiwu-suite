import ExcelJS from 'exceljs';
import type { ReportSnapshot } from '../../shared';
import { workbookBase64 } from '../../server/export';

/** 公共输出入口验证绑定后调用；Excel与打印均使用同一份已保存快照。 */
export async function nonprofitWorkbookBase64(s: ReportSnapshot) {
  if (s.checks.some((c) => c.status !== 'pass')) throw new Error('报表勾稽未通过，请修正后再导出');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(await workbookBase64(s), 'base64')).buffer);
  const sheet = wb.worksheets[0]!;
  sheet.name = s.template.name;
  sheet.pageSetup = {
    paperSize: 9,
    orientation: s.template.cols > 4 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:4',
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
  };
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  const meta = wb.getWorksheet('口径与审核');
  if (meta) {
    meta.eachRow((row) => {
      if (row.getCell(1).value === '金额规则')
        row.getCell(2).value = '人民币元，保留两位小数；仅已过账';
      if (row.getCell(1).value === '审核项') row.getCell(3).value = '差额（元）';
      if (
        row.number > 9 &&
        typeof row.getCell(3).value === 'string' &&
        /^-?\d+$/.test(String(row.getCell(3).value))
      )
        row.getCell(3).value = Number(row.getCell(3).value) / 100;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
