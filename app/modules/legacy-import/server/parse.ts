import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { BusinessError } from '@caiwu/core';
import {
  FIELDS,
  REQUIRED_FIELDS,
  TABLE_NAMES,
  TABLES,
  FilesSchema,
  type SourceFile,
  type TableKind,
  type Inspection,
} from '../shared';

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function fail(message: string): never {
  throw new BusinessError({
    code: 'LEGACY_IMPORT_BLOCKED',
    message,
    hint: '请核对来源文件及字段映射；全部问题修正后重新预检。原账和目标业务数据未写入。',
  });
}

export type RawTable = { headers: string[]; rows: string[][] };
export type ParsedFiles = {
  tables: Record<TableKind, RawTable>;
  files: Inspection['files'];
};

/** 严格 CSV/TSV：支持引号、双引号转义、引号内换行，拒绝破损行。 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) fail(`第 ${rows.length + 1} 行引号位置错误`);
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
      closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      closed = false;
    } else {
      if (closed) fail(`第 ${rows.length + 1} 行引号后存在多余字符`);
      cell += c;
    }
  }
  if (quoted) fail('文件存在未闭合的引号');
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 在 ExcelJS 解压前限制 ZIP 展开大小与条目数，拒绝 ZIP64/加密文件。 */
function checkZip(bytes: Buffer) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) fail('Excel 不是有效的 xlsx ZIP 文件');
  const count = bytes.readUInt16LE(end + 10);
  let pos = bytes.readUInt32LE(end + 16),
    expanded = 0;
  if (count > 100 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    fail('Excel 条目过多或使用了不支持的分卷格式');
  const directoryEnd = pos + bytes.readUInt32LE(end + 12);
  if (directoryEnd !== end) fail('Excel ZIP 目录范围无效');
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) fail('Excel ZIP 目录损坏');
    const size = bytes.readUInt32LE(pos + 24);
    if (size === 0xffffffff || bytes.readUInt16LE(pos + 8) & 1) fail('不支持加密或 ZIP64 Excel');
    expanded += size;
    if (expanded > 4 * 1024 * 1024) fail('Excel 展开后超过 4 MiB，请拆分并核对');
    pos +=
      46 +
      bytes.readUInt16LE(pos + 28) +
      bytes.readUInt16LE(pos + 30) +
      bytes.readUInt16LE(pos + 32);
  }
  if (pos !== directoryEnd) fail('Excel ZIP 目录长度不一致');
}

function table(kind: TableKind, matrix: string[][]): RawTable {
  // 只允许文件末尾空行；中间空行与不规则列数都需要用户核对。
  while (matrix.length && matrix.at(-1)!.every((v) => v === '')) matrix.pop();
  if (matrix.length < 2) fail(`${TABLE_NAMES[kind]}没有读入到数据`);
  if (matrix.length > (kind === 'vouchers' ? 5001 : 1001))
    fail(`${TABLE_NAMES[kind]}行数超出本阶段限制`);
  const headers = matrix[0]!.map((v) => v.trim());
  if (headers.length > 40 || headers.some((v) => !v) || new Set(headers).size !== headers.length)
    fail(`${TABLE_NAMES[kind]}表头为空、重复或超过 40 列`);
  const rows = matrix.slice(1);
  rows.forEach((r, i) => {
    if (r.length !== headers.length || r.every((v) => !v.trim()))
      fail(`${TABLE_NAMES[kind]}第 ${i + 2} 行列数不一致或为空行`);
    if (r.some((v) => v.length > 500 || v.includes('\0')))
      fail(`${TABLE_NAMES[kind]}第 ${i + 2} 行存在超长或无效字段`);
  });
  return { headers, rows };
}

