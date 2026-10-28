export type ImportFile = { headers: string[]; rows: string[][] };

/** 读取带引号、引号内换行的 CSV/制表符文本；只取单元格文字，不执行公式。 */
export function parseDelimited(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closedQuote = true;
      } else value += c;
    } else if (c === '"') {
      if (value || closedQuote) throw new Error('引号位置不正确，请检查文本格式');
      quoted = true;
    } else if (c === delimiter) {
      row.push(value);
      value = '';
      closedQuote = false;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      closedQuote = false;
    } else {
      if (closedQuote && c.trim()) throw new Error('引号后有多余文字，请检查文本格式');
      if (!closedQuote) value += c;
    }
  }
  if (quoted) throw new Error('引号未闭合，请检查文本格式');
  if (row.length || value || closedQuote) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

export function normalizeImportGrid(grid: string[][]): ImportFile {
  const [headers, ...rows] = grid;
  if (!headers?.some((c) => c.trim()) || !rows.some((r) => r.some((c) => c.trim())))
    throw new Error('文件没有可导入的数据；第一行应为列标题，第二行起为单据');
  if (headers.length > 60 || rows.some((r) => r.length > 60))
    throw new Error('文件超过六十列，请仅保留需要导入的列');
  if (rows.length > 1000) throw new Error('文件超过一千行，请分成多个文件导入');
  if (grid.some((r) => r.some((c) => c.length > 2000)))
    throw new Error('单元格文字超过两千字，请检查文件');
  return { headers: headers.map((h, i) => h.trim() || `第${i + 1}列`), rows };
}

export async function readImportFile(file: File): Promise<ImportFile> {
  if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，请拆分后导入');
  if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    const bytes = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('gb18030').decode(bytes);
    }
    return normalizeImportGrid(parseDelimited(text));
  }
  if (!/\.xlsx$/i.test(file.name))
    throw new Error('请选择 .xlsx、.csv、.tsv 或 .txt 文件；旧版 .xls 请先另存为 .xlsx');
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('工作簿无法读取，请确认文件完整，或另存为 .xlsx 后重试');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('工作簿没有工作表');
  if (sheet.rowCount > 1001 || sheet.columnCount > 60)
    throw new Error('工作表超过一千行或六十列，请拆分后导入');
  const grid: string[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = sheet.getCell(r, c);
      const value = cell.value;
      row.push(value instanceof Date ? value.toISOString().slice(0, 10) : cell.text);
    }
    grid.push(row);
  }
  return normalizeImportGrid(grid);
}
