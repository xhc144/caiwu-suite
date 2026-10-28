import { BusinessError, centsToYuan } from '@caiwu/core';
import { openingCents } from './opening';

export type InventoryImportKind = 'products' | 'opening' | 'document' | 'contracts';
type Column = {
  key: string;
  title: string;
  aliases?: readonly string[];
  type?: 'taxBasis' | 'disabled' | 'id' | 'openingBasis' | 'cents' | 'contractStatus';
  required?: boolean;
};
/** One column contract for the import guide, downloadable template and round-trip export. */
export const INVENTORY_IMPORT_COLUMNS: Record<InventoryImportKind, readonly Column[]> = {
  contracts: [
    { key: 'number', title: '合同号', required: true },
    { key: 'warehouseCode', title: '仓库编码', required: true },
    { key: 'supplierCode', title: '供应商编码', required: true },
    { key: 'date', title: '合同日期', required: true },
    { key: 'dueDate', title: '交期' },
    { key: 'agent', title: '经办人' },
    { key: 'note', title: '合同说明' },
    { key: 'status', title: '执行状态', type: 'contractStatus' },
    { key: 'productCode', title: '产品编号', required: true },
    { key: 'quantity', title: '数量', required: true },
    { key: 'unitPrice', title: '单价（元）', required: true },
    { key: 'lineNote', title: '明细说明' },
  ],
  products: [
    { key: 'code', title: '产品编号', required: true },
    { key: 'name', title: '产品名称', aliases: ['名称'] },
    { key: 'specification', title: '规格' },
    { key: 'unit', title: '计量单位', aliases: ['单位'] },
    { key: 'receiptPrice', title: '默认入库价' },
    { key: 'issuePrice', title: '默认出库价' },
    { key: 'planPrice', title: '计划价' },
    { key: 'allocationFactor', title: '费用分摊系数' },
    { key: 'inventoryAccountCode', title: '存货科目编码' },
    { key: 'salesAccountCode', title: '销售科目编码' },
    { key: 'inventoryAccountId', title: '存货科目ID', type: 'id' },
    { key: 'salesAccountId', title: '销售科目ID', type: 'id' },
    { key: 'disabled', title: '停用', aliases: ['状态'], type: 'disabled' },
  ],
  opening: [
    { key: 'productCode', title: '产品编号', required: true },
    { key: 'quantity', title: '数量', required: true },
    { key: 'valueBasis', title: '保存口径', type: 'openingBasis' },
    { key: 'unitPrice', title: '单价（元）', aliases: ['单价'] },
    { key: 'amountCents', title: '金额（元）', aliases: ['金额'], type: 'cents' },
  ],
  document: [
    { key: 'productCode', title: '产品编号', required: true },
    { key: 'quantity', title: '数量', required: true },
    { key: 'unitPrice', title: '单价（元）', aliases: ['单价'], required: true },
    {
      key: 'priceIncludesTax',
      title: '含税口径（是/否）',
      aliases: ['含税口径'],
      type: 'taxBasis',
      required: true,
    },
    { key: 'note', title: '说明' },
  ],
};
export type ImportIssue = { row: number; message: string };
function inputError(message: string): never {
  throw new BusinessError({
    code: 'INVENTORY_IMPORT_COLUMN',
    message,
    hint: '请下载本页导入模板，核对列名及含税口径后重新预览',
  });
}
export function requireImportKeys(kind: InventoryImportKind, row: Record<string, unknown>) {
  const columns = INVENTORY_IMPORT_COLUMNS[kind];
  const keys = new Set(columns.map((c) => c.key));
  const unknown = Object.keys(row).filter((k) => !keys.has(k));
  if (unknown.length) inputError(`无法识别导入列：${unknown.join('、')}`);
  if (kind === 'document' && typeof row.priceIncludesTax !== 'boolean') {
    inputError('含税口径必须明确为“是”或“否”，不能留空或使用其他值');
  }
  if (kind === 'opening' && row.amountCents !== undefined && row.valueBasis !== 'amount')
    inputError('填写金额时必须明确选择“直接金额”口径，不能默认为数量×单价');
}
function readCell(column: Column, value: string | number | boolean | null): unknown {
  const s = String(value ?? '').trim();
  if (column.type === 'contractStatus') {
    const status: Record<string, string> = {
      '': 'open',
      执行中: 'open',
      已完成: 'completed',
      已取消: 'cancelled',
      open: 'open',
      completed: 'completed',
      cancelled: 'cancelled',
    };
    if (!(s in status)) return inputError('合同执行状态须填写执行中、已完成或已取消');
    return status[s];
  }
  if (column.type === 'openingBasis') {
    if (s === '数量×单价' || s === 'unitPrice') return 'unitPrice';
    if (s === '直接金额' || s === 'amount') return 'amount';
    return inputError('保存口径必须明确填写“数量×单价”或“直接金额”');
  }
  if (column.type === 'cents') {
    if (!s) return undefined;
    return openingCents(s);
  }
  if (column.type === 'taxBasis') {
    if (value === true || s === '是' || s === 'true') return true;
    if (value === false || s === '否' || s === 'false') return false;
    return inputError('含税口径必须明确为“是”或“否”，不能留空或使用其他值');
  }
  if (column.type === 'disabled') {
    if (value === true || ['是', 'true', '停用'].includes(s)) return true;
    if (value === false || ['否', 'false', '启用'].includes(s)) return false;
    return inputError('停用状态必须明确填写“启用”或“停用”');
  }
  if (column.type === 'id') {
    if (!s) return null;
    if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s) <= 0)
      inputError(`${column.title}必须为有效正整数`);
    return Number(s);
  }
  return value == null ? '' : String(value);
}
/** Read actual XLSX values without formulas, guessed booleans or silently dropped columns. */
export async function readInventoryXlsx(data: ArrayBuffer, kind: InventoryImportKind) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2 || ws.rowCount > 1001)
    inputError('请选择含 1 到 1000 行数据的 Excel 工作表');
  const columns = INVENTORY_IMPORT_COLUMNS[kind];
  const errors: ImportIssue[] = [];
  const mapped: (Column | undefined)[] = [];
  const seen = new Set<string>();
  for (let index = 1; index <= ws.columnCount; index++) {
    const header = String(ws.getRow(1).getCell(index).value ?? '').trim();
    const column = columns.find(
      (c) => c.title === header || c.key === header || c.aliases?.includes(header),
    );
    if (!column) {
      errors.push({
        row: 1,
        message: `第 ${index} 列“${header || '空表头'}”无法识别，请使用导入模板`,
      });
    } else if (seen.has(column.key)) {
      errors.push({ row: 1, message: `第 ${index} 列重复映射“${column.title}”，不能覆盖前一列` });
    } else {
      seen.add(column.key);
      mapped[index - 1] = column;
    }
  }
  for (const c of columns)
    if (c.required && !seen.has(c.key)) errors.push({ row: 1, message: `缺少必填列“${c.title}”` });
  const rows: Record<string, unknown>[] = [],
    rowNumbers: number[] = [];
  ws.eachRow((row, index) => {
    if (index === 1) return;
    const out: Record<string, unknown> = {};
    for (const [i, column] of mapped.entries()) {
      if (!column) continue;
      const value = row.getCell(i + 1).value;
      try {
        if (value != null && typeof value === 'object')
          inputError(`第 ${i + 1} 列含公式或复合单元格，请粘贴为纯值`);
        const cell = readCell(column, value as string | number | boolean | null);
        // An inactive opening input stays absent, never coerced to zero.
        if (
          kind === 'opening' &&
          (cell === undefined || (column.key === 'unitPrice' && cell === ''))
        )
          continue;
        out[column.key] = cell;
      } catch (e) {
        errors.push({ row: index, message: e instanceof Error ? e.message : '数据错误' });
      }
    }
    rows.push(out);
    rowNumbers.push(index);
  });
  return { rows, rowNumbers, errors };
}
/** These values feed the existing Excel exporter; booleans round-trip explicitly. */
export function importExportColumns(kind: InventoryImportKind) {
  return INVENTORY_IMPORT_COLUMNS[kind]
    .filter((c) => c.type !== 'id')
    .map((c) => ({
      title: c.title,
      value: (row: Record<string, unknown>): string | number | null => {
        const value = row[c.key];
        if (kind === 'opening') {
          const basis = row.valueBasis ?? 'unitPrice';
          if (c.type === 'openingBasis') return basis === 'amount' ? '直接金额' : '数量×单价';
          if (c.key === 'unitPrice' && basis === 'amount') return null;
          if (c.type === 'cents')
            return basis === 'amount' && typeof value === 'number' ? centsToYuan(value) : null;
        }
        if (c.type === 'taxBasis') return value === true ? '是' : value === false ? '否' : null;
        if (c.type === 'disabled') return value === true ? '停用' : value === false ? '启用' : null;
        if (c.type === 'contractStatus')
          return (
            { open: '执行中', completed: '已完成', cancelled: '已取消' }[
              String(value) as 'open' | 'completed' | 'cancelled'
            ] ?? null
          );
        return typeof value === 'string' || typeof value === 'number' ? value : null;
      },
    }));
}
