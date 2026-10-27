import { periodEndDate, zPeriod, BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { InventoryTables } from './migrations';
import { quantity } from './service';

/** Inventory owns these records. A future core bridge must call this read API;
 * costing must never import or write inventory tables. All IDs are book-local. */
export async function readCostingSnapshot(svc: CoreServices, period: number) {
  zPeriod.parse(period);
  return svc.tx(async (t) => {
    const book = await t.book.info();
    await t.periods.require(period);
    if (period < book.startPeriod)
      throw new BusinessError({
        code: 'INVENTORY_PERIOD',
        message: '核算月份早于库存启用月份',
        hint: '请选择启用月份或之后的月份',
      });
    const db = t.db.withTables<InventoryTables>();
    const cutoffDate = periodEndDate(period);
    const control = await db
      .selectFrom('inventory_control')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const products = await db.selectFrom('inventory_product').selectAll().orderBy('id').execute();
    const warehouses = await db
      .selectFrom('inventory_warehouse')
      .selectAll()
      .orderBy('id')
      .execute();
    const opening = await db
      .selectFrom('inventory_opening')
      .selectAll()
      .orderBy('warehouse_id')
      .orderBy('product_id')
      .execute();
    const documents = await db
      .selectFrom('inventory_document')
      .selectAll()
      .where('date', '<=', cutoffDate)
      .orderBy('date')
      .orderBy('id')
      .execute();
    const lines = await db
      .selectFrom('inventory_line as l')
      .innerJoin('inventory_document as d', 'd.id', 'l.document_id')
      .selectAll('l')
      .where('d.date', '<=', cutoffDate)
      .orderBy('d.date')
      .orderBy('d.id')
      .orderBy('l.position')
      .execute();
    const counts = await db
      .selectFrom('inventory_count')
      .selectAll()
      .where('period', '<=', period)
      .orderBy('period')
      .orderBy('warehouse_id')
      .execute();
    const countLines = await db
      .selectFrom('inventory_count_line as l')
      .innerJoin('inventory_count as c', 'c.id', 'l.count_id')
      .selectAll('l')
      .where('c.period', '<=', period)
      .orderBy('l.count_id')
      .orderBy('l.product_id')
      .execute();
    return {
      version: 1 as const,
      bookId: book.id,
      startPeriod: book.startPeriod,
      period,
      cutoffDate,
      stockRevision: control.stock_revision,
      control: {
        costCutoffDate: control.cost_cutoff_date,
        costPeriod: control.cost_period,
        costBatch: control.cost_batch,
        openingLocked: !!control.opening_locked,
      },
      products: products.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
        revision: p.revision,
        inventoryAccountId: p.inventory_account_id,
        salesAccountId: p.sales_account_id,
        allocationFactor: p.allocation_factor,
        disabled: !!p.disabled,
      })),
      warehouses: warehouses.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        kind: w.kind,
        revision: w.revision,
        disabled: !!w.disabled,
      })),
      opening: opening.map((o) => ({
        id: o.id,
        warehouseId: o.warehouse_id,
        productId: o.product_id,
        quantity: quantity(o.quantity_e6),
        unitPrice: o.unit_price,
        amountCents: o.amount_cents,
        calculationStatus: o.calculation_status,
        calculationBatch: o.calculation_batch,
        calculationPeriod: o.calculation_period,
      })),
      documents: documents.map((d) => ({
        id: d.id,
        revision: d.revision,
        warehouseId: d.warehouse_id,
        kind: d.kind,
        number: d.number,
        date: d.date,
        period: d.period,
        category: d.category,
        accountId: d.account_id,
        costAccountId: d.cost_account_id,
        taxRate: d.tax_rate,
        auditedBy: d.audited_by,
        voucherId: d.voucher_id,
        sourceType: d.source_type,
        sourceId: d.source_id,
        calculationStatus: d.calculation_status,
        calculationBatch: d.calculation_batch,
        calculationPeriod: d.calculation_period,
        calculationCutoffDate: d.calculation_cutoff_date,
      })),
      movements: lines.map((l) => ({
        id: l.id,
        documentId: l.document_id,
        productId: l.product_id,
        position: l.position,
        quantity: quantity(l.quantity_e6),
        unitPrice: l.unit_price,
        netCents: l.net_cents,
        taxCents: l.tax_cents,
        grossCents: l.gross_cents,
        outboundCostCents: l.outbound_cost_cents,
        unitCost: l.unit_cost,
        calculationStatus: l.calculation_status,
        calculationBatch: l.calculation_batch,
        calculationPeriod: l.calculation_period,
      })),
      counts: counts.map((c) => ({
        id: c.id,
        warehouseId: c.warehouse_id,
        period: c.period,
        revision: c.revision,
        calculationStatus: c.calculation_status,
        calculationBatch: c.calculation_batch,
        lines: countLines
          .filter((l) => l.count_id === c.id)
          .map((l) => ({
            id: l.id,
            productId: l.product_id,
            bookQuantity: quantity(l.book_e6),
            actualQuantity: quantity(l.actual_e6),
            bookCents: l.book_cents,
          })),
      })),
    };
  });
}
export type CostingSnapshot = Awaited<ReturnType<typeof readCostingSnapshot>>;
