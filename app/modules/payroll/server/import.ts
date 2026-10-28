import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { parseMoney } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  IMPORT_MAX_BYTES,
  ImportFileSchema,
  PayrollImportSchema,
  type ImportFileInput,
  type ImportChange,
  type PayrollImportInput,
} from '../shared-import';
import { TaxInputSchema, type RowInput } from '../shared';
import { quantityText } from '../quantity';
import { fail } from './engine';
import { payrollService } from './service';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function scalar(cell: ExcelJS.Cell, row: number, column: number): string {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  fail(
    'IMPORT_CELL',
    `第${row}行第${column}列含公式、日期或不支持的单元格`,
    '在 Excel 中将工资列粘贴为纯文本或数值后重试；不会采用公式的缓存结果',
  );
}
/** 在解压前限制 XLSX 包声明的总大小；拒绝加密、ZIP64 和超限工作簿。 */
function checkArchive(bytes: Buffer) {
  if (bytes.length > IMPORT_MAX_BYTES || bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    fail('IMPORT_FILE', '请选择不超过512KB的标准 .xlsx 文件', '旧版 .xls 请先另存为 .xlsx');
  let end = bytes.length - 22;
  const lower = Math.max(0, bytes.length - 65557);
  for (; end >= lower; end--) if (bytes.readUInt32LE(end) === 0x06054b50) break;
  if (end < lower || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    fail('IMPORT_FILE', 'Excel 文件的压缩目录无效');
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  if (!count || count > 200 || start >= end) fail('IMPORT_SIZE', 'Excel 文件内容超出支持范围');
  let cursor = start;
  let expanded = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      fail('IMPORT_FILE', 'Excel 文件的压缩目录不完整');
    if (bytes.readUInt16LE(cursor + 8) & 1) fail('IMPORT_FILE', '请先解除 Excel 文件加密');
    const size = bytes.readUInt32LE(cursor + 24);
    expanded += size;
    if (size === 0xffffffff || expanded > 8 * 1024 * 1024)
      fail('IMPORT_SIZE', 'Excel 文件解压后超过8MB', '仅保留需要转入的工作表和工资数据');
    cursor +=
      46 +
      bytes.readUInt16LE(cursor + 28) +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  if (cursor !== end) fail('IMPORT_FILE', 'Excel 文件压缩目录长度不符');
}
async function workbook(file: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file)) fail('IMPORT_FILE', 'Excel 文件内容无效');
  const bytes = Buffer.from(file, 'base64');
  checkArchive(bytes);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(Uint8Array.from(bytes).buffer);
  } catch {
    fail('IMPORT_FILE', '无法读取 Excel 工作簿', '请在 Excel 中重新另存为 .xlsx 后重试');
  }
  if (!book.worksheets.length || book.worksheets.length > 10)
    fail('IMPORT_SIZE', '工作簿须包含1至10张工作表');
  return book;
}
async function load(svc: CoreServices, input: ImportFileInput) {
  const service = payrollService(svc);
  await service.assertMutable(input.id, input.revision);
  const batch = await service.batch(input.id);
  const category = await service.category(batch.categoryId);
  if (category.revision !== batch.category.revision)
    fail('STALE', '工资结构已更新', '重新打开并保存工资结构后再转入');
  const book = await workbook(input.file);
  const sheet = input.sheet ? book.getWorksheet(input.sheet) : book.worksheets[0];
  if (!sheet) fail('IMPORT_SHEET', '所选工作表不存在', '重新选择文件和工作表');
  if (sheet.rowCount > 501 || sheet.columnCount > 41 || sheet.rowCount < 2)
    fail('IMPORT_SIZE', '工资表须有表头及1至500行人员，最多41列', '删除多余行列后重试');
  const headers = Array.from({ length: sheet.columnCount }, (_, i) =>
    scalar(sheet.getCell(1, i + 1), 1, i + 1),
  );
  if (headers.some((title) => !title))
    fail('IMPORT_HEADER', '表头中存在空白栏目', '第一行每列都须填写标题');
  return { batch, category, book, sheet, headers };
}
export async function inspectPayrollImport(svc: CoreServices, raw: ImportFileInput) {
  const input = ImportFileSchema.parse(raw);
  const { category, book, sheet, headers } = await load(svc, input);
  const fields = category.fields.filter(
    (f) => !f.disabled && ['money', 'quantity'].includes(f.kind),
  );
  return {
    sheets: book.worksheets.map((s) => s.name),
    sheet: sheet.name,
    headers: headers.map((title, index) => {
      const matches = fields.filter((f) => f.key === title || f.name === title);
      return {
        index: index + 1,
        title,
        field: ['编号', '人员编号'].includes(title)
          ? '$code'
          : matches.length === 1
            ? matches[0]!.key
            : null,
      };
    }),
    fields: fields.map((f) => ({ key: f.key, name: f.name, kind: f.kind })),
  };
}
export async function previewPayrollImport(svc: CoreServices, raw: PayrollImportInput) {
  const input = PayrollImportSchema.parse(raw);
  const { batch, category, sheet, headers } = await load(svc, input);
  if (
    input.columns.length !== headers.length ||
    new Set(input.columns.map((c) => c.index)).size !== input.columns.length ||
    input.columns.some((c) => c.index > headers.length)
  )
    fail('IMPORT_MAPPING', '转入栏目与工作表表头不一致', '重新读取文件并逐列选择');
  const active = input.columns.filter((c) => c.field !== null);
  const codeColumns = active.filter((c) => c.field === '$code');
  if (
    codeColumns.length !== 1 ||
    active.length < 2 ||
    new Set(active.map((c) => c.field)).size !== active.length
  )
    fail('IMPORT_MAPPING', '须指定一个人员编号及至少一个不重复工资栏目');
  const fields = category.fields.filter(
    (f) => !f.disabled && ['money', 'quantity'].includes(f.kind),
  );
  for (const column of active)
    if (column.field !== '$code' && !fields.some((f) => f.key === column.field))
      fail('IMPORT_MAPPING', `栏目 ${column.field} 不是启用的金额或数量录入项`);
  const people = await payrollService(svc).employees();
  const rows: RowInput[] = batch.rows.map((r) => ({
    ...r,
    values: { ...r.values },
    quantities: r.quantities ? { ...r.quantities } : undefined,
    tax: { ...r.tax },
  }));
  const seen = new Set<string>();
  const preview: ImportChange[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const data = headers.map((_, i) => scalar(sheet.getCell(rowNumber, i + 1), rowNumber, i + 1));
    if (data.every((cell) => !cell)) continue;
    const code = data[codeColumns[0]!.index - 1]!;
    if (!code || seen.has(code)) fail('IMPORT_CODE', `第${rowNumber}行人员编号为空或重复`);
    seen.add(code);
    const employee = people.find((p) => p.code === code);
    if (!employee)
      fail('IMPORT_PERSON', `编号 ${code} 不在人事档案`, '先建立人事档案，转入不会自动创建人员');
    if (!active.some((c) => c.field !== '$code' && data[c.index - 1])) continue;
    const added = !batch.rows.some((r) => r.employeeId === employee.id);
    let row = rows.find((r) => r.employeeId === employee.id);
    if (!row) {
      row = { employeeId: employee.id, values: {}, tax: TaxInputSchema.parse({}) };
      rows.push(row);
    }
    for (const column of active) {
      if (column.field === '$code') continue;
      const rawValue = data[column.index - 1]!;
      if (!rawValue) continue;
      const field = fields.find((f) => f.key === column.field)!;
      let value: number | string | null;
      if (field.kind === 'quantity') value = quantityText(rawValue);
      else {
        try {
          value = parseMoney(rawValue);
        } catch {
          value = null;
        }
        if (value !== null && !Number.isSafeInteger(value)) value = null;
      }
      if (value === null)
        fail(
          'IMPORT_VALUE',
          `第${rowNumber}行 ${field.name} 不是有效${field.kind === 'quantity' ? '数量' : '金额'}：${rawValue}`,
          '修正 Excel 后重新预览，整批工资尚未转入',
        );
      preview.push({
        employeeId: employee.id,
        employeeRevision: employee.revision,
        code,
        name: employee.name,
        field: field.key,
        title: field.name,
        kind: field.kind === 'quantity' ? 'quantity' : 'money',
        added,
        before:
          field.kind === 'quantity'
            ? (row.quantities?.[field.key] ?? null)
            : (row.values[field.key] ?? null),
        after: value,
      });
      if (field.kind === 'quantity')
        row.quantities = { ...row.quantities, [field.key]: String(value) };
      else row.values[field.key] = value as number;
    }
  }
  if (!preview.length) fail('IMPORT_EMPTY', '没有可转入的工资单元格', '空单元格保留原值');
  if (rows.length > 500) fail('IMPORT_SIZE', '转入后工资批次超过500人');
  return {
    hash: hash({
      input,
      rows: batch.rows,
      categoryRevision: category.revision,
      preview,
      next: rows,
    }),
    sheet: sheet.name,
    preview,
    rows,
    addedPeople: new Set(preview.filter((c) => c.added).map((c) => c.employeeId)).size,
  };
}
export async function applyPayrollImport(
  svc: CoreServices,
  input: PayrollImportInput,
  expectedHash: string,
  confirmed: boolean,
) {
  if (!confirmed) fail('CONFIRM', 'Excel 转入须核对预览后确认', '取消不会修改工资');
  return svc.tx(async (t) => {
    const plan = await previewPayrollImport(t, input);
    if (plan.hash !== expectedHash)
      fail('PLAN_STALE', 'Excel 转入预览已失效', '重新读取并预览后确认');
    const service = payrollService(t);
    const batch = await service.batch(input.id);
    const saved = await service.saveBatch({
      ...batch,
      categoryRevision: batch.category.revision,
      rows: plan.rows,
    });
    await t.log.write({
      action: 'payroll.salary.import',
      summary: `Excel 转入工资 ${plan.preview.length} 格，新增 ${plan.addedPeople} 人`,
      targetType: 'payroll_batch',
      targetId: batch.id,
    });
    return saved;
  });
}
