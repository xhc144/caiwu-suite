import ExcelJS, { type Cell } from 'exceljs';
import type { ImportReceipt } from '../shared';
import type { ImportPayload, SourceRow } from './normalize';

export type ImportKind = 'accounts' | 'dimensions' | 'opening' | 'vouchers';
export type FileIssue = {
  sheet: string;
  row: number;
  column: string;
  message: string;
  severity: 'error' | 'warning';
};
export type ImportSheet = {
  name: string;
  kind: ImportKind;
  headerRow?: number;
  headers: string[];
  rows: { row: number; cells: string[] }[];
};
export type ParsedImportFile = { sheets: ImportSheet[]; issues: FileIssue[] };
export type ImportFile = {
  name: string;
  contentBase64: string;
  encoding?: 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be';
  kind?: ImportKind;
};

export const IMPORT_FILE_LIMITS = {
  bytes: 8 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  rows: 50_000,
  columns: 64,
  cellLength: 4_000,
  sheets: 16,
} as const;

export const IMPORT_COLUMNS: Record<ImportKind, readonly string[]> = {
  accounts: [
    '科目编码',
    '科目名称',
    '科目类别',
    '余额方向',
    '币种',
    '数量单位',
    '项目核算',
    '客供核算',
    '部门核算',
    '个人核算',
    '现金流量核算',
    '现金科目',
    '银行科目',
    '停用',
    '助记码',
    '备抵科目',
    '余额性质',
    '结转用途',
    '往来科目',
  ],
  dimensions: [
    '辅助类型',
    '档案编码',
    '档案名称',
    '上级编码',
    '停用',
    '扩展资料',
    '联系人',
    '电话',
    '地址',
    '邮编',
    '开户银行',
    '银行账号',
    '税号',
    '简称',
    '客供角色',
    '分类名称',
    '现金流量方向',
  ],
  opening: [
    '年度',
    '科目编码',
    '项目编码',
    '客供编码',
    '部门编码',
    '个人编码',
    '币种',
    '期初余额',
    '期初方向',
    '累计借方',
    '累计贷方',
    '外币余额',
    '数量',
  ],
  vouchers: [
    '凭证日期',
    '凭证字',
    '凭证号',
    '附件数',
    '摘要',
    '科目编码',
    '借方金额',
    '贷方金额',
    '项目编码',
    '客供编码',
    '部门编码',
    '个人编码',
    '现金流量编码',
    '现金流量方向',
    '币种',
    '汇率',
    '外币金额',
    '数量',
    '单价',
    '借贷方向',
    '结算方式编码',
    '票号',
    '业务日期',
    '备注',
    '原状态',
    '原制单人',
    '原审核人',
    '原过账人',
  ],
};

const SHEET_NAMES: Record<ImportKind, string> = {
  accounts: '科目',
  dimensions: '辅助档案',
  opening: '期初',
  vouchers: '凭证',
};
const KIND_NAMES: Record<string, ImportKind> = {
  科目: 'accounts',
  科目表: 'accounts',
  会计科目: 'accounts',
  accounts: 'accounts',
  辅助档案: 'dimensions',
  辅助核算: 'dimensions',
  dimensions: 'dimensions',
  期初: 'opening',
  期初余额: 'opening',
  opening: 'opening',
  凭证: 'vouchers',
  凭证分录: 'vouchers',
  vouchers: 'vouchers',
};

function issue(
  result: ParsedImportFile,
  sheet: string,
  row: number,
  column: string,
  message: string,
) {
  result.issues.push({ sheet, row, column, message, severity: 'error' });
}

