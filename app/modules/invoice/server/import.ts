import ExcelJS from 'exceljs';
import { BusinessError, Decimal, isValidDate } from '@caiwu/core';
import type { ImportFile, InvoiceData } from '../shared';
import { InvoiceSchema } from '../shared';

// Explicit aliases for flat, one-header-row XLSX exports. Unknown fields are rejected.
export const columns = {
  code: ['发票代码'],
  number: ['发票号码', '数电发票号码', '电子发票号码'],
  date: ['开票日期'],
  confirmDate: ['确认日期', '认证日期', '勾选确认日期'],
  sellerName: ['销售方名称', '销方名称', '销方企业名称'],
  sellerTaxId: ['销售方税号', '销方税号', '销售方纳税人识别号'],
  buyerName: ['购买方名称', '购方名称', '购方企业名称'],
  buyerTaxId: ['购买方税号', '购方税号', '购买方纳税人识别号'],
  kind: ['票种', '发票票种', '发票类型'],
  invoiceStatus: ['发票状态'],
  name: ['商品名称', '货物或应税劳务名称', '项目名称'],
  specification: ['规格', '规格型号'],
  unit: ['单位', '计量单位'],
  quantity: ['数量'],
  unitPrice: ['单价'],
  taxRate: ['税率'],
  amount: ['不含税金额', '金额'],
  tax: ['税额'],
  total: ['价税合计'],
  note: ['备注'],
} as const;
type Field = keyof typeof columns;
const required: Field[] = [
  'number',
  'date',
  'sellerName',
  'sellerTaxId',
  'buyerName',
  'kind',
  'amount',
  'tax',
  'total',
];
function fail(message: string): never {
  throw new BusinessError({
    code: 'INVOICE_FILE',
    message,
    hint: '请使用本页合成样例的表头；仅支持单工作表、首行为表头的 .xlsx 表格，号码和代码使用文本。PDF/OFD/XML 尚不支持。',
  });
}
export type ParsedFile = {
  mapping: { header: string; field: string; label: string }[];
  invoices: { rows: number[]; data: InvoiceData }[];
  errors: { row: number; message: string }[];
};
export function invoiceKey(d: Pick<InvoiceData, 'direction' | 'sellerTaxId' | 'code' | 'number'>) {
  return JSON.stringify([d.direction, d.sellerTaxId, d.code, d.number]);
}
export async function parseWorkbook(file: ImportFile): Promise<ParsedFile> {
  if (!/\.xlsx$/i.test(file.fileName)) fail('文件类型不受支持');
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.length > 5_000_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    fail('文件不是有效的 XLSX，或超过 5 MB');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch {
    fail('无法读取 XLSX 工作簿');
  }
  if (wb.worksheets.length !== 1) fail('工作簿必须只有一个工作表，避免遗漏其他工作表数据');
  const ws = wb.worksheets[0]!;
  if (ws.rowCount < 2 || ws.rowCount > 2001 || ws.columnCount > 40)
    fail('工作表必须包含 1–2000 行数据且不超过 40 列');
  const fields = new Map<number, Field>();
  const seen = new Set<Field>();
  const mapping: ParsedFile['mapping'] = [];
  const read = (cell: ExcelJS.Cell, row: number): string => {
    const v = cell.value;
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' || typeof v === 'number') {
      const text = String(v).trim();
      if (/^[=+@]/.test(text))
        throw new Error(`第 ${row} 行含公式或公式样式文本，不执行，请转换为普通值`);
      return text;
    }
    throw new Error(`第 ${row} 行含公式、链接或未知单元格类型，请转换为普通文本/数字`);
  };
  try {
    for (let c = 1; c <= ws.columnCount; c++) {
      const header = read(ws.getRow(1).getCell(c), 1);
      const field = (Object.keys(columns) as Field[]).find((k) =>
        (columns[k] as readonly string[]).includes(header),
      );
      if (!field) fail(`第 ${c} 列表头「${header || '空白'}」不受支持，未忽略该列`);
      if (seen.has(field)) fail(`字段「${header}」重复映射`);
      seen.add(field);
      fields.set(c, field);
      mapping.push({ header, field, label: columns[field][0] });
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : '表头读取失败');
  }
  for (const f of [...required, ...(file.direction === 'input' ? ['confirmDate' as const] : [])])
    if (!seen.has(f)) fail(`缺少必需列「${columns[f][0]}」`);
  const errors: ParsedFile['errors'] = [];
  const groups = new Map<string, { rows: number[]; data: InvoiceData; header: string }>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.cellCount === 0 || row.values.toString().replace(/,/g, '').trim() === '') continue;
    try {
      const values: Partial<Record<Field, string>> = {};
      for (const [c, f] of fields) {
        const cell = row.getCell(c);
        if (
          ['number', 'code', 'sellerTaxId', 'buyerTaxId'].includes(f) &&
          cell.value != null &&
          typeof cell.value !== 'string'
        )
          throw new Error(`「${columns[f][0]}」必须是文本单元格，避免前导零或长号精度丢失`);
        values[f] = read(cell, r);
      }
      const money = (f: 'amount' | 'tax' | 'total') => {
        const raw = values[f] ?? '';
        if (!/^-?\d+(\.\d{1,2})?$/.test(raw))
          throw new Error(`「${columns[f][0]}」须为最多两位小数的元金额`);
        const n = new Decimal(raw).mul(100).toNumber();
        if (!Number.isSafeInteger(n)) throw new Error('金额超出安全整数范围');
        return n;
      };
      for (const f of ['date', 'confirmDate'] as const)
        if (values[f] && !isValidDate(values[f]))
          throw new Error(`「${columns[f][0]}」应为 YYYY-MM-DD`);
      if (values.invoiceStatus && !['正常', '作废'].includes(values.invoiceStatus))
        throw new Error('发票状态仅支持「正常」「作废」');
      let rate = values.taxRate || null;
      const taxMark = rate === '免税' ? 'exempt' : rate ? 'rate' : 'unspecified';
      if (rate === '免税') rate = null;
      else if (rate?.endsWith('%')) rate = new Decimal(rate.slice(0, -1)).div(100).toFixed();
      const data = InvoiceSchema.parse({
        direction: file.direction,
        code: values.code ?? '',
        number: values.number,
        date: values.date,
        confirmDate: values.confirmDate || null,
        sellerName: values.sellerName,
        sellerTaxId: values.sellerTaxId,
        buyerName: values.buyerName,
        buyerTaxId: values.buyerTaxId ?? '',
        kind: values.kind,
        invoiceStatus: values.invoiceStatus === '作废' ? 'void' : 'normal',
        amount: money('amount'),
        tax: money('tax'),
        total: money('total'),
        note: values.note ?? '',
        lines: values.name
          ? [
              {
                name: values.name,
                specification: values.specification ?? '',
                unit: values.unit ?? '',
                quantity: values.quantity || null,
                unitPrice: values.unitPrice || null,
                taxRate: rate,
                taxMark,
                amount: money('amount'),
                tax: money('tax'),
                total: money('total'),
              },
            ]
          : [],
      });
      if (
        !values.name &&
        ['specification', 'unit', 'quantity', 'unitPrice', 'taxRate'].some(
          (f) => values[f as Field],
        )
      )
        throw new Error('无商品名称却有明细字段，不能作为汇总票静默丢弃');
      const header = JSON.stringify({ ...data, amount: 0, tax: 0, total: 0, lines: [] });
      const key = invoiceKey(data);
      const g = groups.get(key);
      if (!g) groups.set(key, { rows: [r], data, header });
      else {
        if (g.header !== header || !g.data.lines.length || !data.lines.length)
          throw new Error('同票标识的票头冲突或重复汇总行，请核对；商品行仅在票头一致时合并');
        g.rows.push(r);
        g.data.lines.push(...data.lines);
        for (const f of ['amount', 'tax', 'total'] as const) {
          g.data[f] = new Decimal(g.data[f]).add(data[f]).toNumber();
          if (!Number.isSafeInteger(g.data[f])) throw new Error('同票汇总金额超出安全整数范围');
        }
      }
    } catch (e) {
      errors.push({ row: r, message: e instanceof Error ? e.message : '数据不合法' });
    }
  }
  return {
    mapping,
    invoices: [...groups.values()].map(({ rows, data }) => ({ rows, data })),
    errors,
  };
}