export async function parseFiles(raw: SourceFile[]): Promise<ParsedFiles> {
  const { files } = FilesSchema.parse({ files: raw });
  const tables: Partial<Record<TableKind, RawTable>> = {};
  const hashes: Inspection['files'] = [];
  let size = 0;
  for (const f of files) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(f.base64) || f.base64.length % 4 !== 0)
      fail(`${f.name}内容编码无效`);
    const bytes = Buffer.from(f.base64, 'base64');
    if (bytes.toString('base64') !== f.base64) fail(`${f.name}内容编码不完整`);
    size += bytes.length;
    if (size > 256 * 1024) fail('本阶段来源文件合计最多 256 KiB');
    hashes.push({ name: f.name, sha256: sha256(bytes), bytes: bytes.length });
    if (f.kind === 'workbook') {
      if (files.length !== 1 || !/\.xlsx$/i.test(f.name)) fail('Excel 必须单独选择一个 xlsx 文件');
      checkZip(bytes);
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
      } catch {
        fail('Excel 读取失败，请检查文件是否损坏或加密');
      }
      for (const sheet of workbook.worksheets) {
        const kind = TABLES.find((k) => TABLE_NAMES[k] === sheet.name);
        if (!kind) fail(`工作表「${sheet.name}」尚未支持，禁止忽略`);
        if (sheet.rowCount > 5001 || sheet.columnCount > 40) fail('Excel 行列数超限');
        const matrix: string[][] = [];
        for (let r = 1; r <= sheet.rowCount; r++) {
          const row: string[] = [];
          for (let c = 1; c <= sheet.columnCount; c++) {
            const cell = sheet.getCell(r, c);
            if (cell.isMerged) fail(`${sheet.name}存在合并单元格，请展开后核对`);
            const value = cell.value;
            if (value != null && typeof value !== 'string')
              fail(
                `${sheet.name}第 ${r} 行第 ${c} 列必须为文本；数值、日期、公式及链接需先转成精确文本`,
              );
            row.push(value ?? '');
          }
          matrix.push(row);
        }
        tables[kind] = table(kind, matrix);
      }
    } else {
      if (!/\.(csv|tsv|txt)$/i.test(f.name)) fail('文本来源仅支持 csv、tsv、txt');
      if (tables[f.kind]) fail(`${TABLE_NAMES[f.kind]}来源重复`);
      let text: string;
      try {
        text = new TextDecoder(f.encoding, { fatal: true }).decode(bytes);
      } catch {
        fail(`${f.name}字符编码不匹配，请选择 UTF-8 或 GB18030`);
      }
      tables[f.kind] = table(f.kind, parseDelimited(text, /\.csv$/i.test(f.name) ? ',' : '\t'));
    }
  }
  for (const k of TABLES) if (!tables[k]) fail(`缺少${TABLE_NAMES[k]}来源文件或工作表`);
  return { tables: tables as Record<TableKind, RawTable>, files: hashes };
}

export function inspection(parsed: ParsedFiles): Inspection {
  return {
    files: parsed.files,
    tables: Object.fromEntries(
      TABLES.map((k) => [
        k,
        {
          headers: parsed.tables[k].headers,
          rows: parsed.tables[k].rows.length,
          sample: parsed.tables[k].rows.slice(0, 3),
        },
      ]),
    ) as Inspection['tables'],
    mappings: Object.fromEntries(
      TABLES.map((k) => [
        k,
        Object.fromEntries(
          Object.entries(FIELDS[k])
            .filter(([, label]) => parsed.tables[k].headers.includes(label))
            .map(([key, label]) => [key, label]),
        ),
      ]),
    ) as Inspection['mappings'],
  };
}

export function mapRows(kind: TableKind, raw: RawTable, mapping: Record<string, string>) {
  for (const key of Object.keys(mapping)) {
    if (!Object.hasOwn(FIELDS[kind], key) || !raw.headers.includes(mapping[key]!))
      fail(`${TABLE_NAMES[kind]}映射字段「${key}」或来源列无效`);
  }
  for (const key of REQUIRED_FIELDS[kind])
    if (!mapping[key]) fail(`${TABLE_NAMES[kind]}缺少「${FIELDS[kind][key]}」映射`);
  const used = Object.values(mapping);
  if (new Set(used).size !== used.length) fail(`${TABLE_NAMES[kind]}一列不能映射到多个字段`);
  const unsupported = raw.headers.filter((h) => !used.includes(h));
  if (unsupported.length)
    fail(`${TABLE_NAMES[kind]}存在未覆盖字段：${unsupported.join('、')}，禁止静默丢弃`);
  return raw.rows.map((row) =>
    Object.fromEntries(
      Object.entries(mapping).map(([key, header]) => [
        key,
        row[raw.headers.indexOf(header)]!.trim(),
      ]),
    ),
  );
}