function columnName(index: number): string {
  let name = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function checkText(text: string): string | null {
  if (text.length > IMPORT_FILE_LIMITS.cellLength) return '单元格内容超过 4000 字，请拆分或精简';
  if (text.includes('\u0000')) return '单元格含有不可识别字符，请检查文本编码';
  // 文本文件不会计算公式；也不把公式样式的内容带入后续导出。
  if (/^\s*[=+@]/u.test(text) && !/^\s*\+\d+(?:\.\d+)?\s*$/u.test(text)) {
    return '不支持公式，请在原表中复制并粘贴为数值或文本后重试';
  }
  return null;
}

class DelimitedReadError extends Error {
  constructor(
    readonly row: number,
    readonly column: number,
    message: string,
  ) {
    super(message);
  }
}

function finishSheet(
  result: ParsedImportFile,
  name: string,
  kind: ImportKind,
  data: { row: number; cells: string[] }[],
) {
  const nonempty = data.filter((r) => r.cells.some((v) => v.trim() !== ''));
  const header = nonempty[0];
  if (!header) {
    issue(result, name, 1, '表头', '没有找到表头，请使用导入模板');
    return;
  }
  const headers = header.cells.map((v) => v.trim());
  while (headers.at(-1) === '') headers.pop();
  if (headers.length > IMPORT_FILE_LIMITS.columns) {
    issue(result, name, header.row, '表头', '数据超过 64 列，请按模板整理');
    return;
  }
  const seen = new Set<string>();
  headers.forEach((h, c) => {
    if (!h) issue(result, name, header.row, columnName(c + 1), '列名不能为空');
    else if (seen.has(h)) issue(result, name, header.row, columnName(c + 1), `列名“${h}”重复`);
    seen.add(h);
  });
  const rows = nonempty.slice(1);
  for (const r of rows) {
    if (r.cells.slice(headers.length).some((v) => v.trim() !== '')) {
      issue(result, name, r.row, columnName(headers.length + 1), '数据超出表头范围，请补齐列名');
    }
    r.cells.forEach((value, c) => {
      const message = checkText(value);
      if (message) issue(result, name, r.row, headers[c] || columnName(c + 1), message);
    });
    r.cells = headers.map((_, c) => r.cells[c] ?? '');
  }
  result.sheets.push({ name, kind, headerRow: header.row, headers, rows });
}

/** 严格读取引号、双引号转义和跨行字段；row 保留源文本的实际起始行。 */
function parseDelimited(text: string, delimiter: string): { row: number; cells: string[] }[] {
  const rows: { row: number; cells: string[] }[] = [];
  let cells: string[] = [],
    value = '',
    quoted = false,
    closed = false;
  let line = 1,
    startLine = 1;
  const pushCell = () => {
    cells.push(value);
    value = '';
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push({ row: startLine, cells });
    if (rows.length > IMPORT_FILE_LIMITS.rows + 1)
      throw new DelimitedReadError(startLine, 1, '文件超过 50000 行，请分批导入');
    cells = [];
    startLine = line + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        if (char === '\r' || char === '\n') {
          if (char === '\r' && text[i + 1] === '\n') i++;
          value += '\n';
          line++;
        } else value += char;
      }
    } else if (char === delimiter) {
      pushCell();
      if (cells.length >= IMPORT_FILE_LIMITS.columns)
        throw new DelimitedReadError(line, cells.length + 1, '数据超过 64 列，请按模板整理');
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      line++;
    } else if (char === '"') {
      if (value !== '' || closed)
        throw new DelimitedReadError(line, cells.length + 1, '双引号位置不正确');
      quoted = true;
    } else {
      if (closed) {
        if (char === ' ' || char === '\t') continue;
        throw new DelimitedReadError(line, cells.length + 1, '引号结束后有多余文字');
      }
      value += char;
    }
    if (value.length > IMPORT_FILE_LIMITS.cellLength)
      throw new DelimitedReadError(line, cells.length + 1, '单元格超过 4000 字');
  }
  if (quoted) throw new DelimitedReadError(startLine, cells.length + 1, '双引号没有闭合');
  if (value !== '' || cells.length || closed) {
    pushCell();
    rows.push({ row: startLine, cells });
    if (rows.length > IMPORT_FILE_LIMITS.rows + 1)
      throw new DelimitedReadError(startLine, 1, '文件超过 50000 行，请分批导入');
  }
  return rows;
}

function delimiterOf(text: string, extension: string): string {
  if (extension === 'tsv') return '\t';
  if (extension === 'csv') return ',';
  // 跳过开头空逻辑行，只统计第一个非空逻辑行中引号外的分隔符。
  let quoted = false;
  let hasContent = false;
  const counts = new Map([
    ['\t', 0],
    [',', 0],
    [';', 0],
  ]);
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        hasContent = true;
        i++;
      } else quoted = !quoted;
    } else if (!quoted) {
      if (c === '\r' || c === '\n') {
        if (hasContent) break;
        for (const delimiter of counts.keys()) counts.set(delimiter, 0);
      } else if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
      else if (c.trim()) hasContent = true;
    } else if (c.trim()) hasContent = true;
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}

/** 加载前检查 ZIP 目录，不解压不可控体积或加密内容。 */
function assertWorkbookZip(bytes: Buffer) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('文件不是完整的 Excel 工作簿，请重新另存为 .xlsx');
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff || count > 2048) {
    throw new Error('工作簿结构过大，请仅保留需要导入的数据表');
  }
  if (offset + size > end) throw new Error('工作簿目录损坏，请重新另存为 .xlsx');
  let cursor = offset,
    expanded = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('工作簿目录损坏，请重新另存为 .xlsx');
    }
    if (bytes.readUInt16LE(cursor + 8) & 1) throw new Error('不支持加密工作簿，请移除密码后重试');
    expanded += bytes.readUInt32LE(cursor + 24);
    if (expanded > IMPORT_FILE_LIMITS.expandedBytes)
      throw new Error('工作簿展开后超过 64 MB，请分批导入');
    cursor +=
      46 +
      bytes.readUInt16LE(cursor + 28) +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  if (cursor !== offset + size) throw new Error('工作簿目录损坏，请重新另存为 .xlsx');
}

