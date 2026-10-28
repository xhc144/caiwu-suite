import type { CoreServices } from '@caiwu/core/server';
import { BusinessError } from '@caiwu/core';
import {
  InventoryQuerySchema,
  applyInventoryQuery,
  type InventoryQueryInput,
  type QueryRow,
} from '../query';
import type { InventoryTables } from './migrations';
import { quantity } from './service';

/** Complete line-level query. Decimal predicates and ordering stay exact, including recurring tax-exclusive prices. */
export async function inventoryQuery(svc: CoreServices, raw: InventoryQueryInput) {
  svc.permissions.require('inventory.view');
  const parsed = InventoryQuerySchema.safeParse(raw);
  if (!parsed.success)
    throw new BusinessError({
      code: 'INVENTORY_QUERY',
      message: /[\u4e00-\u9fff]/.test(parsed.error.issues[0]?.message ?? '')
        ? parsed.error.issues[0]!.message
        : '查询条件字段、类型或格式不正确',
      hint: '请修改条件后重新执行；错误条件不会被忽略',
    });
  const input = parsed.data;
  const db = svc.db.withTables<InventoryTables>();
  const data = await db
    .selectFrom('inventory_line as l')
    .innerJoin('inventory_document as d', 'd.id', 'l.document_id')
    .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
    .innerJoin('inventory_warehouse as w', 'w.id', 'd.warehouse_id')
    .leftJoin('account as a', 'a.id', 'd.account_id')
    .leftJoin('account as c', 'c.id', 'd.cost_account_id')
    .leftJoin('account as i', 'i.id', 'p.inventory_account_id')
    .leftJoin('account as s', 's.id', 'p.sales_account_id')
    .leftJoin('app_user as u', 'u.id', 'd.audited_by')
    .leftJoin('app_user as maker', 'maker.id', 'd.created_by')
    .select([
      'l.id',
      'l.document_id as documentId',
      'd.kind',
      'd.number',
      'd.date',
      'd.period',
      'd.audited_at',
      'maker.name as creator',
      'd.category',
      'd.operator',
      'd.summary',
      'd.tax_rate as taxRate',
      'd.audited_by',
      'd.voucher_id',
      'd.calculation_status',
      'd.calculation_batch',
      'd.calculation_period',
      'w.code as warehouseCode',
      'w.name as warehouseName',
      'w.kind as warehouseKind',
      'w.disabled as warehouseDisabled',
      'p.code as productCode',
      'p.name as productName',
      'p.specification',
      'p.unit',
      'p.receipt_price as receiptPrice',
      'p.issue_price as issuePrice',
      'p.plan_price as planPrice',
      'p.allocation_factor as allocationFactor',
      'p.disabled as productDisabled',
      'a.code as accountCode',
      'a.name as accountName',
      'c.code as costAccountCode',
      'c.name as costAccountName',
      'i.code as inventoryAccountCode',
      'i.name as inventoryAccountName',
      's.code as salesAccountCode',
      's.name as salesAccountName',
      'u.name as auditor',
      'l.position',
      'l.quantity_e6',
      'l.unit_price as unitPrice',
      'l.tax_unit_price as taxUnitPrice',
      'l.tax_rate as lineTaxRate',
      'l.price_includes_tax',
      'l.net_cents as netCents',
      'l.tax_cents as taxCents',
      'l.gross_cents as grossCents',
      'l.outbound_cost_cents',
      'l.unit_cost',
      'l.calculation_status as lineStatus',
      'l.calculation_batch as lineBatch',
      'l.calculation_period as linePeriod',
      'l.note',
    ])
    .execute();
  const linked = new Set(
    (await db.selectFrom('inventory_voucher_source').select('document_id').execute()).map(
      (r) => r.document_id,
    ),
  );
  const rows: QueryRow[] = data.map((row) => {
    const costed =
      row.kind === 'issue' &&
      row.calculation_status === 'calculated' &&
      row.lineStatus === 'calculated' &&
      row.calculation_batch === row.lineBatch &&
      row.calculation_period === row.linePeriod;
    return {
      id: row.id,
      documentId: row.documentId,
      kind: row.kind,
      repeatedHeader: false,
      direction: row.kind === 'receipt' ? '入库' : '出库',
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      warehouseKind: row.warehouseKind === 'warehouse' ? '仓库' : '车间',
      warehouseStatus: row.warehouseDisabled ? '停用' : '启用',
      number: row.number,
      date: row.date,
      period: row.period,
      auditDate: row.audited_at?.slice(0, 10) ?? null,
      creator: row.creator,
      category: row.category,
      operator: row.operator,
      summary: row.summary,
      taxRate: row.lineTaxRate ?? row.taxRate,
      accountCode: row.accountCode,
      accountName: row.accountName,
      costAccountCode: row.costAccountCode,
      costAccountName: row.costAccountName,
      auditStatus: row.audited_by == null ? '未审核' : '已审核',
      auditor: row.auditor,
      voucherStatus: row.voucher_id != null || linked.has(row.documentId) ? '已生成' : '未生成',
      calculationStatus: row.calculation_status === 'calculated' ? '已核算' : '未核算',
      productCode: row.productCode,
      productName: row.productName,
      specification: row.specification,
      unit: row.unit,
      receiptPrice: row.receiptPrice,
      issuePrice: row.issuePrice,
      planPrice: row.planPrice,
      allocationFactor: row.allocationFactor,
      productStatus: row.productDisabled ? '停用' : '启用',
      inventoryAccountCode: row.inventoryAccountCode,
      inventoryAccountName: row.inventoryAccountName,
      salesAccountCode: row.salesAccountCode,
      salesAccountName: row.salesAccountName,
      position: row.position,
      quantity: quantity(row.quantity_e6),
      unitPrice: row.unitPrice,
      taxUnitPrice: row.taxUnitPrice,
      priceBasis: row.price_includes_tax ? '含税' : '不含税',
      netCents: row.netCents,
      taxCents: row.taxCents,
      grossCents: row.grossCents,
      costCents: costed ? row.outbound_cost_cents : null,
      unitCost: costed ? row.unit_cost : null,
      note: row.note,
    };
  });
  return { rows: applyInventoryQuery(rows, input), columns: input.columns };
}
