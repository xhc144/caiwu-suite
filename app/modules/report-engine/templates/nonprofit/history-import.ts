import Decimal from 'decimal.js';
import { PreStartHistorySchema, type Sources } from './model';

/** 明确列头的CSV只用于本域启用前来源；金额由元精确转为财务金额。 */
function csv(text: string, required: string[]) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= input.length; i++) {
    const ch = input[i];
    if (closed && ch !== ',' && ch !== '\n' && ch !== '\r' && ch !== undefined)
      throw new Error('导入文件引号后的内容无效，请保留标准CSV格式');
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        if (!quoted && cell.length !== 0) throw new Error('导入文件引号位置无效');
        if (quoted) closed = true;
        quoted = !quoted;
      }
    } else if ((ch === ',' || ch === '\n' || ch === undefined) && !quoted) {
      row.push(cell.trim());
      cell = '';
      closed = false;
      if (ch !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (ch !== '\r' && ch !== undefined) cell += ch;
  }
  if (quoted) throw new Error('导入文件的引号未闭合');
  const header = rows.shift();
  if (
    !header ||
    new Set(header).size !== header.length ||
    required.some((h) => !header.includes(h))
  )
    throw new Error(`导入文件须包含且不重复列头：${required.join('、')}`);
  return rows.map((cells, i) => {
    if (cells.length !== header.length) throw new Error(`导入第${i + 2}行列数不完整`);
    return Object.fromEntries(header.map((h, j) => [h, cells[j]!]));
  });
}
const amount = (s: string) => {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s) || s.length > 30)
    throw new Error('金额须填写元，最多两位小数，空金额不能当作零');
  const value = new Decimal(s).times(100);
  if (!value.isInteger() || value.abs().gt(Number.MAX_SAFE_INTEGER))
    throw new Error('金额超出可精确计算范围');
  return value.toNumber();
};
const dimensions = (r: Record<string, string>, s: Sources) => {
  const result: { partner?: number; person?: number } = {};
  for (const [type, column] of [
    ['partner', '往来编码'],
    ['person', '个人编码'],
  ] as const) {
    if (!r[column]) continue;
    const d = s.dimensionItems?.find((d) => d.type === type && d.code === r[column]);
    if (!d) throw new Error(`${column}${r[column]}未对应本账套实际档案`);
    result[type] = d.id;
  }
  return result;
};
export function parseHistoryOpening(text: string, s: Sources) {
  const rows = csv(text, ['科目编码', '年初余额', '原始凭据']).map((r) => ({
    account: r['科目编码'],
    balance: amount(r['年初余额']!),
    sourceReference: r['原始凭据'],
    ...dimensions(r, s),
  }));
  return PreStartHistorySchema.shape.opening.parse(rows);
}
export function parseHistoryEntries(text: string, s: Sources) {
  const rows = csv(text, [
    '日期',
    '凭证编号',
    '行号',
    '原版本',
    '科目编码',
    '借方金额',
    '贷方金额',
    '结转类别',
    '原始凭据',
  ]).map((r) => {
    if (!['普通业务', '损益结转', '其他结转'].includes(r['结转类别']!))
      throw new Error('每笔须明确普通业务、损益结转或其他结转，不能由摘要推断');
    return {
      date: r['日期'],
      voucher: r['凭证编号'],
      line: Number(r['行号']),
      revision: Number(r['原版本']),
      account: r['科目编码'],
      debit: amount(r['借方金额']!),
      credit: amount(r['贷方金额']!),
      closingKind:
        r['结转类别'] === '损益结转' ? 'pnl' : r['结转类别'] === '其他结转' ? 'custom' : null,
      sourceReference: r['原始凭据'],
      ...dimensions(r, s),
    };
  });
  return PreStartHistorySchema.shape.entries.parse(rows);
}