function cellText(cell: Cell): string {
  const value = cell.value;
  if (value == null) return '';
  if (cell.isMerged) throw new Error('不支持合并单元格，请取消合并并逐行补齐');
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('日期无效，请改为 YYYY-MM-DD 格式');
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value)
      throw new Error('不支持公式，请先粘贴为数值');
    if ('error' in value) throw new Error('单元格有计算错误，请修正后重试');
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('hyperlink' in value) return value.text;
    throw new Error('单元格类型不受支持，请改为数值或文本');
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('数值无效');
    if (Math.abs(value) >= 1e15) throw new Error('数值超过 Excel 精确位数，请改为文本后重新导出');
    if (Number.isInteger(value) && value >= 0 && /^0+$/.test(cell.numFmt ?? '')) {
      return String(value).padStart(cell.numFmt.length, '0');
    }
  }
  return String(value);
}

export async function parseImportFile(file: ImportFile): Promise<ParsedImportFile> {
  const result: ParsedImportFile = { sheets: [], issues: [] };
  const name = file.name.trim();
  const fail = (message: string) => {
    issue(result, name, 0, '文件', message);
    return result;
  };
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'bak')
    return fail('SQL Anywhere 物理备份不能作为表格读取，请从原软件导出 Excel 或文本');
  if (extension === 'xls') return fail('不支持旧版 .xls，请用表格软件另存为 .xlsx 或 CSV');
  if (!extension || !['xlsx', 'csv', 'tsv', 'txt'].includes(extension))
    return fail('请选择 .xlsx、.csv、.tsv 或 .txt 文件');
  if (
    !file.contentBase64 ||
    file.contentBase64.length > Math.ceil(IMPORT_FILE_LIMITS.bytes / 3) * 4
  )
    return fail('文件为空或超过 8 MB，请分批导入');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64))
    return fail('文件内容传输不完整，请重新选择文件');
  const bytes = Buffer.from(file.contentBase64, 'base64');
  if (bytes.length > IMPORT_FILE_LIMITS.bytes) return fail('文件超过 8 MB，请分批导入');
  try {
    if (extension !== 'xlsx') {
      if (!file.kind) return fail('请先选择这份文本文件的数据类型');
      let text: string;
      try {
        const encoding =
          bytes[0] === 0xff && bytes[1] === 0xfe
            ? 'utf-16le'
            : bytes[0] === 0xfe && bytes[1] === 0xff
              ? 'utf-16be'
              : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
                ? 'utf-8'
                : (file.encoding ?? 'utf-8');
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      } catch {
        return fail('文本编码不匹配，请选择 UTF-8、GB18030、UTF-16LE 或 UTF-16BE 后重试');
      }
      finishSheet(result, name, file.kind, parseDelimited(text, delimiterOf(text, extension)));
      return result;
    }
    assertWorkbookZip(bytes);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
    } catch {
      return fail('工作簿读取失败，请重新另存为 .xlsx 后重试');
    }
    if (workbook.worksheets.length > IMPORT_FILE_LIMITS.sheets)
      return fail('工作簿超过 16 张表，请仅保留需要导入的数据表');
    let rows = 0;
    for (const sheet of workbook.worksheets) {
      if (!sheet.actualRowCount) continue;
      const kind =
        (workbook.worksheets.length === 1 ? file.kind : undefined) ??
        KIND_NAMES[sheet.name.trim().toLowerCase()];
      if (!kind) {
        issue(
          result,
          sheet.name,
          0,
          '工作表',
          '无法确定数据类型，请将工作表命名为科目、辅助档案、期初或凭证',
        );
        continue;
      }
      rows += sheet.rowCount;
      if (rows > IMPORT_FILE_LIMITS.rows + 4) return fail('工作簿超过 50000 行，请分批导入');
      if (sheet.columnCount > IMPORT_FILE_LIMITS.columns) {
        issue(result, sheet.name, 1, '表头', '工作表超过 64 列，请按模板整理');
        continue;
      }
      const data: { row: number; cells: string[] }[] = [];
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const cells: string[] = [];
        for (let c = 1; c <= sheet.columnCount; c++) {
          try {
            cells.push(cellText(row.getCell(c)));
          } catch (error) {
            issue(
              result,
              sheet.name,
              rowNumber,
              columnName(c),
              error instanceof Error ? error.message : '单元格读取失败',
            );
            cells.push('');
          }
        }
        data.push({ row: rowNumber, cells });
      });
      finishSheet(result, sheet.name, kind, data);
    }
    if (!result.sheets.length && !result.issues.length)
      return fail('工作簿没有数据，请使用导入模板');
  } catch (error) {
    if (error instanceof DelimitedReadError) {
      issue(result, name, error.row, columnName(error.column), error.message);
      return result;
    }
    return fail(error instanceof Error ? error.message : '文件读取失败，请重新导出后重试');
  }
  return result;
}

