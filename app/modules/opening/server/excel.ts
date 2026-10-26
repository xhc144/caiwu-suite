import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { BusinessError, balanceSide, centsToYuan, type DimensionValues } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  exactSum,
  openingDimensions,
  openingKey,
  rowVersion,
  rowsVersion,
  strictMoney,
  yearStart,
  type Change,
  type RowInput,
} from '../shared';
import { applyChanges, fail, requireYear, validateRow, writable, validateSet } from './service';

export const headers = [
  '年度',
  '科目编码',
  '项目编码',
  '客供编码',
  '部门编码',
  '个人编码',
  '币种',
  '余额方向',
  '年初本位币余额',
  '启用本位币余额（借正贷负）',
  '外币余额（借正贷负）',
  '数量（借正贷负）',
  '账前累计借方',
  '账前累计贷方',
];
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
type FileInput = { year: number; file: string; mode: 'add' | 'overwrite' };
export async function exportExcel(svc: CoreServices, year: number) {
  svc.permissions.require('opening.view');
  await requireYear(svc, year);
  const rows = await svc.opening.list(year),
    accounts = await svc.accounts.list(),
    items = await svc.dimensions.items();
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('期初余额');
  sheet.addRow(headers);
  for (const row of rows) {
    const a = accounts.find((a) => a.id === row.accountId)!;
    const side = balanceSide(yearStart(row), a.direction);
    sheet.addRow([
      String(year),
      a.code,
      ...openingDimensions.map((d) => items.find((i) => i.id === row.dimensions[d.id])?.code ?? ''),
      row.currency ?? '',
      side.side,
      centsToYuan(side.amount),
      centsToYuan(row.balance),
      centsToYuan(row.fcBalance),
      row.quantity,
      centsToYuan(row.ytdDebit),
      centsToYuan(row.ytdCredit),
    ]);
  }
  sheet.columns.forEach((c) => {
    c.width = 24;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return {
    name: `期初余额-${year}.xlsx`,
    file: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
  };
}
function cellText(cell: ExcelJS.Cell) {
  if (cell.value == null) return '';
  if (typeof cell.value !== 'string' && typeof cell.value !== 'number')
    fail('OPENING_EXCEL_CELL', '单元格必须为文字或数字，不能使用公式、日期或链接');
  return String(cell.value).trim();
}
async function parse(svc: CoreServices, input: FileInput) {
  await requireYear(svc, input.year);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(Uint8Array.from(Buffer.from(input.file, 'base64')).buffer);
  } catch {
    fail(
      'OPENING_EXCEL_FILE',
      '无法读取 Excel 文件',
      '请选择本模块导出的 .xlsx 文件，保留表头后填写',
    );
  }
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount > 5001)
    fail('OPENING_EXCEL_SIZE', '工作表为空或超过 5000 行', '每次最多导入 5000 条');
  for (const [i, h] of headers.entries())
    if (cellText(sheet.getRow(1).getCell(i + 1)) !== h)
      fail('OPENING_EXCEL_HEADER', `第 ${i + 1} 列应为“${h}”`, '请先导出本模块模板，勿删改表头');
  const saved = await svc.opening.list(input.year);
  const changes: Change[] = [];
  const preview: {
    row: number;
    account: string;
    key: string;
    status: string;
    error: string | null;
    source: string[];
  }[] = [];
  const seen = new Set<string>();
  for (let n = 2; n <= sheet.rowCount; n++) {
    let accountCode = '';
    let cells: string[] = [];
    try {
      cells = headers.map((_, i) => cellText(sheet.getRow(n).getCell(i + 1)));
      if (cells.every((v) => !v)) continue;
      accountCode = cells[1]!;
      if (cells[0] !== String(input.year)) fail('OPENING_YEAR_MISMATCH', '年度与当前选择不一致');
      const a = await svc.accounts.getByCode(accountCode);
      if (!a) fail('OPENING_ACCOUNT_CODE', `不存在科目编码 ${accountCode}`);
      const dimensions: DimensionValues = {};
      for (const [i, d] of openingDimensions.entries()) {
        const code = cells[i + 2]!;
        if (!code) continue;
        const item = await svc.dimensions.getByCode(d.id, code);
        if (!item) fail('OPENING_DIMENSION_CODE', `${d.name}编码 ${code} 不存在`);
        dimensions[d.id] = item.id;
      }
      const side = cells[7]!,
        amount = strictMoney(cells[8]!);
      if (!['借', '贷', '平'].includes(side) || amount < 0 || (side === '平' && amount !== 0))
        fail('OPENING_EXCEL_SIDE', '余额方向须为借、贷或平，年初金额须非负');
      const annual = side === '贷' ? -amount : amount;
      const ytdDebit = strictMoney(cells[12] || '0'),
        ytdCredit = strictMoney(cells[13] || '0');
      const activation = exactSum([annual, ytdDebit, -ytdCredit]);
      if (cells[9] && strictMoney(cells[9]) !== activation)
        fail('OPENING_EXCEL_ACTIVATION', '启用余额不等于年初余额 + 账前累计借方 - 账前累计贷方');
      const data: RowInput = {
        year: input.year,
        accountId: a.id,
        dimensions,
        currency: cells[6] || null,
        balance: activation,
        fcBalance: strictMoney(cells[10] || '0'),
        quantity: cells[11] || '0',
        ytdDebit,
        ytdCredit,
      };
      const key = openingKey(data);
      if (seen.has(key)) fail('OPENING_DUPLICATE', '文件内年度、科目、辅助组合及币种重复');
      seen.add(key);
      await validateRow(svc, data);
      const old = saved.find((r) => openingKey(r) === key);
      if (old && input.mode === 'add')
        fail('OPENING_DUPLICATE', '已有此项目；新增模式不会覆盖', '明确选择覆盖模式后重新预览');
      changes.push({ data, ...(old ? { id: old.id, expected: rowVersion(old) } : {}) });
      preview.push({
        row: n,
        account: accountCode,
        key,
        status: old ? '覆盖此键' : '新增',
        error: null,
        source: cells,
      });
    } catch (e) {
      const message =
        e instanceof BusinessError ? e.data.message : e instanceof Error ? e.message : '格式错误';
      preview.push({
        row: n,
        account: accountCode,
        key: '',
        status: '错误',
        error: message,
        source: cells,
      });
    }
  }
  const prospective = [
    ...saved.filter((r) => !changes.some((c) => c.id === r.id)),
    ...changes.map((c) => c.data),
  ];
  for (const c of changes) {
    const blank = !Object.values(c.data.dimensions ?? {}).some((v) => v != null);
    if (
      prospective.some(
        (r) =>
          r.accountId === c.data.accountId &&
          (r.currency ?? null) === (c.data.currency ?? null) &&
          !Object.values(r.dimensions ?? {}).some((v) => v != null) !== blank,
      )
    ) {
      const p = preview.find((r) => r.key === openingKey(c.data));
      if (p) {
        p.error = '无辅助汇总行不能与辅助明细同时存储，请先处理原汇总行';
        p.status = '错误';
      }
    }
  }
  try {
    validateSet(prospective);
  } catch (e) {
    const message = e instanceof Error ? e.message : '期初集合无效';
    for (const row of preview)
      if (!row.error) {
        row.error = message;
        row.status = '错误';
      }
  }
  if (!preview.length)
    fail(
      'OPENING_EXCEL_EMPTY',
      '文件中没有期初数据',
      '空白模板不会被当成显式保存零；请填写完整记录',
    );
  return {
    changes,
    preview,
    valid: preview.every((r) => !r.error),
    expected: digest(`${input.file}|${input.mode}|${rowsVersion(saved)}`),
  };
}
export async function previewExcel(svc: CoreServices, input: FileInput) {
  svc.permissions.require('opening.import');
  const { changes: _changes, ...result } = await parse(svc, input);
  return result;
}
export async function importExcel(
  svc: CoreServices,
  input: FileInput & { confirmed: boolean; expected: string },
) {
  svc.permissions.require('opening.import');
  if (!input.confirmed)
    fail('OPENING_CONFIRM_IMPORT', '导入未确认，数据没有改变', '先检查逐行预览，再确认写入');
  return svc.tx(async (tsvc) => {
    await writable(tsvc, input.year, 'opening.import');
    const parsed = await parse(tsvc, input);
    if (!parsed.valid)
      fail('OPENING_IMPORT_INVALID', '导入包含错误，整批未写入', '修正预览中的所有错误后重试');
    if (parsed.expected !== input.expected)
      fail('OPENING_STALE', '文件、模式或账套期初已改变', '请重新预览后确认');
    await applyChanges(tsvc, input.year, parsed.changes, 'opening.import');
    return { count: parsed.changes.length };
  });
}
