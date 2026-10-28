import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { BusinessError, multiplyToCents, sumCents } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { ContractSchema, type ContractInput } from '../shared';
import { requireImportKeys } from '../excel';
import { e6, fail, inventoryService } from './service';

const secret = randomBytes(32);
const headerSchema = ContractSchema.omit({
  id: true,
  revision: true,
  warehouseId: true,
  supplierId: true,
  lines: true,
}).extend({ warehouseCode: z.string().trim().min(1), supplierCode: z.string().trim().min(1) });
type ContractFileRow = z.infer<typeof headerSchema> & {
  productCode: string;
  quantity: string;
  unitPrice: string;
  lineNote: string;
};
export async function exportContracts(
  svc: CoreServices,
  ids: number[],
): Promise<ContractFileRow[]> {
  svc.permissions.require('inventory.view');
  if (!ids.length || ids.length > 200 || new Set(ids).size !== ids.length)
    fail('CONTRACT_EXPORT', '请选择 1 到 200 张不同的合同');
  const s = inventoryService(svc),
    warehouses = await s.warehouses(),
    rows: ContractFileRow[] = [];
  for (const id of ids) {
    const c = await s.getContract(id),
      supplier = await svc.dimensions.get(c.supplier_id);
    const warehouse = warehouses.find((w) => w.id === c.warehouse_id);
    if (!supplier || !warehouse)
      fail(
        'CONTRACT_REFERENCE',
        `合同 ${c.number} 的仓库或供应商档案缺失`,
        '请修复档案引用后再转出',
      );
    for (const line of c.lines)
      rows.push({
        number: c.number,
        warehouseCode: warehouse.code,
        supplierCode: supplier.code,
        date: c.date,
        dueDate: c.due_date,
        agent: c.agent,
        note: c.note,
        status: c.status,
        productCode: line.productCode,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineNote: line.note,
      });
  }
  if (rows.length > 1000)
    fail('CONTRACT_EXPORT', '所选合同明细超过 1000 行', '请减少每批合同数量后分批转出');
  return rows;
}
export async function importContracts(
  svc: CoreServices,
  v: {
    rows: Record<string, unknown>[];
    rowNumbers?: number[];
    overwrite?: boolean;
    confirmation?: string;
  },
  commit: boolean,
) {
  if (commit && !svc.db.isTransaction)
    fail('TRANSACTION', '整批合同保存必须在同一事务中执行', '请重新通过合同导入入口预览并确认保存');
  svc.permissions.require('inventory.import');
  svc.permissions.require('inventory.edit');
  const s = inventoryService(svc),
    warehouses = await s.warehouses(),
    contracts = await s.contracts();
  const products = await s.products(),
    partners = await svc.dimensions.items('partner');
  const errors: { row: number; message: string }[] = [],
    rows: ContractFileRow[] = [];
  const grouped = new Map<
    string,
    { header: z.infer<typeof headerSchema>; input: ContractInput; firstRow: number }
  >();
  if (v.rowNumbers && v.rowNumbers.length !== v.rows.length)
    fail('IMPORT', 'Excel 行号与数据行数不一致，请重新读取文件');
  if (v.overwrite)
    errors.push({
      row: 0,
      message: '合同文件只新增合同，不覆盖已有合同，请为复制合同改用新合同号',
    });
  for (const [i, row] of v.rows.entries()) {
    const rowNumber = v.rowNumbers?.[i] ?? i + 2;
    try {
      requireImportKeys('contracts', row);
      const header = headerSchema.parse({ ...row, dueDate: row.dueDate || null });
      const line = ContractSchema.shape.lines.element.parse({
        productCode: row.productCode,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        note: row.lineNote ?? '',
        priceIncludesTax: false,
      });
      const warehouse = warehouses.find((w) => w.code === header.warehouseCode && !w.disabled);
      const supplier = partners.find(
        (p) => p.code === header.supplierCode && !p.disabled && p.isLeaf,
      );
      if (!warehouse || !supplier)
        fail(
          'CONTRACT_REFERENCE',
          '仓库或供应商编码不存在、已停用或不是末级档案',
          '请先维护相同编码的档案',
        );
      await s.unlocked(header.date);
      if (header.dueDate && header.dueDate < header.date)
        fail('CONTRACT_DATE', '交期不能早于合同日期');
      if (contracts.some((c) => c.number === header.number))
        fail('CONTRACT_NUMBER', `采购合同号 ${header.number} 已存在，文件不能覆盖原合同`);
      const product = await s.product(line.productCode, i + 1);
      if (product.disabled) fail('DISABLED', `产品 ${product.code} 已停用`);
      multiplyToCents(line.quantity, line.unitPrice);
      const previous = grouped.get(header.number);
      const productQuantity = [...(previous?.input.lines ?? []), line]
        .filter((l) => l.productCode === line.productCode)
        .reduce((n, l) => n + BigInt(e6(l.quantity)), 0n);
      if (productQuantity > BigInt(Number.MAX_SAFE_INTEGER))
        fail(
          'CONTRACT_QUANTITY',
          `合同 ${header.number} 的产品 ${line.productCode} 累计数量超出可核算范围`,
          '请核对全部明细并减少数量或拆分合同',
        );
      if (previous && JSON.stringify(previous.header) !== JSON.stringify(header))
        fail(
          'CONTRACT_HEADER',
          `同一合同 ${header.number} 的头信息与第 ${previous.firstRow} 行不一致`,
          '请逐行重复相同的完整合同头信息',
        );
      if (previous) previous.input.lines.push(line);
      else
        grouped.set(header.number, {
          header,
          firstRow: rowNumber,
          input: {
            number: header.number,
            warehouseId: warehouse.id,
            supplierId: supplier.id,
            date: header.date,
            dueDate: header.dueDate,
            agent: header.agent,
            note: header.note,
            status: header.status,
            lines: [line],
          },
        });
      rows.push({
        ...header,
        productCode: line.productCode,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineNote: line.note,
      });
    } catch (error) {
      errors.push({
        row: rowNumber,
        message:
          error instanceof BusinessError
            ? error.data.message
            : error instanceof z.ZodError
              ? '合同必填项、日期、数量或单价格式不正确，请核对导入模板'
              : error instanceof Error
                ? error.message
                : '合同数据校验失败',
      });
    }
  }
  if (grouped.size > 200) errors.push({ row: 0, message: '每批最多转入 200 张合同' });
  const total = sumCents(rows.map((r) => multiplyToCents(r.quantity, r.unitPrice)));
  const confirmation = createHmac('sha256', secret)
    .update(
      JSON.stringify({
        rows: v.rows,
        rowNumbers: v.rowNumbers,
        overwrite: v.overwrite,
        warehouses,
        contracts,
        products,
        partners,
        context: await s.context(),
        periods: await svc.periods.list(),
        user: svc.user.id,
      }),
    )
    .digest('hex');
  if (commit) {
    if (errors.length)
      fail('CONTRACT_IMPORT', '合同转入存在逐行错误，未保存任何合同', '请修正后重新预览');
    if (v.confirmation !== confirmation)
      fail('IMPORT_VERSION', '合同导入预览已过期或档案、期间、业务已变化', '请重新预览后确认');
    for (const c of grouped.values()) await s.saveContract(c.input);
    await svc.log.write({
      action: 'inventory.contract.import',
      summary: `转入 ${grouped.size} 张采购合同、${rows.length} 行明细`,
    });
  }
  return {
    rows,
    errors,
    amounts: { netCents: total, taxCents: 0, grossCents: total },
    confirmation,
    saved: commit,
  };
}