/** 四张空表使用文本编码列；金额单位为元，凭证状态在正式导入时统一为待审核。 */
export async function buildImportTemplate(): Promise<{ name: string; contentBase64: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '新版会计';
  for (const kind of Object.keys(SHEET_NAMES) as ImportKind[]) {
    const sheet = workbook.addWorksheet(SHEET_NAMES[kind]);
    sheet.columns = IMPORT_COLUMNS[kind].map((header) => ({
      header,
      key: header,
      width: Math.max(14, header.length * 2 + 2),
      style: { numFmt: '@' },
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: IMPORT_COLUMNS[kind].length },
    };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return { name: '原账迁移导入模板.xlsx', contentBase64: Buffer.from(buffer).toString('base64') };
}

/** 导出已解析的来源值及凭证对照，供会计复核；不是原始文件的二进制备份。 */
export async function buildSourceExport(
  payload: ImportPayload,
  receipt: ImportReceipt | null,
): Promise<{ name: string; contentBase64: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '新版会计';
  const textRow = (sheet: ExcelJS.Worksheet, rowNumber: number, values: readonly string[]) => {
    const row = sheet.getRow(rowNumber);
    values.forEach((value, index) => {
      const cell = row.getCell(index + 1);
      cell.value = String(value);
      cell.numFmt = '@';
    });
  };
  const setup = (sheet: ExcelJS.Worksheet, headers: readonly string[], headerRow = 1) => {
    textRow(sheet, headerRow, headers);
    sheet.getRow(headerRow).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: headerRow }];
    headers.forEach((header, index) => {
      sheet.getColumn(index + 1).width = Math.min(45, Math.max(14, header.length * 2 + 2));
    });
  };
  const directory = workbook.addWorksheet('来源目录');
  setup(directory, ['导出工作表', '原文件', '原工作表', '数据类型', '数据行数']);
  const sourceRows = new Map<string, SourceRow[]>();
  const sourceKey = (file: string, sheet: string, kind: ImportKind) =>
    JSON.stringify([file, sheet, kind]);
  for (const row of payload.rows) {
    const key = sourceKey(row.location.file, row.location.sheet, row.kind);
    const rows = sourceRows.get(key) ?? [];
    rows.push(row);
    sourceRows.set(key, rows);
  }
  let ordinal = 0;
  for (const file of payload.files) {
    for (const originalSheet of file.sheets) {
      ordinal++;
      // 序号保证截短后的工作表仍唯一；原名称完整保留在目录中。
      const cleaned = Array.from(
        `${ordinal} ${SHEET_NAMES[originalSheet.kind]} ${originalSheet.name}`,
      )
        .map((character) =>
          character.charCodeAt(0) < 32 || '[]:*?/\\'.includes(character) ? ' ' : character,
        )
        .join('')
        .replace(/^'+|'+$/g, '');
      let safeName = '';
      for (const character of cleaned) {
        if (safeName.length + character.length > 31) break;
        safeName += character;
      }
      safeName = safeName.replace(/'+$/g, '');
      const sheet = workbook.addWorksheet(safeName);
      setup(sheet, originalSheet.headers, originalSheet.headerRow ?? 1);
      const rows =
        sourceRows.get(sourceKey(file.name, originalSheet.name, originalSheet.kind)) ?? [];
      for (const row of rows) {
        textRow(
          sheet,
          row.location.row,
          originalSheet.headers.map((header) => row.original[header] ?? ''),
        );
      }
      textRow(directory, ordinal + 1, [
        safeName,
        file.name,
        originalSheet.name,
        SHEET_NAMES[originalSheet.kind],
        String(rows.length),
      ]);
    }
  }
  const mapping = workbook.addWorksheet('凭证对照');
  setup(mapping, ['原凭证号', '现凭证号', '新版凭证ID', '原文件', '原工作表', '原行号']);
  receipt?.vouchers.forEach((voucher, index) => {
    textRow(mapping, index + 2, [
      voucher.original,
      voucher.displayNo,
      String(voucher.id),
      voucher.location.file,
      voucher.location.sheet,
      String(voucher.location.row),
    ]);
  });
  const bytes = await workbook.xlsx.writeBuffer();
  return {
    name: '原账迁移来源与凭证对照.xlsx',
    contentBase64: Buffer.from(bytes).toString('base64'),
  };
}
