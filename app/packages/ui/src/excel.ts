import { centsToYuan } from '@caiwu/core';

export interface ExcelColumn<T> {
  title: string;
  /** 取值；money 列返回分 */
  value: (row: T) => string | number | null | undefined;
  money?: boolean;
  width?: number;
}

/**
 * 导出 Excel（.xlsx）并触发下载。金额列写成数字（元）并带千分位格式，方便在 Excel 里继续计算。
 * exceljs 按需加载，不进首屏。
 */
export async function exportToExcel<T>(opts: {
  fileName: string;
  sheetName?: string;
  title?: string;
  columns: ExcelColumn<T>[];
  rows: readonly T[];
}) {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  const ws = wb.addWorksheet(opts.sheetName ?? 'Sheet1');
  let rowIndex = 1;
  if (opts.title) {
    ws.addRow([opts.title]).font = { bold: true, size: 14 };
    ws.mergeCells(1, 1, 1, Math.max(1, opts.columns.length));
    rowIndex++;
  }
  const header = ws.addRow(opts.columns.map((c) => c.title));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F2F5' } };
  });
  for (const r of opts.rows) {
    ws.addRow(
      opts.columns.map((c) => {
        const v = c.value(r);
        if (c.money && typeof v === 'number') return Number(centsToYuan(v));
        return v ?? '';
      }),
    );
  }
  opts.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(10, c.title.length * 2 + 2);
    if (c.money) col.numFmt = '#,##0.00;[Red]-#,##0.00';
  });
  ws.views = [{ state: 'frozen', ySplit: rowIndex }];
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${opts.fileName}.xlsx`,
  );
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
